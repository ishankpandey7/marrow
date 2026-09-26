"use server";

import { revalidatePath } from "next/cache";

import { createServerSupabase } from "@/lib/db/server";
import { trashCutoff, trashIds } from "@/lib/trash";

/**
 * Trash's three actions (Slice 12). All of them run on the session client,
 * so RLS confines every statement to the signed-in user's rows. Never the
 * service role, and never purge_deleted_items: that function takes no user
 * and would empty everyone's trash.
 *
 * The page they act on went stale the moment it rendered. A re-save from
 * the web or the extension resurrects a trashed item, and so does a restore
 * in another tab. So every statement repeats "deleted_at is not null" and a
 * row that no longer matches is reported, not treated as an error.
 *
 * The answer is returned rather than thrown because production strips a
 * Server Function's error message, and the reader has to see it.
 */
export interface TrashOutcome {
  ok: boolean;
  message: string;
}

const SIGNED_OUT: TrashOutcome = {
  ok: false,
  message: "Sign in again to change your Trash.",
};

async function signedInClient() {
  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  return user ? db : null;
}

function items(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

function refreshLists() {
  revalidatePath("/trash");
  revalidatePath("/inbox");
}

export async function restoreFromTrash(input: unknown): Promise<TrashOutcome> {
  const ids = trashIds(input);
  if (!ids) return { ok: false, message: "Choose something to restore." };
  const db = await signedInClient();
  if (!db) return SIGNED_OUT;
  // deleted_at is all that changes. An archived item goes back to Archive,
  // and every item keeps its place in the list, which sorts by created_at.
  const { data, error } = await db
    .from("items")
    .update({ deleted_at: null })
    .in("id", ids)
    .not("deleted_at", "is", null)
    .select("id");
  if (error || !data)
    return { ok: false, message: "Could not restore that. Try again." };
  refreshLists();
  const missed = ids.length - data.length;
  if (!missed)
    return {
      ok: true,
      message:
        ids.length === 1
          ? "Restored. It is back in your library, where it was before."
          : `Restored ${items(ids.length)} to your library.`,
    };
  return {
    ok: true,
    message: `${data.length ? `Restored ${items(data.length)}. ` : ""}${
      missed === 1 ? "One was" : `${missed} were`
    } no longer in Trash: restored, saved again or deleted forever elsewhere.`,
  };
}

export async function deleteForever(input: unknown): Promise<TrashOutcome> {
  const ids = trashIds(input);
  if (!ids) return { ok: false, message: "Choose something to delete." };
  const db = await signedInClient();
  if (!db) return SIGNED_OUT;
  // item_content, item_tags, highlights and fetch_jobs cascade from items.
  // None of them has a delete policy for sessions; the cascade runs anyway,
  // verified live on 2026-09-26.
  const { data, error } = await db
    .from("items")
    .delete()
    .in("id", ids)
    .not("deleted_at", "is", null)
    .select("id");
  if (error || !data)
    return { ok: false, message: "Could not delete that. Try again." };
  refreshLists();
  const missed = ids.length - data.length;
  if (!missed)
    return {
      ok: true,
      message:
        ids.length === 1
          ? "Deleted forever."
          : `Deleted ${items(ids.length)} forever.`,
    };
  // A row can be missing because it came back to life, or because another
  // tab or the purge already deleted it. The reply cannot tell which, so it
  // must not promise the row was kept.
  return {
    ok: true,
    message: `${data.length ? `Deleted ${items(data.length)} forever. ` : ""}${
      missed === 1 ? "One was" : `${missed} were`
    } no longer in Trash: restored, saved again or already deleted forever.`,
  };
}

/**
 * Empties the trash up to `cutoff`: the newest deleted_at the page read,
 * exactly as the database wrote it. Anything trashed after that, in another
 * tab or on another device, was never shown to the reader and stays. The
 * delete goes by predicate rather than by the ids on screen because the
 * trash can run to more than one page.
 */
export async function emptyTrash(cutoffInput: unknown): Promise<TrashOutcome> {
  const cutoff = trashCutoff(cutoffInput);
  if (!cutoff)
    return {
      ok: false,
      message: "This page is out of date. Reload it and try again.",
    };
  const db = await signedInClient();
  if (!db) return SIGNED_OUT;
  // count rather than returned rows, so no response cap can hide a row.
  const { count, error } = await db
    .from("items")
    .delete({ count: "exact" })
    .not("deleted_at", "is", null)
    .lte("deleted_at", cutoff);
  if (error)
    return { ok: false, message: "Could not empty the trash. Try again." };
  refreshLists();
  if (count === null) return { ok: true, message: "Trash emptied." };
  return {
    ok: true,
    message: count
      ? `Deleted ${items(count)} forever.`
      : "Nothing was deleted: those items had already left Trash.",
  };
}
