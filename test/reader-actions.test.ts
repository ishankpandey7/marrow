import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "reader-user" } as { id: string } | null,
  responses: [] as { data: unknown; error: unknown }[],
  calls: [] as { method: string; args: unknown[] }[],
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => {
    const query = {
      select(...args: unknown[]) {
        state.calls.push({ method: "select", args });
        return query;
      },
      update(...args: unknown[]) {
        state.calls.push({ method: "update", args });
        return query;
      },
      eq(...args: unknown[]) {
        state.calls.push({ method: "eq", args });
        return query;
      },
      is(...args: unknown[]) {
        state.calls.push({ method: "is", args });
        return query;
      },
      single() {
        return Promise.resolve(
          state.responses.shift() ?? { data: null, error: null },
        );
      },
    };
    return {
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      from(...args: unknown[]) {
        state.calls.push({ method: "from", args });
        return query;
      },
      rpc(...args: unknown[]) {
        state.calls.push({ method: "rpc", args });
        return Promise.resolve(state.responses.shift() ?? { error: null });
      },
    };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  saveReaderSettings,
  saveReadingProgress,
  retryReadingItem,
} from "@/components/reader/actions";

beforeEach(() => {
  state.user = { id: "reader-user" };
  state.responses = [];
  state.calls = [];
});

describe("authenticated reader persistence, with an offline database fixture", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  it("writes settings to the verified user's profile, keeping other settings", async () => {
    state.responses.push(
      {
        data: { settings: { digest: false, reader: { theme: "dark" } } },
        error: null,
      },
      { data: { id: "reader-user" }, error: null },
    );
    await saveReaderSettings({ theme: "sepia", family: "sans", size: 22 });
    expect(state.calls).toContainEqual({
      method: "update",
      args: [
        {
          settings: {
            digest: false,
            reader: { theme: "sepia", family: "sans", size: 22 },
          },
        },
      ],
    });
    expect(state.calls.filter((call) => call.method === "eq")).toEqual([
      { method: "eq", args: ["id", "reader-user"] },
      { method: "eq", args: ["id", "reader-user"] },
    ]);
  });
  it("writes only the position of a ready, non-deleted item through the session client", async () => {
    state.responses.push({ data: { id }, error: null });
    await saveReadingProgress(id, 0.68);
    expect(state.calls).toContainEqual({
      method: "update",
      args: [{ read_progress: 0.68 }],
    });
    expect(state.calls).toContainEqual({ method: "eq", args: ["id", id] });
    expect(state.calls).toContainEqual({
      method: "eq",
      args: ["status", "ready"],
    });
    expect(state.calls).toContainEqual({
      method: "is",
      args: ["deleted_at", null],
    });
  });
  it("does not write for unauthenticated calls", async () => {
    state.user = null;
    await expect(saveReadingProgress(id, 0.5)).rejects.toThrow("Sign in");
    await expect(
      saveReaderSettings({ theme: "light", family: "serif", size: 20 }),
    ).rejects.toThrow("Sign in");
    await expect(retryReadingItem(id)).rejects.toThrow("Sign in");
    expect(state.calls).toEqual([]);
  });
  it("rejects malformed settings, item ids and progress before accessing the database", async () => {
    await expect(
      saveReaderSettings({ theme: "sepia", family: "serif", size: 100000 }),
    ).rejects.toThrow("Choose");
    await expect(saveReadingProgress("bad-id", 0.5)).rejects.toThrow("Invalid");
    await expect(saveReadingProgress(id, NaN)).rejects.toThrow("Invalid");
    await expect(saveReadingProgress(id, 1.5)).rejects.toThrow("Invalid");
    expect(state.calls).toEqual([]);
  });
  it("reports RLS-hidden or failed writes rather than claiming a save", async () => {
    state.responses.push({ data: null, error: null });
    await expect(saveReadingProgress(id, 0.5)).rejects.toThrow(
      "Could not sync",
    );
    state.responses.push(
      { data: { settings: {} }, error: null },
      { data: null, error: { message: "denied" } },
    );
    await expect(
      saveReaderSettings({ theme: "light", family: "serif", size: 20 }),
    ).rejects.toThrow("Could not save");
  });
  it("retries only transient failures using the saved canonical identity", async () => {
    const item = {
      url: "https://publisher.example/story",
      canonical_url: "https://publisher.example/story",
      url_hash: "a".repeat(64),
      status: "failed",
      fail_reason: "unreachable",
    };
    state.responses.push(
      { data: item, error: null },
      { data: null, error: null },
    );
    await retryReadingItem(id);
    expect(state.calls).toContainEqual({
      method: "rpc",
      args: [
        "save_item",
        {
          p_url: item.url,
          p_canonical_url: item.canonical_url,
          p_url_hash: item.url_hash,
        },
      ],
    });
    state.calls = [];
    state.responses.push({
      data: { ...item, fail_reason: "not_found" },
      error: null,
    });
    await expect(retryReadingItem(id)).rejects.toThrow("cannot be retried");
    expect(state.calls.some((call) => call.method === "rpc")).toBe(false);
  });
});
