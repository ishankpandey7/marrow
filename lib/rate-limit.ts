/**
 * The save rate limit, counted in Postgres against the user id.
 *
 * ARCHITECTURE.md section 9 says why this exists, and it is not abuse in the
 * usual sense: every accepted save queues a server-side fetch of a URL the
 * user chose. Without a ceiling, one account can point our egress at an
 * unbounded list of hosts — we become somebody's scanner and our IP range
 * takes the blame.
 *
 * The counter is public.save_events, one row per accepted save, written by
 * save_item() inside the same statement that creates the item. Rejected saves
 * write nothing, which is what makes the window able to drain: a client that
 * keeps hammering a locked door does not extend its own lockout.
 *
 * The decision is a pure function over timestamps and a clock, so the window
 * arithmetic is tested against fixed instants rather than against setTimeout.
 * A rate-limit test that sleeps is a test that is slow, flaky, and silent about
 * the boundary it claims to check.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Sixty accepted saves per rolling hour, per user.
 *
 * Sized against the two things that actually happen. Pasting a reading list
 * in one sitting is a real burst and must not be punished; sixty covers it.
 * Sixty an hour is also far below any rate at which we would be a useful
 * scanner, and the window is rolling, so the remedy for hitting it is to wait
 * minutes rather than to wait out a fixed hour.
 */
export const SAVE_LIMIT = 60;

export const SAVE_WINDOW_MS = 60 * 60 * 1000;

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  /** Saves left in the window. Zero when rejected. */
  readonly remaining: number;
  /**
   * Whole seconds until a slot frees, floor 1. Meaningful only when rejected;
   * zero otherwise. This is the value of the Retry-After header, so it must
   * never be 0 on a 429 — "retry immediately" is not an answer to "too fast".
   */
  readonly retryAfterSeconds: number;
}

/**
 * Decide from the accepted-save timestamps already inside the window.
 *
 * Pure. `now` and `timestamps` are epoch milliseconds; the caller supplies the
 * clock. Timestamps outside the window are ignored rather than trusted to have
 * been filtered upstream, because the query that fetches them and the instant
 * used to judge them are two different things and can disagree by a round trip.
 *
 * Retry-After is derived from the save that has to age out before a slot
 * frees: with `n` saves in the window and a limit of `n`, that is the oldest
 * one. When more rows exist than were fetched — only possible when concurrent
 * requests each pass the check before either inserts — the answer is early
 * rather than wrong, and the next attempt returns a better one.
 */
export function decideRateLimit(
  timestamps: readonly number[],
  now: number,
  limit: number = SAVE_LIMIT,
  windowMs: number = SAVE_WINDOW_MS,
): RateLimitDecision {
  const windowStart = now - windowMs;
  const inWindow = timestamps
    .filter((at) => at > windowStart)
    .sort((a, b) => a - b);

  if (inWindow.length < limit) {
    return {
      allowed: true,
      limit,
      remaining: limit - inWindow.length,
      retryAfterSeconds: 0,
    };
  }

  // The oldest save that still has to expire before this request would fit.
  const blocking = inWindow[inWindow.length - limit];
  const freesAt = blocking + windowMs;

  return {
    allowed: false,
    limit,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now) / 1000)),
  };
}

/** Injected so tests never reach for the wall clock. */
export type Clock = () => number;

/** Every call explicitly chooses how its database read is scoped. */
export type SaveRateLimitScope =
  | { readonly kind: "session"; readonly client: SupabaseClient }
  | {
      readonly kind: "user";
      readonly client: SupabaseClient;
      readonly userId: string;
    };
export interface SaveRateLimitOptions {
  readonly now?: Clock;
  readonly limit?: number;
  readonly windowMs?: number;
}

/**
 * Read this user's accepted saves inside the window and decide.
 *
 * Scope is required; there is no default. The session form uses the caller's
 * RLS-scoped client and adds no user-id filter: save_events_select_own still
 * restricts that read. The service-role path must use the user form, whose
 * userId is required and comes from the verified token owner, never request
 * input. The query always applies that form's userId before reading events;
 * it is not an optional filter a caller can forget. Both forms use the same
 * window query and decideRateLimit arithmetic. save_events_window_idx covers
 * both reads.
 *
 * Only `limit + 1` rows are fetched. Anything beyond that changes no decision:
 * the request is rejected either way, and the extra rows would only refine a
 * Retry-After that is already within seconds of correct.
 *
 * A failed read throws. Silently allowing the save would turn a database
 * hiccup into an open door, and silently rejecting it would tell a legitimate
 * user they are too fast when they are not; the caller turns this into a 500,
 * which is honest about which of the two it is.
 */
export async function checkSaveRateLimit(
  scope: SaveRateLimitScope,
  options: SaveRateLimitOptions = {},
): Promise<RateLimitDecision> {
  const now = options.now ?? Date.now;
  const limit = options.limit ?? SAVE_LIMIT;
  const windowMs = options.windowMs ?? SAVE_WINDOW_MS;

  const at = now();

  let query = scope.client.from("save_events").select("created_at");
  if (scope.kind === "user") {
    if (!scope.userId) throw new Error("A verified user id is required.");
    query = query.eq("user_id", scope.userId);
  }

  const { data, error } = await query
    .gte("created_at", new Date(at - windowMs).toISOString())
    .order("created_at", { ascending: true })
    .limit(limit + 1);

  if (error) {
    throw new Error(`Could not read the save rate limit: ${error.message}`);
  }

  const timestamps = ((data ?? []) as { created_at: string }[]).map((row) =>
    Date.parse(row.created_at),
  );

  return decideRateLimit(timestamps, at, limit, windowMs);
}
