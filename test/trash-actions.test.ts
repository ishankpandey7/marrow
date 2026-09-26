import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);

const state = vi.hoisted(() => ({
  user: { id: "test-user" } as { id: string } | null,
  calls: [] as { method: string; args: unknown[] }[],
  responses: [] as { data: unknown; error: unknown; count?: number | null }[],
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => {
    function query() {
      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "update",
        "delete",
        "eq",
        "is",
        "not",
        "in",
        "lte",
      ])
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
import {
  deleteForever,
  emptyTrash,
  restoreFromTrash,
} from "@/app/(app)/trash/actions";

const id = "12345678-1234-1234-1234-123456789abc";
const other = "12345678-1234-1234-1234-123456789def";
const cutoff = "2026-09-26T08:15:02.123456+00:00";
const success = (data: unknown) => ({ data, error: null });
const failure = { data: null, error: { message: "offline" } };

beforeEach(() => {
  state.user = { id: "test-user" };
  state.calls = [];
  state.responses = [];
  cache.revalidatePath.mockClear();
});

const stillDeleted = { method: "not", args: ["deleted_at", "is", null] };

describe("restoreFromTrash", () => {
  it("clears deleted_at only on rows still in Trash, and nothing else", async () => {
    state.responses.push(success([{ id }, { id: other }]));
    const result = await restoreFromTrash([id, other]);
    expect(result).toEqual({
      ok: true,
      message: "Restored 2 items to your library.",
    });
    expect(state.calls).toEqual([
      { method: "from", args: ["items"] },
      { method: "update", args: [{ deleted_at: null }] },
      { method: "in", args: ["id", [id, other]] },
      stillDeleted,
      { method: "select", args: ["id"] },
    ]);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/trash");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("reports a row that left Trash elsewhere instead of failing", async () => {
    state.responses.push(success([]));
    const result = await restoreFromTrash([id]);
    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      "One was no longer in Trash: restored, saved again or deleted forever elsewhere.",
    );
  });

  it("counts a partial restore", async () => {
    state.responses.push(success([{ id }]));
    expect((await restoreFromTrash([id, other])).message).toMatch(
      /^Restored 1 item\. One was no longer in Trash/,
    );
  });

  it("says so when the write fails", async () => {
    state.responses.push(failure);
    expect(await restoreFromTrash([id])).toEqual({
      ok: false,
      message: "Could not restore that. Try again.",
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteForever", () => {
  it("hard-deletes only rows whose deleted_at is still set", async () => {
    state.responses.push(success([{ id }]));
    expect(await deleteForever([id])).toEqual({
      ok: true,
      message: "Deleted forever.",
    });
    expect(state.calls).toEqual([
      { method: "from", args: ["items"] },
      { method: "delete", args: [] },
      { method: "in", args: ["id", [id]] },
      stillDeleted,
      { method: "select", args: ["id"] },
    ]);
  });

  it("keeps an item that was restored or re-saved after the page loaded, and says so", async () => {
    state.responses.push(success([{ id }]));
    expect((await deleteForever([id, other])).message).toBe(
      "Deleted 1 item forever. One was no longer in Trash, so it was kept.",
    );
  });

  it("says so when the delete fails", async () => {
    state.responses.push(failure);
    expect((await deleteForever([id])).ok).toBe(false);
  });
});

describe("emptyTrash", () => {
  it("deletes by predicate, bounded by the cutoff exactly as the database wrote it", async () => {
    state.responses.push({ data: null, error: null, count: 37 });
    expect(await emptyTrash(cutoff)).toEqual({
      ok: true,
      message: "Deleted 37 items forever.",
    });
    expect(state.calls).toEqual([
      { method: "from", args: ["items"] },
      { method: "delete", args: [{ count: "exact" }] },
      stillDeleted,
      { method: "lte", args: ["deleted_at", cutoff] },
    ]);
  });

  it("says when nothing was left to delete", async () => {
    state.responses.push({ data: null, error: null, count: 0 });
    expect((await emptyTrash(cutoff)).message).toContain("Nothing was deleted");
  });

  it("refuses a cutoff that is not a database timestamp, without querying", async () => {
    for (const bad of [undefined, "now()", "", 5])
      expect((await emptyTrash(bad)).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });

  it("says so when the delete fails", async () => {
    state.responses.push({ ...failure, count: null });
    expect((await emptyTrash(cutoff)).ok).toBe(false);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("every action", () => {
  it.each([
    ["restoreFromTrash", () => restoreFromTrash([id])],
    ["deleteForever", () => deleteForever([id])],
    ["emptyTrash", () => emptyTrash(cutoff)],
  ])("%s does nothing without a verified user", async (_name, run) => {
    state.user = null;
    expect(await run()).toEqual({
      ok: false,
      message: "Sign in again to change your Trash.",
    });
    expect(state.calls).toEqual([]);
  });

  it.each([
    ["restoreFromTrash", restoreFromTrash],
    ["deleteForever", deleteForever],
  ])("%s refuses malformed ids without querying", async (_name, run) => {
    for (const bad of [[], ["bad"], [id, id], id, null])
      expect((await run(bad)).ok).toBe(false);
    expect(state.calls).toEqual([]);
  });
});

describe("the Trash code's privileges", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  // Comments are stripped: the warnings about the purge name it on purpose.
  const sources = [
    "app/(app)/trash/actions.ts",
    "app/(app)/trash/page.tsx",
    "components/trash-list.tsx",
    "lib/trash.ts",
  ].map(
    (file) =>
      [
        file,
        readFileSync(join(root, file), "utf8").replace(
          /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
          "",
        ),
      ] as const,
  );

  it.each(sources)(
    "%s never uses the service role or the cross-user purge",
    (_file, source) => {
      expect(source).not.toMatch(/lib\/db\/service|createServiceSupabase/);
      expect(source).not.toMatch(/purge_deleted_items|purgeDeletedItems/);
    },
  );

  it("keeps lib/queue.ts, and its node: imports, out of the client list", () => {
    const list = sources.find(([file]) => file === "components/trash-list.tsx");
    expect(list?.[1]).not.toMatch(/lib\/queue/);
  });
});
