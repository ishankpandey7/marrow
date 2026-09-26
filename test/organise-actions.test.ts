import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseFilters, type Mutation } from "@/lib/tags";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  user: { id: "test-user" } as { id: string } | null,
  calls: [] as { method: string; args: unknown[] }[],
  responses: [] as { data: unknown; error: unknown }[],
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => {
    function query() {
      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "update",
        "upsert",
        "delete",
        "eq",
        "is",
        "not",
        "in",
        "order",
        "range",
        "single",
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
import { loadLibrary, mutateLibrary } from "@/app/(app)/actions";

const id = "12345678-1234-1234-1234-123456789abc";
const tagId = "12345678-1234-1234-1234-123456789def";
const filters = parseFilters({});
const success = (data: unknown) => ({ data, error: null });
beforeEach(() => {
  state.user = { id: "test-user" };
  state.calls = [];
  state.responses = [];
});

describe("indexed and paginated library queries", () => {
  for (const view of ["inbox", "archive", "favourites"])
    for (const read of ["all", "read", "unread"])
      for (const tag of ["", tagId]) {
        it(`${view} / ${read} / ${tag ? "tagged" : "all tags"}`, async () => {
          const result = await loadLibrary(
            parseFilters({ state: view, read, tag, page: 20 }),
          );
          expect(result.message).toBeNull();
          expect(state.calls).toContainEqual({
            method: "is",
            args: ["deleted_at", null],
          });
          expect(state.calls).toContainEqual({
            method:
              view === "archive" ? "not" : view === "favourites" ? "eq" : "is",
            args:
              view === "archive"
                ? ["archived_at", "is", null]
                : view === "favourites"
                  ? ["favourite", true]
                  : ["archived_at", null],
          });
          expect(state.calls).toContainEqual({
            method: "order",
            args: [
              view === "archive" ? "archived_at" : "created_at",
              { ascending: false },
            ],
          });
          expect(state.calls).toContainEqual({
            method: "range",
            args: [950, 1000],
          });
          if (read !== "all")
            expect(state.calls).toContainEqual({
              method: read === "read" ? "not" : "is",
              args:
                read === "read" ? ["read_at", "is", null] : ["read_at", null],
            });
          if (tag) {
            expect(state.calls).toContainEqual({
              method: "eq",
              args: ["matched_tags.tag_id", tagId],
            });
            expect(
              String(
                state.calls.find((call) => call.method === "select")?.args[0],
              ),
            ).toContain(
              "item_tags(tag_id), matched_tags:item_tags!inner(tag_id)",
            );
          }
          expect(
            state.calls.some(
              (call) =>
                call.method === "from" && call.args[0] === "item_content",
            ),
          ).toBe(false);
        });
      }
  it("uses the 51st row as a sentinel and returns only 50", async () => {
    state.responses.push(
      success(
        Array.from({ length: 51 }, (_, index) => ({ id: String(index) })),
      ),
      success([]),
    );
    const result = await loadLibrary(filters);
    expect(result.snapshot?.items).toHaveLength(50);
    expect(result.snapshot?.hasMore).toBe(true);
  });
  it("loads tags past a response cap without a per-keystroke endpoint", async () => {
    state.responses.push(
      success([]),
      success(
        Array.from({ length: 500 }, (_, index) => ({
          id: String(index),
          name: `Tag ${index}`,
          slug: `tag-${index}`,
        })),
      ),
      success([{ id: tagId, name: "Last", slug: "last" }]),
    );
    expect((await loadLibrary(filters)).snapshot?.tags).toHaveLength(501);
    expect(state.calls).toContainEqual({ method: "range", args: [500, 999] });
  });
});

describe("authenticated mutations and authoritative failure responses", () => {
  it("does not query without a verified user", async () => {
    state.user = null;
    expect(
      (await mutateLibrary({ kind: "delete", ids: [id] }, filters)).ok,
    ).toBe(false);
    expect(state.calls).toEqual([]);
  });
  it("rejects malformed payloads without querying", async () => {
    expect(
      (await mutateLibrary({ kind: "delete", ids: ["bad"] }, filters)).ok,
    ).toBe(false);
    expect(state.calls).toEqual([]);
  });
  it.each<Mutation>([
    { kind: "archive", ids: [id], value: true },
    { kind: "archive", ids: [id], value: false },
    { kind: "favourite", ids: [id], value: true },
    { kind: "delete", ids: [id] },
    { kind: "restore", ids: [id] },
  ])("returns a fresh snapshot for $kind", async (mutation) => {
    state.responses.push(
      success([{ id }]),
      success([{ id }]),
      success([]),
      success([]),
    );
    const result = await mutateLibrary(mutation, filters);
    expect(result).toEqual({
      ok: true,
      snapshot: {
        loadedAt: expect.any(Number),
        items: [],
        tags: [],
        hasMore: false,
      },
      message: null,
    });
    expect(state.calls.some((call) => call.method === "delete")).toBe(false);
    const patch = state.calls.find((call) => call.method === "update")?.args[0];
    if (mutation.kind === "restore")
      expect(patch).toEqual({ deleted_at: null });
    if (mutation.kind === "delete")
      expect(patch).toEqual({
        deleted_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
  });
  it("returns the saved list on an RLS rejection, with visible rollback copy", async () => {
    state.responses.push(
      success([{ id }]),
      { data: null, error: { code: "42501" } },
      success([{ id, favourite: false }]),
      success([]),
    );
    const result = await mutateLibrary(
      { kind: "favourite", ids: [id], value: true },
      filters,
    );
    expect(result.ok).toBe(false);
    expect(result.snapshot?.items).toEqual([{ id, favourite: false }]);
    expect(result.message).toContain("saved state");
  });
  it("reports uncertainty when a committed mutation cannot be read back", async () => {
    state.responses.push(success([{ id }]), success([{ id }]), {
      data: null,
      error: { message: "offline" },
    });
    const result = await mutateLibrary({ kind: "delete", ids: [id] }, filters);
    expect(result.snapshot).toBeNull();
    expect(result.message).toContain("Could not confirm");
  });
  it("restores what is left of an Undo batch when part of it was deleted forever", async () => {
    state.responses.push(
      success([{ id }]),
      success([{ id }]),
      success([]),
      success([]),
    );
    const result = await mutateLibrary(
      { kind: "restore", ids: [id, tagId] },
      filters,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      "1 of those items was deleted forever, so only the rest came back.",
    );
    expect(state.calls).toContainEqual({ method: "in", args: ["id", [id]] });
    expect(state.calls).toContainEqual({
      method: "update",
      args: [{ deleted_at: null }],
    });
  });
  it("settles an Undo whose whole batch was deleted forever without writing", async () => {
    state.responses.push(success([]), success([]), success([]));
    const result = await mutateLibrary(
      { kind: "restore", ids: [id, tagId] },
      filters,
    );
    expect(result).toMatchObject({
      ok: true,
      message: "Those items were deleted forever and cannot come back.",
    });
    expect(state.calls.some((call) => call.method === "update")).toBe(false);
  });
  it("still refuses a partial batch for every change other than restore", async () => {
    state.responses.push(success([{ id }]), success([]), success([]));
    const result = await mutateLibrary(
      { kind: "delete", ids: [id, tagId] },
      filters,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no longer available");
    expect(state.calls.some((call) => call.method === "update")).toBe(false);
  });
  it("does not attach tags to unowned or deleted items", async () => {
    state.responses.push(success([]), success([]), success([]));
    expect(
      (await mutateLibrary({ kind: "tag", ids: [id], name: "Work" }, filters))
        .ok,
    ).toBe(false);
    expect(state.calls.some((call) => call.method === "upsert")).toBe(false);
  });
  it("creates one normalized tag and attaches the canonical id, with conflict-safe bulk insertion", async () => {
    state.responses.push(
      success([{ id }]),
      success(null),
      success({ id: tagId }),
      success(null),
      success([]),
      success([]),
    );
    expect(
      (
        await mutateLibrary(
          { kind: "tag", ids: [id], name: " DEEP  Work " },
          filters,
        )
      ).ok,
    ).toBe(true);
    expect(state.calls).toContainEqual({
      method: "upsert",
      args: [
        { user_id: "test-user", name: "DEEP Work", slug: "deep-work" },
        { onConflict: "user_id,slug", ignoreDuplicates: true },
      ],
    });
    expect(state.calls).toContainEqual({
      method: "upsert",
      args: [
        [{ user_id: "test-user", item_id: id, tag_id: tagId }],
        { onConflict: "item_id,tag_id", ignoreDuplicates: true },
      ],
    });
  });
  it("reconciles a rename collision without merging or losing associations", async () => {
    state.responses.push(
      { data: null, error: { code: "23505" } },
      success([]),
      success([{ id: tagId, name: "Original", slug: "original" }]),
    );
    const result = await mutateLibrary(
      { kind: "rename", tagId, name: "Existing" },
      filters,
    );
    expect(result.ok).toBe(false);
    expect(result.snapshot?.tags[0].name).toBe("Original");
    expect(result.message).toContain("already exists");
  });
});
