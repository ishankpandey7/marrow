"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/db/server";
import {
  normalizeTag,
  ORGANISED_COLUMNS,
  PAGE_SIZE,
  parseFilters,
  validateMutation,
  type Filters,
  type LibrarySnapshot,
  type Mutation,
  type MutationResult,
  type OrganisedItem,
  type Tag,
} from "@/lib/tags";

type Database = Awaited<ReturnType<typeof createServerSupabase>>;

async function readLibrary(
  db: Database,
  filters: Filters,
): Promise<LibrarySnapshot> {
  const loadedAt = Date.now();
  // Align each state's predicate and leading sort with its partial index.
  // A separate relationship filters membership without hiding other tags.
  const columns = filters.tag
    ? `${ORGANISED_COLUMNS}, matched_tags:item_tags!inner(tag_id)`
    : ORGANISED_COLUMNS;
  let query = db.from("items").select(columns).is("deleted_at", null);
  if (filters.state === "archive") query = query.not("archived_at", "is", null);
  else if (filters.state === "favourites") query = query.eq("favourite", true);
  else query = query.is("archived_at", null);
  if (filters.read === "read") query = query.not("read_at", "is", null);
  else if (filters.read === "unread") query = query.is("read_at", null);
  if (filters.tag) query = query.eq("matched_tags.tag_id", filters.tag);
  const offset = (filters.page - 1) * PAGE_SIZE;
  const { data, error } = await query
    .order(filters.state === "archive" ? "archived_at" : "created_at", {
      ascending: false,
    })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE);
  if (error || !data) throw new Error("Could not load your library.");
  const tags: Tag[] = [];
  // PostgREST caps responses. Page the catalogue so autocomplete never
  // quietly forgets tags beyond that cap; keystrokes use this client snapshot.
  for (let start = 0; ; start += 500) {
    const result = await db
      .from("tags")
      .select("id, name, slug")
      .order("id")
      .range(start, start + 499);
    if (result.error || !result.data)
      throw new Error("Could not load your tags.");
    tags.push(...(result.data as Tag[]));
    if (result.data.length < 500) break;
  }
  return {
    loadedAt,
    items: (data as unknown as OrganisedItem[]).slice(0, PAGE_SIZE),
    hasMore: data.length > PAGE_SIZE,
    tags,
  };
}

export async function loadLibrary(input: Filters): Promise<{
  snapshot: LibrarySnapshot | null;
  signedOut: boolean;
  message: string | null;
}> {
  try {
    const db = await createServerSupabase();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      return {
        snapshot: null,
        signedOut: true,
        message: "Sign in again to load your library.",
      };
    return {
      snapshot: await readLibrary(db, parseFilters(input)),
      signedOut: false,
      message: null,
    };
  } catch {
    return {
      snapshot: null,
      signedOut: false,
      message: "Could not load your library. Refresh to try again.",
    };
  }
}

