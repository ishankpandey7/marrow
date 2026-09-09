import { ITEM_LIST_COLUMNS, type ItemListRow } from "@/lib/types";

export interface Tag {
  id: string;
  name: string;
  slug: string;
}
export interface OrganisedItem extends ItemListRow {
  favourite: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  read_at: string | null;
  item_tags: { tag_id: string }[];
}
export interface Filters {
  state: "inbox" | "archive" | "favourites";
  read: "all" | "read" | "unread";
  tag: string;
  page: number;
}
export interface LibrarySnapshot {
  loadedAt: number;
  items: OrganisedItem[];
  tags: Tag[];
  hasMore: boolean;
}
export type Mutation =
  | { kind: "archive" | "favourite"; ids: string[]; value: boolean }
  | { kind: "delete" | "restore"; ids: string[] }
  | { kind: "tag"; ids: string[]; name: string }
  | { kind: "untag"; ids: string[]; tagId: string }
  | { kind: "rename"; tagId: string; name: string };
export interface MutationResult {
  ok: boolean;
  snapshot: LibrarySnapshot | null;
  message: string | null;
}
export const PAGE_SIZE = 50;
export const ORGANISED_COLUMNS = `${ITEM_LIST_COLUMNS}, favourite, archived_at, deleted_at, read_at, item_tags(tag_id)`;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeTag(input: string): { name: string; slug: string } {
  const name = input.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if ([...name].length < 1 || [...name].length > 40)
    throw new Error("Use a tag name between 1 and 40 characters.");
  const slug = name.toLowerCase().replace(/[\s-]+/g, "-");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
    throw new Error("Use letters a–z, numbers, spaces or hyphens for tags.");
  return { name, slug };
}

export function parseFilters(input: {
  state?: unknown;
  read?: unknown;
  tag?: unknown;
  page?: unknown;
}): Filters {
  const page =
    typeof input.page === "number" ? input.page : Number(input.page ?? 1);
  return {
    state:
      input.state === "archive" || input.state === "favourites"
        ? input.state
        : "inbox",
    read: input.read === "read" || input.read === "unread" ? input.read : "all",
    tag: typeof input.tag === "string" && UUID.test(input.tag) ? input.tag : "",
    page: Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 100000) : 1,
  };
}

export function filterUrl(filters: Filters): string {
  const params = new URLSearchParams({
    state: filters.state,
    read: filters.read,
  });
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.page > 1) params.set("page", String(filters.page));
  return `/inbox?${params}`;
}

export function validateMutation(input: Mutation): Mutation {
  if (!input || typeof input !== "object") throw new Error("Invalid change.");
  if (input.kind !== "rename") {
    if (
      !("ids" in input) ||
      !Array.isArray(input.ids) ||
      input.ids.length === 0 ||
      input.ids.length > PAGE_SIZE ||
      input.ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
      new Set(input.ids).size !== input.ids.length
    )
      throw new Error("Select between 1 and 50 items.");
  }
  switch (input.kind) {
    case "archive":
    case "favourite":
      if (typeof input.value !== "boolean") throw new Error("Invalid change.");
      break;
    case "rename":
    case "untag":
      if (typeof input.tagId !== "string" || !UUID.test(input.tagId))
        throw new Error("Invalid tag.");
      break;
    case "tag":
    case "delete":
    case "restore":
      break;
    default:
      throw new Error("Invalid change.");
  }
  if (input.kind === "tag" || input.kind === "rename") {
    if (typeof input.name !== "string") throw new Error("Invalid tag.");
    normalizeTag(input.name);
  }
  return input;
}

export function matchesFilters(item: OrganisedItem, filters: Filters): boolean {
  return (
    !item.deleted_at &&
    (filters.state === "inbox"
      ? !item.archived_at
      : filters.state === "archive"
        ? !!item.archived_at
        : item.favourite) &&
    (filters.read === "all" ||
      (filters.read === "read" ? !!item.read_at : !item.read_at)) &&
    (!filters.tag || item.item_tags.some((tag) => tag.tag_id === filters.tag))
  );
}

// Replay only unconfirmed intent over the latest server snapshot. Removing a
// rejected operation restores its rows without undoing later keyboard actions.
export function applyOptimistic(
  snapshot: LibrarySnapshot,
  mutation: Mutation,
): LibrarySnapshot {
  let tags = snapshot.tags;
  let tag: Tag | undefined;
  if (mutation.kind === "tag" || mutation.kind === "rename") {
    const normalized = normalizeTag(mutation.name);
    if (mutation.kind === "rename") {
      tags = tags.map((existing) =>
        existing.id === mutation.tagId
          ? { ...existing, ...normalized }
          : existing,
      );
    } else {
      tag = tags.find((existing) => existing.slug === normalized.slug);
      if (!tag) {
        tag = { id: `pending:${normalized.slug}`, ...normalized };
        tags = [...tags, tag];
      }
    }
  }
  const items = snapshot.items.map((item) => {
    if (mutation.kind === "rename" || !mutation.ids.includes(item.id))
      return item;
    switch (mutation.kind) {
      case "archive":
        return { ...item, archived_at: mutation.value ? "pending" : null };
      case "favourite":
        return { ...item, favourite: mutation.value };
      case "delete":
        return { ...item, deleted_at: "pending" };
      case "restore":
        return { ...item, deleted_at: null };
      case "untag":
        return {
          ...item,
          item_tags: item.item_tags.filter((t) => t.tag_id !== mutation.tagId),
        };
      case "tag":
        return tag && !item.item_tags.some((t) => t.tag_id === tag.id)
          ? { ...item, item_tags: [...item.item_tags, { tag_id: tag.id }] }
          : item;
    }
  });
  return { ...snapshot, tags, items };
}

export function replayPending(
  snapshot: LibrarySnapshot,
  entries: { mutation: Mutation; restoreItems?: OrganisedItem[] }[],
): LibrarySnapshot {
  return entries.reduce((state, entry) => {
    const restored =
      entry.restoreItems?.filter(
        (item) => !state.items.some((existing) => existing.id === item.id),
      ) ?? [];
    return applyOptimistic(
      { ...state, items: [...state.items, ...restored] },
      entry.mutation,
    );
  }, snapshot);
}

export function rangeSelection(
  ids: string[],
  selected: string[],
  anchor: string | null,
  target: string,
  shift: boolean,
): string[] {
  const start = anchor ? ids.indexOf(anchor) : -1;
  const end = ids.indexOf(target);
  const range =
    shift && start >= 0 && end >= 0
      ? ids.slice(Math.min(start, end), Math.max(start, end) + 1)
      : [target];
  const next = new Set(selected);
  for (const id of range) {
    if (selected.includes(target)) next.delete(id);
    else next.add(id);
  }
  return [...next];
}
