import { NextResponse, type NextRequest } from "next/server";

import * as Sentry from "@sentry/nextjs";

import { InvalidUrlError, canonicalise } from "@/lib/canonical";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { extractSoon } from "@/lib/extract-now";
import {
  checkSaveRateLimit,
  SAVE_LIMIT_SQLSTATE,
  type RateLimitDecision,
  type SaveRateLimitScope,
} from "@/lib/rate-limit";
import type { Item } from "@/lib/types";
import {
  extensionTokenSecret,
  findExtensionTokenOwner,
  isExtensionToken,
} from "@/extension/server/tokens";
import {
  isExtensionOrigin,
  isSaveOriginAllowed,
  isSavePreflightAllowed,
  saveCorsHeaders,
} from "@/extension/server/cors";

// canonicalise() hashes with node:crypto, which the Edge runtime does not have.
export const runtime = "nodejs";

/**
 * The fetch after the response (Slice 9) runs inside this invocation's
 * lifetime. One fetch is at most ten seconds plus extraction; without an
 * explicit ceiling it would inherit the platform default. A fetch cut off
 * anyway leaves its row running until the daily run's stale-lock reclaim.
 */
export const maxDuration = 60;

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
  const origin = request.headers.get("origin");
  const cors = saveCorsHeaders(origin, request.nextUrl.origin);
  const respond = (body: unknown, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    cors.forEach((value, key) => response.headers.set(key, value));
    return response;
  };
  if (!isSaveOriginAllowed(origin, request.nextUrl.origin)) {
    return respond({ error: "Origin not allowed." }, { status: 403 });
  }

  let scope: SaveRateLimitScope;
  try {
    const authorization = request.headers.get("authorization");
    if (authorization !== null) {
      const token = /^Bearer (.+)$/i.exec(authorization)?.[1];
      if (!token || !isExtensionToken(token)) {
        return respond({ error: "Invalid save token." }, { status: 401 });
      }
      const client = createServiceSupabase();
      const userId = await findExtensionTokenOwner(
        client,
        token,
        extensionTokenSecret(),
      );
      if (!userId) {
        return respond(
          { error: "Invalid or revoked save token." },
          { status: 401 },
        );
      }
      // The same verified owner scopes both the count and the implementation.
      // A bearer failure never falls back to ambient session cookies.
      scope = { kind: "user", client, userId };
    } else {
      if (origin && isExtensionOrigin(origin)) {
        return respond({ error: "A save token is required." }, { status: 401 });
      }
      const client = await createServerSupabase();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) {
        return respond({ error: "Not signed in." }, { status: 401 });
      }
      scope = { kind: "session", client };
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "api/save" } });
    return respond(
      { error: "Could not save that just now. Try again." },
      { status: 500 },
    );
  }

  const supabase = scope.client;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond({ error: "Expected JSON." }, { status: 400 });
  }

  const raw =
    typeof payload === "object" && payload !== null && "url" in payload
      ? (payload as { url: unknown }).url
      : undefined;

  if (typeof raw !== "string") {
    return respond({ error: "A url is required." }, { status: 400 });
  }

  let canonical;
  try {
    canonical = canonicalise(raw);
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      return respond({ error: error.message }, { status: 400 });
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
    rateLimit = await checkSaveRateLimit(scope);
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "api/save" } });
    return respond(
      { error: "Could not save that just now. Try again." },
      { status: 500 },
    );
  }

  // 429 with the reason spelled out, not a generic 500. Someone who has just
  // pasted a reading list needs to know the link is fine and the wait is
  // short; a 500 tells them to try the same thing again immediately.
  const tooMany = (decision: RateLimitDecision) =>
    respond(
      {
        error:
          `That is ${decision.limit} saves in an hour, which is the limit. ` +
          `Try again in ${describeWait(decision.retryAfterSeconds)}.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(decision.retryAfterSeconds) },
      },
    );

  if (!rateLimit.allowed) return tooMany(rateLimit);

  // The RPC, not a hand-rolled upsert. Re-saving a URL you already have must
  // not error, must not duplicate, and must leave read position, favourites,
  // tags and highlights alone — and doing that as select-then-insert races
  // against a second tap. public.save_item does it in one statement.
  const args = {
    p_url: raw.trim(),
    p_canonical_url: canonical.canonicalUrl,
    p_url_hash: canonical.urlHash,
  };
  const { data, error } =
    scope.kind === "session"
      ? await supabase.rpc("save_item", args)
      : await supabase.rpc("save_item_impl", {
          p_user_id: scope.userId,
          ...args,
        });

  // The same limit, enforced again inside Postgres (0006). Reaching it here
  // means a concurrent save took the last slot between our check and the
  // insert; the window read again gives the honest wait.
  if (error?.code === SAVE_LIMIT_SQLSTATE) {
    try {
      const again = await checkSaveRateLimit(scope);
      return tooMany(
        again.allowed ? { ...again, retryAfterSeconds: 1 } : again,
      );
    } catch (readError) {
      Sentry.captureException(readError, { tags: { route: "api/save" } });
    }
  }

  if (error) {
    Sentry.captureException(error, {
      tags: { route: "api/save" },
      extra: { canonicalUrl: canonical.canonicalUrl },
    });
    return respond(
      { error: "Could not save that just now. Try again." },
      { status: 500 },
    );
  }

  const item = data as Item;

  // On a fresh insert both timestamps take the same statement's now(); the
  // updated_at trigger only fires on UPDATE. So created_at drifting from
  // updated_at is exactly the signal that this row already existed.
  const alreadySaved = item.created_at !== item.updated_at;

  // A ready item queued nothing. Otherwise fetch it now rather than at the
  // next daily cron. item.user_id is the verified owner: our own RPC wrote it
  // from auth.uid() or from the token's owner.
  if (item.status !== "ready") extractSoon(item.id, item.user_id, "api/save");

  const body: SaveResponse = {
    item: {
      id: item.id,
      url: item.url,
      title: item.title,
      status: item.status,
    },
    alreadySaved,
  };

  return respond(body, { status: alreadySaved ? 200 : 201 });
}

export function OPTIONS(request: NextRequest) {
  const headers = saveCorsHeaders(
    request.headers.get("origin"),
    request.nextUrl.origin,
  );
  if (!isSavePreflightAllowed(request.headers, request.nextUrl.origin)) {
    return new NextResponse(null, { status: 403, headers });
  }
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return new NextResponse(null, { status: 204, headers });
}
