import { describe, expect, it } from "vitest";
import {
  applyOptimistic,
  filterUrl,
  matchesFilters,
  normalizeTag,
  parseFilters,
  rangeSelection,
  replayPending,
  validateMutation,
  type LibrarySnapshot,
  type Mutation,
  type OrganisedItem,
} from "./tags";

const id = "12345678-1234-1234-1234-123456789abc";
const tagId = "12345678-1234-1234-1234-123456789def";
const item: OrganisedItem = {
  id,
  url: "https://example.com/article",
  canonical_url: "https://example.com/article",
  title: "Article",
  site_name: null,
  excerpt: null,
  reading_minutes: 3,
  status: "ready",
  fail_reason: null,
  created_at: "2026-09-09T10:00:00Z",
  favourite: false,
  archived_at: null,
  deleted_at: null,
  read_at: null,
  item_tags: [],
};
const snapshot: LibrarySnapshot = {
  loadedAt: 1,
  items: [item],
  tags: [],
  hasMore: false,
};

describe("pure tag identity", () => {
  it.each([
    "Deep Work",
    " deep   work ",
    "DEEP\tWORK",
    "deep\nwork",
    "deep-work",
    "Ｄｅｅｐ　Ｗｏｒｋ",
  ])("normalizes %s to one identity", (name) => {
    expect(normalizeTag(name).slug).toBe("deep-work");
  });
  it("keeps a cleaned display name and does not mutate input", () => {
    expect(normalizeTag("  Deep   Work  ")).toEqual({
      name: "Deep Work",
      slug: "deep-work",
    });
    expect(normalizeTag("a".repeat(40)).name).toHaveLength(40);
  });
  it.each([
    "",
    "   ",
    "a".repeat(41),
    "---",
    "c++",
    "café",
    "hello/world",
    "-leading",
    "trailing-",
  ])("rejects names the schema cannot store: %s", (name) => {
    expect(() => normalizeTag(name)).toThrow();
  });
  it("reuses the existing tag and does not duplicate its association", () => {
    const base = {
      ...snapshot,
      tags: [{ id: tagId, name: "Deep Work", slug: "deep-work" }],
    };
    const next = applyOptimistic(base, {
      kind: "tag",
      ids: [id],
      name: " DEEP  WORK ",
    });
    expect(next.tags).toEqual(base.tags);
    expect(next.items[0].item_tags).toEqual([{ tag_id: tagId }]);
    expect(
      applyOptimistic(next, { kind: "tag", ids: [id], name: "deep work" })
        .items[0].item_tags,
    ).toHaveLength(1);
    expect(base.items[0].item_tags).toEqual([]);
  });
});

describe("URL filters and bounded mutations", () => {
  it("round trips every filter through the URL", () => {
    const filters = parseFilters({
      state: "archive",
      read: "unread",
      tag: tagId,
      page: "20",
    });
    expect(
      parseFilters(
        Object.fromEntries(
          new URL(filterUrl(filters), "https://example.com").searchParams,
        ),
      ),
    ).toEqual(filters);
  });
  it("rejects malformed, repeated and unbounded query parameters", () => {
    expect(
      parseFilters({
        state: ["archive"],
        tag: "malformed",
        page: "-1",
        read: "false",
      }),
    ).toEqual({ state: "inbox", tag: "", page: 1, read: "all" });
    expect(parseFilters({ page: Infinity }).page).toBe(1);
  });
  it("rejects forged action payloads before database access", () => {
    for (const value of [
      null,
      {},
      { kind: "drop", ids: [id] },
      { kind: "delete", ids: [] },
      { kind: "delete", ids: [id, id] },
      { kind: "archive", ids: [id], value: "false" },
      { kind: "rename", tagId, name: "" },
    ]) {
      expect(() => validateMutation(value as Mutation)).toThrow();
    }
    expect(validateMutation({ kind: "delete", ids: [id] })).toEqual({
      kind: "delete",
      ids: [id],
    });
  });
  it("intersects read status and tag with the indexed state, always excluding deleted rows", () => {
    const tagged = {
      ...item,
      favourite: true,
      archived_at: "2026-09-09",
      item_tags: [{ tag_id: tagId }],
    };
    expect(
      matchesFilters(
        tagged,
        parseFilters({ state: "favourites", tag: tagId, read: "unread" }),
      ),
    ).toBe(true);
    expect(matchesFilters(tagged, parseFilters({ state: "inbox" }))).toBe(
      false,
    );
    expect(
      matchesFilters(
        { ...tagged, deleted_at: "2026-09-09" },
        parseFilters({ state: "favourites" }),
      ),
    ).toBe(false);
  });
});

describe("optimistic reconciliation", () => {
  it("rolls back a rejected archive while preserving a later favourite", () => {
    const favourite: Mutation = { kind: "favourite", ids: [id], value: true };
    const optimistic = replayPending(snapshot, [
      { mutation: { kind: "archive", ids: [id], value: true } },
      { mutation: favourite },
    ]);
    expect(matchesFilters(optimistic.items[0], parseFilters({}))).toBe(false);
    const reconciled = replayPending(snapshot, [{ mutation: favourite }]);
    expect(reconciled.items[0]).toMatchObject({
      archived_at: null,
      favourite: true,
    });
    expect(snapshot.items[0].favourite).toBe(false);
  });
  it("keeps undo visible while an earlier delete response removes the row from the page", () => {
    const empty = { ...snapshot, items: [] };
    const restored = replayPending(empty, [
      { mutation: { kind: "restore", ids: [id] }, restoreItems: [item] },
    ]);
    expect(restored.items).toEqual([item]);
    expect(replayPending(empty, []).items).toEqual([]);
  });
  it("a failed rename or removal restores the original tag and association", () => {
    const base = {
      ...snapshot,
      tags: [{ id: tagId, name: "Work", slug: "work" }],
      items: [{ ...item, item_tags: [{ tag_id: tagId }] }],
    };
    expect(
      applyOptimistic(base, { kind: "rename", tagId, name: "Reading" }).tags[0]
        .name,
    ).toBe("Reading");
    expect(
      applyOptimistic(base, { kind: "untag", ids: [id], tagId }).items[0]
        .item_tags,
    ).toEqual([]);
    expect(replayPending(base, [])).toEqual(base);
  });
  it("supports forward and reverse shift ranges and deselection", () => {
    const ids = ["a", "b", "c", "d"];
    expect(rangeSelection(ids, ["a"], "a", "c", true)).toEqual(["a", "b", "c"]);
    expect(rangeSelection(ids, ["d"], "d", "b", true)).toEqual(["d", "b", "c"]);
    expect(rangeSelection(ids, ["a", "b", "c"], "a", "c", true)).toEqual([]);
    expect(rangeSelection(ids, [], "missing", "b", true)).toEqual(["b"]);
  });
});
