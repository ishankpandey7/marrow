import { beforeEach, describe, expect, it, vi } from "vitest";

type Response = { data: unknown; error: unknown };
const state = vi.hoisted(() => ({
  user: { id: "reader-user" } as { id: string } | null,
  // Keyed by table, so the item and content reads can run concurrently.
  responses: {} as Record<string, Response[]>,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));

vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from(table: string) {
      const record = (method: string, args: unknown[]) =>
        state.calls.push({ table, method, args });
      const answer = () =>
        Promise.resolve(
          state.responses[table]?.shift() ?? { data: null, error: null },
        );
      const query = {
        select: (...args: unknown[]) => (record("select", args), query),
        insert: (...args: unknown[]) => (record("insert", args), query),
        update: (...args: unknown[]) => (record("update", args), query),
        delete: (...args: unknown[]) => (record("delete", args), query),
        eq: (...args: unknown[]) => (record("eq", args), query),
        is: (...args: unknown[]) => (record("is", args), query),
        single: answer,
        maybeSingle: answer,
      };
      return query;
    },
  }),
}));

import {
  addHighlight,
  deleteHighlight,
  saveHighlightNote,
} from "@/components/reader/highlight-actions";
import { NOTE_MAX } from "@/lib/highlights";

const item = "12345678-1234-1234-1234-123456789abc";
const highlightId = "87654321-4321-4321-4321-cba987654321";
const html = "<p>The river bends.</p><p>A heron waits.</p>";
const saved = {
  id: highlightId,
  quote: "heron waits",
  note: null,
  start_offset: 19,
  end_offset: 30,
  created_at: "2026-09-25T00:00:00Z",
};

function readable() {
  state.responses.items = [{ data: { id: item }, error: null }];
  state.responses.item_content = [{ data: { html }, error: null }];
}

beforeEach(() => {
  state.user = { id: "reader-user" };
  state.responses = {};
  state.calls = [];
});

describe("addHighlight", () => {
  it("stores a highlight whose quote is the text at its offsets, for the verified user", async () => {
    readable();
    state.responses.highlights = [{ data: saved, error: null }];
    // "The river bends. A heron waits." — the separator between paragraphs counts.
    await expect(addHighlight(item, 19, 30, "heron waits")).resolves.toEqual({
      ok: true,
      highlight: saved,
    });
    expect(state.calls).toContainEqual({
      table: "highlights",
      method: "insert",
      args: [
        {
          item_id: item,
          user_id: "reader-user",
          quote: "heron waits",
          start_offset: 19,
          end_offset: 30,
        },
      ],
    });
    expect(state.calls).toContainEqual({
      table: "items",
      method: "eq",
      args: ["status", "ready"],
    });
  });

  it("refuses a quote that is not the text at those offsets, and writes nothing", async () => {
    readable();
    await expect(addHighlight(item, 20, 31, "heron waits")).resolves.toEqual({
      ok: false,
      reason: "changed",
    });
    expect(state.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("counts against today's sanitised HTML, not markup the sanitiser drops", async () => {
    state.responses.items = [{ data: { id: item }, error: null }];
    state.responses.item_content = [
      {
        data: { html: "<p>Keep<script>hidden words</script> this</p>" },
        error: null,
      },
    ];
    state.responses.highlights = [{ data: saved, error: null }];
    await expect(addHighlight(item, 0, 9, "Keep this")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses an item that is not this user's readable article", async () => {
    // RLS returns no row for another user's item, as for a missing one.
    state.responses.items = [{ data: null, error: null }];
    state.responses.item_content = [{ data: null, error: null }];
    await expect(addHighlight(item, 0, 3, "The")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    await expect(addHighlight("not-a-uuid", 0, 3, "The")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(state.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("requires a signed-in user", async () => {
    state.user = null;
    await expect(addHighlight(item, 0, 3, "The")).rejects.toThrow(/Sign in/);
  });
});

describe("saveHighlightNote", () => {
  it("updates the note and nothing else", async () => {
    state.responses.highlights = [{ data: { id: highlightId }, error: null }];
    await expect(
      saveHighlightNote(highlightId, "  why it matters "),
    ).resolves.toBe("why it matters");
    const update = state.calls.find((c) => c.method === "update");
    expect(update?.args).toEqual([{ note: "why it matters" }]);
  });

  it("clears an empty note to null", async () => {
    state.responses.highlights = [{ data: { id: highlightId }, error: null }];
    await expect(saveHighlightNote(highlightId, "   ")).resolves.toBeNull();
    expect(state.calls.find((c) => c.method === "update")?.args).toEqual([
      { note: null },
    ]);
  });

  it("refuses an oversize note or a bad id before touching the database", async () => {
    await expect(
      saveHighlightNote(highlightId, "a".repeat(NOTE_MAX + 1)),
    ).rejects.toThrow();
    await expect(saveHighlightNote("nope", "fine")).rejects.toThrow();
    expect(state.calls.some((c) => c.method === "update")).toBe(false);
  });

  it("fails when no row of this user's was updated", async () => {
    state.responses.highlights = [{ data: null, error: { code: "PGRST116" } }];
    await expect(saveHighlightNote(highlightId, "x")).rejects.toThrow();
  });
});

describe("deleteHighlight", () => {
  it("deletes by id and fails when nothing was deleted", async () => {
    state.responses.highlights = [
      { data: { id: highlightId }, error: null },
      { data: null, error: { code: "PGRST116" } },
    ];
    await expect(deleteHighlight(highlightId)).resolves.toBeUndefined();
    expect(state.calls).toContainEqual({
      table: "highlights",
      method: "eq",
      args: ["id", highlightId],
    });
    await expect(deleteHighlight(highlightId)).rejects.toThrow();
    await expect(deleteHighlight("nope")).rejects.toThrow();
  });
});
