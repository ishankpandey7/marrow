import { NextResponse, type NextRequest } from "next/server";

import * as Sentry from "@sentry/nextjs";

import { InvalidUrlError, canonicalise } from "@/lib/canonical";
import { createServerSupabase } from "@/lib/db/server";
import { checkSaveRateLimit } from "@/lib/rate-limit";
import type { Item } from "@/lib/types";

// canonicalise() hashes with node:crypto, which the Edge runtime does not have.
export const runtime = "nodejs";

export interface SaveResponse {
  item: Pick<Item, "id" | "url" | "title" | "status">;
  /** True when this URL was already in the library and has been brought back. */
  alreadySaved: boolean;
}

/**
 * The wait, in words. Retry-After carries the exact seconds for machines; a
 * person reading "Try again in 2,847 seconds" has to do arithmetic before they
 * know whether to wait or to give up.
 */
function describeWait(seconds: number): string {
  if (seconds < 60) return "a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
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

  const raw =
    typeof payload === "object" && payload !== null && "url" in payload
      ? (payload as { url: unknown }).url
      : undefined;

  if (typeof raw !== "string") {
    return NextResponse.json({ error: "A url is required." }, { status: 400 });
  }

  let canonical;
  try {
    canonical = canonicalise(raw);
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  // Checked here, after the URL is known good and before anything is written.
  // Every accepted save queues a server-side fetch of a host the user chose,
  // so this is the ceiling on how far one account can point our egress —
  // ARCHITECTURE section 9. A rejected save writes no save_event, which is
  // what lets the window drain instead of the lockout extending itself.
  let rateLimit;
  try {
    rateLimit = await checkSaveRateLimit(supabase);
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "api/save" } });
    return NextResponse.json(
      { error: "Could not save that just now. Try again." },
      { status: 500 },
    );
  }

  if (!rateLimit.allowed) {
    // 429 with the reason spelled out, not a generic 500. Someone who has just
    // pasted a reading list needs to know the link is fine and the wait is
    // short; a 500 tells them to try the same thing again immediately.
    return NextResponse.json(
      {
        error:
          `That is ${rateLimit.limit} saves in an hour, which is the limit. ` +
          `Try again in ${describeWait(rateLimit.retryAfterSeconds)}.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  // The RPC, not a hand-rolled upsert. Re-saving a URL you already have must
  // not error, must not duplicate, and must leave read position, favourites,
  // tags and highlights alone — and doing that as select-then-insert races
  // against a second tap. public.save_item does it in one statement.
  const { data, error } = await supabase.rpc("save_item", {
    p_url: raw.trim(),
    p_canonical_url: canonical.canonicalUrl,
    p_url_hash: canonical.urlHash,
  });

  if (error) {
    Sentry.captureException(error, {
      tags: { route: "api/save" },
      extra: { canonicalUrl: canonical.canonicalUrl },
    });
    return NextResponse.json(
      { error: "Could not save that just now. Try again." },
      { status: 500 },
    );
  }

  const item = data as Item;

  // On a fresh insert both timestamps take the same statement's now(); the
  // updated_at trigger only fires on UPDATE. So created_at drifting from
  // updated_at is exactly the signal that this row already existed.
  const alreadySaved = item.created_at !== item.updated_at;

  const body: SaveResponse = {
    item: {
      id: item.id,
      url: item.url,
      title: item.title,
      status: item.status,
    },
    alreadySaved,
  };

  return NextResponse.json(body, { status: alreadySaved ? 200 : 201 });
}
