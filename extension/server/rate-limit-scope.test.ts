import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  checkSaveRateLimit,
  decideRateLimit,
  SAVE_LIMIT,
  SAVE_WINDOW_MS,
  type SaveRateLimitScope,
} from "../../lib/rate-limit";

const now = Date.UTC(2026, 8, 11, 12);

function database(sessionUserId?: string) {
  const noisyUser = randomUUID();
  const quietUser = randomUUID();
  const events = [
    ...Array.from({ length: SAVE_LIMIT }, (_, index) => ({
      user_id: noisyUser,
      created_at: new Date(now - (index + 1) * 1000).toISOString(),
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      user_id: quietUser,
      created_at: new Date(now - (index + 1) * 1000).toISOString(),
    })),
  ];
  const requests: URL[] = [];
  const client = createClient(
    "https://database.invalid",
    randomBytes(32).toString("hex"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          requests.push(url);
          expect(url.pathname).toBe("/rest/v1/save_events");
          const owner = url.searchParams.get("user_id")?.replace(/^eq\./, "");
          const cutoff = url.searchParams
            .get("created_at")
            ?.replace(/^gte\./, "");
          const rows = events
            .filter((row) => !sessionUserId || row.user_id === sessionUserId)
            .filter((row) => !owner || row.user_id === owner)
            .filter((row) => !cutoff || row.created_at >= cutoff)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .slice(0, Number(url.searchParams.get("limit")))
            .map(({ created_at }) => ({ created_at }));
          return Response.json(rows);
        },
      },
    },
  );
  return { client, noisyUser, quietUser, events, requests };
}

describe("required rate-limit scope", () => {
  it("requires a scope and makes a user id mandatory only for the user form", () => {
    expectTypeOf<[]>().not.toExtend<Parameters<typeof checkSaveRateLimit>>();
    expectTypeOf<{
      kind: "user";
      client: ReturnType<typeof createClient>;
    }>().not.toExtend<SaveRateLimitScope>();
    expectTypeOf<{
      kind: "session";
      client: ReturnType<typeof createClient>;
    }>().toExtend<SaveRateLimitScope>();
  });

  it("counts the requested user's events with both users present", async () => {
    const { client, noisyUser, quietUser, requests } = database();
    const noisy = await checkSaveRateLimit(
      { kind: "user", client, userId: noisyUser },
      { now: () => now },
    );
    const quiet = await checkSaveRateLimit(
      { kind: "user", client, userId: quietUser },
      { now: () => now },
    );

    expect(noisy.allowed).toBe(false);
    expect(noisy.remaining).toBe(0);
    expect(noisy.retryAfterSeconds).toBe(3540);
    expect(quiet.allowed).toBe(true);
    expect(quiet.remaining).toBe(SAVE_LIMIT - 2);
    expect(requests.map((url) => url.searchParams.get("user_id"))).toEqual([
      `eq.${noisyUser}`,
      `eq.${quietUser}`,
    ]);
    for (const url of requests) {
      expect(url.searchParams.get("select")).toBe("created_at");
      expect(url.searchParams.get("order")).toBe("created_at.asc");
      expect(url.searchParams.get("limit")).toBe(String(SAVE_LIMIT + 1));
      expect(url.searchParams.get("created_at")).toBe(
        `gte.${new Date(now - SAVE_WINDOW_MS).toISOString()}`,
      );
    }
  });

  it("keeps the session query free of an explicit user filter", async () => {
    const { client, requests, events } = database();
    const result = await checkSaveRateLimit(
      { kind: "session", client },
      { now: () => now },
    );
    expect(requests[0].searchParams.has("user_id")).toBe(false);
    const visible = [...events]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, SAVE_LIMIT + 1)
      .map((row) => Date.parse(row.created_at));
    expect(result).toEqual(decideRateLimit(visible, now));
  });

  it("fails closed for an empty user id before any request", async () => {
    const { client, requests } = database();
    await expect(
      checkSaveRateLimit({ kind: "user", client, userId: "" }),
    ).rejects.toThrow("A verified user id is required.");
    expect(requests).toEqual([]);
  });
});
