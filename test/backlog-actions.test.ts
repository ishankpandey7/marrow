import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);

const state = vi.hoisted(() => ({
  user: { id: "test-user" } as { id: string } | null,
  calls: [] as { method: string; args: unknown[] }[],
  responses: [] as { data: unknown; error: unknown }[],
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => {
    function query() {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "update", "eq", "is"])
        chain[method] = (...args: unknown[]) => {
          state.calls.push({ method, args });
          return chain;
        };
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          state.responses.shift() ?? { data: [], error: null },
        ).then(resolve);
      return chain;
    }
    return {
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      from: (...args: unknown[]) => {
        state.calls.push({ method: "from", args });
        return query();
      },
    };
  },
}));
import { notNow } from "@/components/backlog-actions";

const id = "12345678-1234-1234-1234-123456789abc";
const now = Date.parse("2026-09-26T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  state.user = { id: "test-user" };
  state.calls = [];
  state.responses = [];
  cache.revalidatePath.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("notNow", () => {
  it("puts the item off for 30 days, changes nothing else, and skips Trash", async () => {
    state.responses.push({ data: [{ id }], error: null });
    expect(await notNow(id)).toEqual({ ok: true, message: null });
    expect(state.calls).toEqual([
      { method: "from", args: ["items"] },
      {
        method: "update",
        args: [{ resurface_after: "2026-10-26T12:00:00.000Z" }],
      },
      { method: "eq", args: ["id", id] },
      { method: "is", args: ["deleted_at", null] },
      { method: "select", args: ["id"] },
    ]);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("says so when the item is gone or in Trash", async () => {
    state.responses.push({ data: [], error: null });
    expect(await notNow(id)).toEqual({
      ok: false,
      message: "That item is no longer in your library.",
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("says so when the write fails", async () => {
    state.responses.push({ data: null, error: { message: "offline" } });
    expect((await notNow(id)).ok).toBe(false);
  });

  it.each([undefined, "bad", 42, [id]])(
    "refuses %j without querying",
    async (input) => {
      expect((await notNow(input)).ok).toBe(false);
      expect(state.calls).toEqual([]);
    },
  );

  it("does nothing without a verified user", async () => {
    state.user = null;
    expect((await notNow(id)).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });
});
