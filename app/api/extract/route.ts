import { NextResponse, type NextRequest } from "next/server";

import * as Sentry from "@sentry/nextjs";

import { FAIL_REASON_COPY } from "@/lib/constants";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { extractArticle, type ArticleMetadata } from "@/lib/extract";
import { fetchPage } from "@/lib/fetcher";
import type { FailReason, Item } from "@/lib/types";

/**
 * Runs the pipeline for one item: fetch, extract, sanitise, store.
 *
 * ARCHITECTURE.md section 5 requires the Node runtime for anything that calls
 * the fetcher — guards 5 and 7 need node:dns and a socket-level lookup hook,
 * and neither exists on Edge.
 */
export const runtime = "nodejs";

export interface ExtractResponse {
  item: Pick<
    Item,
    "id" | "status" | "fail_reason" | "title" | "reading_minutes"
  >;
  /** What to show the reader. Null when extraction worked. */
  message: string | null;
}

/** Postgres rejects a malformed uuid with an error we would rather not raise. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unique violation on (user_id, url_hash). See the canonical-url note below. */
const UNIQUE_VIOLATION = "23505";

type ItemRow = Pick<Item, "id" | "user_id" | "url" | "url_hash">;

function metadataColumns(metadata: ArticleMetadata) {
  return {
    title: metadata.title,
    author: metadata.author,
    site_name: metadata.siteName,
    excerpt: metadata.excerpt,
    lead_image_url: metadata.leadImageUrl,
    lang: metadata.lang,
    published_at: metadata.publishedAt,
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const itemId =
    typeof payload === "object" && payload !== null && "itemId" in payload
      ? (payload as { itemId: unknown }).itemId
      : undefined;

  if (typeof itemId !== "string" || !UUID.test(itemId)) {
    return NextResponse.json(
      { error: "An itemId is required." },
      {
        status: 400,
      },
    );
  }

  // No `where user_id = ...`. RLS scopes this to the caller, so another user's
  // item is not forbidden, it is absent — which is also the answer we want to
  // give, because "403" and "404" together enumerate which ids exist.
  const { data, error: readError } = await supabase
    .from("items")
    .select("id, user_id, url, url_hash")
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (readError) {
    Sentry.captureException(readError, { tags: { route: "api/extract" } });
    return NextResponse.json(
      { error: "Could not load that item just now. Try again." },
      { status: 500 },
    );
  }

  const item = data as ItemRow | null;
  if (item === null) {
    return NextResponse.json({ error: "No such item." }, { status: 404 });
  }

  // The URL exactly as the user gave it, not the canonical form. Normalisation
  // drops tracking parameters, and a handful of sites route on them; the URL
  // that worked in their browser is the one most likely to work here.
  const fetched = await fetchPage(item.url);

  if (!fetched.ok) {
    // Section 11: every failure is logged with its URL and code. blocked_url
    // especially — a spike in it means someone is probing us. The note is a
    // closed set of literals, so nothing attacker-supplied travels with it.
    Sentry.captureMessage(`extract: ${fetched.reason}`, {
      level: fetched.reason === "blocked_url" ? "warning" : "info",
      tags: { route: "api/extract", failReason: fetched.reason },
      extra: { url: item.url, note: fetched.note },
    });

    return await recordFailure(supabase, item, fetched.reason, null);
  }

  const extracted = extractArticle({
    url: fetched.page.url,
    html: fetched.page.html,
  });

  if (!extracted.ok) {
    Sentry.captureMessage(`extract: ${extracted.reason}`, {
      level: "info",
      tags: { route: "api/extract", failReason: extracted.reason },
      extra: { url: item.url },
    });

    return await recordFailure(
      supabase,
      item,
      extracted.reason,
      extracted.metadata,
    );
  }

  const { metadata, content } = extracted;

  const { error: updateError } = await supabase
    .from("items")
    .update({
      ...metadataColumns(metadata),
      word_count: content.wordCount,
      reading_minutes: content.readingMinutes,
      status: "ready",
      // The check constraint on items requires this: a ready row must not
      // still be claiming a reason, or a retry that succeeds leaves an error
      // on screen forever and nobody notices for a month.
      fail_reason: null,
    })
    .eq("id", item.id);

  if (updateError) {
    Sentry.captureException(updateError, {
      tags: { route: "api/extract" },
      extra: { url: item.url },
    });
    return NextResponse.json(
      { error: "Could not save that article just now. Try again." },
      { status: 500 },
    );
  }

  // item_content has no insert policy on purpose: a client has no business
  // authoring article HTML, since we render it back into our own origin. The
  // extraction worker is the writer, and it writes under the service role.
  const service = createServiceSupabase();

  const { error: contentError } = await service.from("item_content").upsert(
    {
      item_id: item.id,
      user_id: item.user_id,
      html: content.html,
      text: content.text,
      extractor: content.extractor,
      extracted_at: new Date().toISOString(),
    },
    { onConflict: "item_id" },
  );

  if (contentError) {
    Sentry.captureException(contentError, {
      tags: { route: "api/extract" },
      extra: { url: item.url },
    });
    return NextResponse.json(
      { error: "Could not save that article just now. Try again." },
      { status: 500 },
    );
  }

  await adoptCanonicalUrl(supabase, item, metadata);
  await closeJob(service, item.id, null);

  const body: ExtractResponse = {
    item: {
      id: item.id,
      status: "ready",
      fail_reason: null,
      title: metadata.title,
      reading_minutes: content.readingMinutes,
    },
    message: null,
  };

  return NextResponse.json(body);
}

/**
 * A failed extraction is still a saved item: the URL stays, whatever metadata
 * we managed to read stays, and the row says why. What it must never become is
 * a row stuck on "fetching" that nobody ever resolves.
 */
async function recordFailure(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  item: ItemRow,
  reason: FailReason,
  metadata: ArticleMetadata | null,
) {
  // A fetch that never got a document has no metadata to write, and writing
  // nulls over a previous run's title would make the row worse, not honest.
  const columns = metadata === null ? {} : metadataColumns(metadata);

  const { error } = await supabase
    .from("items")
    .update({ ...columns, status: "failed", fail_reason: reason })
    .eq("id", item.id);

  if (error) {
    Sentry.captureException(error, {
      tags: { route: "api/extract" },
      extra: { url: item.url, failReason: reason },
    });
    return NextResponse.json(
      { error: "Could not save that just now. Try again." },
      { status: 500 },
    );
  }

  await closeJob(createServiceSupabase(), item.id, reason);

  const body: ExtractResponse = {
    item: {
      id: item.id,
      status: "failed",
      fail_reason: reason,
      title: metadata?.title ?? null,
      reading_minutes: null,
    },
    // The copy, never the note. "Blocked: connection refused to 10.0.0.7" is a
    // working port scanner with a nice UI.
    message: FAIL_REASON_COPY[reason].message,
  };

  return NextResponse.json(body);
}

/**
 * Adopt the URL the page says is canonical, when extraction found one that
 * differs from what we stored.
 *
 * Kept out of the update above and allowed to fail: url_hash is unique per
 * user, so a page whose canonical is an article already in the library
 * collides. Merging two items is a decision nobody has made yet — read
 * position, tags and highlights all have to go somewhere — so for now the two
 * rows stay two rows and the collision is swallowed. Tracked in ROADMAP.md.
 */
async function adoptCanonicalUrl(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  item: ItemRow,
  metadata: ArticleMetadata,
) {
  if (metadata.urlHash === item.url_hash) return;

  const { error } = await supabase
    .from("items")
    .update({
      canonical_url: metadata.canonicalUrl,
      url_hash: metadata.urlHash,
    })
    .eq("id", item.id);

  if (error && error.code !== UNIQUE_VIOLATION) {
    Sentry.captureException(error, {
      tags: { route: "api/extract" },
      extra: { url: item.url },
    });
  }
}

/**
 * Close the open job for this item, if there is one.
 *
 * Bookkeeping only: this records what already happened, and deliberately does
 * not touch attempts, run_after or backoff. Retries and the cron that drives
 * them are Slice 7 and will revisit this. Leaving the row queued instead would
 * mean the database says work is pending that has already been done.
 */
async function closeJob(
  service: ReturnType<typeof createServiceSupabase>,
  itemId: string,
  reason: FailReason | null,
) {
  const { error } = await service
    .from("fetch_jobs")
    .update({
      state: reason === null ? "done" : "failed",
      last_error: reason,
      locked_at: null,
    })
    .eq("item_id", itemId)
    .in("state", ["queued", "running"]);

  if (error) {
    Sentry.captureException(error, { tags: { route: "api/extract" } });
  }
}