// Resolves to a notice for a change that went through but not in full, or
// null. Throws for a change that was not applied.
async function writeMutation(
  db: Database,
  userId: string,
  mutation: Mutation,
): Promise<string | null> {
  if (mutation.kind === "rename") {
    const normalized = normalizeTag(mutation.name);
    const { data, error } = await db
      .from("tags")
      .update(normalized)
      .eq("id", mutation.tagId)
      .select("id")
      .single();
    if (error?.code === "23505")
      throw new Error("That tag already exists. Choose another name.");
    if (error || !data) throw new Error("Could not rename that tag.");
    return null;
  }
  // The composite foreign keys from 0007 already refuse another user's item.
  // Checking here as well turns that into a readable message, and also refuses
  // trashed items, which the database would accept.
  let ownedQuery = db.from("items").select("id").in("id", mutation.ids);
  if (mutation.kind !== "restore")
    ownedQuery = ownedQuery.is("deleted_at", null);
  const owned = await ownedQuery;
  const unavailable = new Error(
    "One of those items is no longer available. The change was not applied.",
  );
  if (owned.error || !owned.data) throw unavailable;
  let ids = mutation.ids;
  let notice: string | null = null;
  if (owned.data.length !== ids.length) {
    if (mutation.kind !== "restore") throw unavailable;
    // Undo keeps its batch for as long as the page is open, and Trash (or
    // the 30-day purge) can delete one of those items for good meanwhile.
    // Refusing the whole batch would fail the same way on every click and
    // strand the rest, so bring back what is still there.
    const found = new Set(owned.data.map((row) => String(row.id)));
    ids = ids.filter((id) => found.has(id));
    const gone = mutation.ids.length - ids.length;
    notice = ids.length
      ? `${gone} of those items ${gone === 1 ? "was" : "were"} deleted forever, so only the rest came back.`
      : `${gone === 1 ? "That item was" : "Those items were"} deleted forever and cannot come back.`;
    if (!ids.length) return notice;
  }
  if (mutation.kind === "tag") {
    const normalized = normalizeTag(mutation.name);
    // Ignore duplicates instead of overwriting the existing display name.
    const created = await db
      .from("tags")
      .upsert(
        { user_id: userId, ...normalized },
        { onConflict: "user_id,slug", ignoreDuplicates: true },
      );
    if (created.error) throw new Error("Could not create that tag.");
    const tag = await db
      .from("tags")
      .select("id")
      .eq("slug", normalized.slug)
      .single();
    if (tag.error || !tag.data) throw new Error("Could not find that tag.");
    const result = await db.from("item_tags").upsert(
      mutation.ids.map((item_id) => ({
        item_id,
        tag_id: String(tag.data.id),
        user_id: userId,
      })),
      { onConflict: "item_id,tag_id", ignoreDuplicates: true },
    );
    if (result.error)
      throw new Error(
        "Could not attach that tag. The tag name may still be available to reuse.",
      );
    return null;
  }
  if (mutation.kind === "untag") {
    const result = await db
      .from("item_tags")
      .delete()
      .in("item_id", mutation.ids)
      .eq("tag_id", mutation.tagId);
    if (result.error) throw new Error("Could not remove that tag.");
    return null;
  }
  const timestamp = new Date().toISOString();
  const patch =
    mutation.kind === "archive"
      ? { archived_at: mutation.value ? timestamp : null }
      : mutation.kind === "favourite"
        ? { favourite: mutation.value }
        : { deleted_at: mutation.kind === "delete" ? timestamp : null };
  let update = db.from("items").update(patch).in("id", ids);
  if (mutation.kind !== "restore") update = update.is("deleted_at", null);
  const result = await update.select("id");
  if (result.error) throw new Error("Could not save that change.");
  if (result.data?.length !== ids.length)
    throw new Error(
      "Some items changed elsewhere. Your list has been reloaded; check the selection and try again.",
    );
  return notice;
}

export async function mutateLibrary(
  input: Mutation,
  filterInput: Filters,
): Promise<MutationResult> {
  let mutation: Mutation;
  try {
    mutation = validateMutation(input);
  } catch (error) {
    return {
      ok: false,
      snapshot: null,
      message: error instanceof Error ? error.message : "Invalid change.",
    };
  }
  try {
    const db = await createServerSupabase();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      return {
        ok: false,
        snapshot: null,
        message: "Your session expired. Sign in again before continuing.",
      };
    let message: string | null = null;
    let notice: string | null = null;
    try {
      notice = await writeMutation(db, user.id, mutation);
    } catch (error) {
      message =
        error instanceof Error ? error.message : "Could not save that change.";
    }
    revalidatePath("/inbox");
    try {
      const snapshot = await readLibrary(db, parseFilters(filterInput));
      return {
        ok: message === null,
        snapshot,
        message: message
          ? `${message} The list now shows the saved state.`
          : notice,
      };
    } catch {
      return {
        ok: false,
        snapshot: null,
        message:
          "Could not confirm the saved state. Showing the last confirmed list; reload before continuing.",
      };
    }
  } catch {
    return {
      ok: false,
      snapshot: null,
      message:
        "Connection lost. Could not confirm the change. Reload before continuing.",
    };
  }
}
