import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  SAVE_LIMIT,
  SAVE_WINDOW_MS,
  checkSaveRateLimit,
  decideRateLimit,
} from "@/lib/rate-limit";

/**
 * The clock is a value here, never the wall clock and never setTimeout. Every
 * instant below is derived from T0, so the assertions say what they mean —
 * "fifty-nine minutes ago" rather than "long enough that it should have
 * expired by now, probably".
 */
const T0 = Date.parse("2026-09-10T12:00:00.000Z");
const MINUTE = 60_000;

/** Saves spread one minute apart, oldest first, ending `endsAgoMs` before T0. */
function saves(count: number, endsAgoMs: number, spacingMs = MINUTE): number[] {
  return Array.from(
    { length: count },
    (_unused, index) => T0 - endsAgoMs - (count - 1 - index) * spacingMs,
  );
}

describe("decideRateLimit", () => {
  it("allows a user who has never saved", () => {
    expect(decideRateLimit([], T0)).toEqual({
      allowed: true,
      limit: SAVE_LIMIT,
      remaining: SAVE_LIMIT,
      retryAfterSeconds: 0,
    });
  });

  it("counts down the remaining saves", () => {
    const decision = decideRateLimit(saves(4, MINUTE), T0, 10, SAVE_WINDOW_MS);

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(6);
    expect(decision.retryAfterSeconds).toBe(0);
  });

  it("allows the request that fills the last slot", () => {
    // Nine saves against a limit of ten: this request is the tenth and fits.
    const decision = decideRateLimit(saves(9, MINUTE), T0, 10, SAVE_WINDOW_MS);

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1);
  });

  it("rejects the request after the limit is reached", () => {
    const decision = decideRateLimit(saves(10, MINUTE), T0, 10, SAVE_WINDOW_MS);

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("ignores saves that have already left the window", () => {
    const expired = saves(10, SAVE_WINDOW_MS + MINUTE);
    const recent = saves(2, MINUTE);

    const decision = decideRateLimit(
      [...expired, ...recent],
      T0,
      10,
      SAVE_WINDOW_MS,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(8);
  });

  it("treats a save exactly one window old as expired", () => {
    // The boundary decides whether a user who saved their tenth item at 12:00
    // is freed at 13:00 or at 13:00 plus one more request. Freed at 13:00.
    const decision = decideRateLimit([T0 - SAVE_WINDOW_MS], T0, 1);

    expect(decision.allowed).toBe(true);
  });

  it("is not fooled by unsorted timestamps", () => {
    const ordered = saves(10, MINUTE);
    const shuffled = [...ordered].reverse();

    expect(decideRateLimit(shuffled, T0, 10)).toEqual(
      decideRateLimit(ordered, T0, 10),
    );
  });
});

describe("decideRateLimit retry-after", () => {
  it("counts from the save that has to age out", () => {
    // Ten saves a second apart, the oldest 59 minutes ago. One slot frees a
    // minute from now, and that is the whole answer the client needs.
    const timestamps = Array.from(
      { length: 10 },
      (_unused, index) => T0 - 59 * MINUTE + index * 1000,
    );

    const decision = decideRateLimit(timestamps, T0, 10, SAVE_WINDOW_MS);

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(60);
  });

  it("skips past saves that are already older than the blocking one", () => {
    // Twelve saves in the window against a limit of ten. Two have to expire
    // before there is room, so the answer is the third-oldest, not the oldest.
    const timestamps = [
      T0 - 59 * MINUTE,
      T0 - 58 * MINUTE,
      T0 - 50 * MINUTE,
      ...saves(9, MINUTE),
    ];

    const decision = decideRateLimit(timestamps, T0, 10, SAVE_WINDOW_MS);

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(10 * 60);
  });

  it("never tells a client to retry immediately", () => {
    // The blocking save expires in 400ms. Rounding that down to 0 would put
    // "Retry-After: 0" on a 429, which is not an answer to "too fast".
    const decision = decideRateLimit(
      [T0 - SAVE_WINDOW_MS + 400],
      T0,
      1,
      SAVE_WINDOW_MS,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(1);
  });

  it("rounds a partial second up", () => {
    const decision = decideRateLimit(
      [T0 - SAVE_WINDOW_MS + 30_001],
      T0,
      1,
      SAVE_WINDOW_MS,
    );

    expect(decision.retryAfterSeconds).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// The database read
// ---------------------------------------------------------------------------

interface RecordedQuery {
  table: string;
  columns: string;
  gteColumn: string;
  gteValue: string;
  limit: number;
}

interface FakeResult {
  rows?: string[];
  error?: { message: string };
}

/**
 * The smallest thing that answers the one query checkSaveRateLimit makes.
 *
 * Hand-rolled rather than mocked: the point of the test is that the window
 * boundary and the row cap reach PostgREST intact, and a mock that records
 * calls without shaping them like the real builder would pass while the real
 * query filtered on nothing.
 */
function fakeClient(result: FakeResult) {
  const recorded: RecordedQuery = {
    table: "",
    columns: "",
    gteColumn: "",
    gteValue: "",
    limit: -1,
  };

  const builder = {
    select(columns: string) {
      recorded.columns = columns;
      return builder;
    },
    gte(column: string, value: string) {
      recorded.gteColumn = column;
      recorded.gteValue = value;
      return builder;
    },
    order() {
      return builder;
    },
    limit(count: number) {
      recorded.limit = count;
      return Promise.resolve({
        data: (result.rows ?? []).map((created_at) => ({ created_at })),
        error: result.error ?? null,
      });
    },
  };

  const client = {
    from(table: string) {
      recorded.table = table;
      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, recorded };
}

describe("checkSaveRateLimit", () => {
  it("asks for exactly the window, and one row more than the limit", async () => {
    const { client, recorded } = fakeClient({ rows: [] });

    await checkSaveRateLimit(client, { now: () => T0, limit: 10 });

    expect(recorded.table).toBe("save_events");
    expect(recorded.gteColumn).toBe("created_at");
    expect(recorded.gteValue).toBe(new Date(T0 - SAVE_WINDOW_MS).toISOString());
    // One more than the limit: enough to know the request is over, and enough
    // to name the save it is waiting on.
    expect(recorded.limit).toBe(11);
  });

  it("turns stored timestamps into a decision", async () => {
    const { client } = fakeClient({
      rows: saves(10, MINUTE).map((at) => new Date(at).toISOString()),
    });

    const decision = await checkSaveRateLimit(client, {
      now: () => T0,
      limit: 10,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("throws rather than guessing when the count cannot be read", async () => {
    // Allowing the save would make a database hiccup an open door; rejecting
    // it would accuse a legitimate user of being too fast. Neither is a
    // decision this function is entitled to make.
    const { client } = fakeClient({ error: { message: "connection reset" } });

    await expect(checkSaveRateLimit(client, { now: () => T0 })).rejects.toThrow(
      /connection reset/,
    );
  });
});
