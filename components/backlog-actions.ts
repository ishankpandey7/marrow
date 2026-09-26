"use server";

import { revalidatePath } from "next/cache";

import { NOT_NOW_DAYS } from "@/lib/backlog";
import { createServerSupabase } from "@/lib/db/server";
import { isUuid } from "@/lib/highlights";

export interface NotNowOutcome {
  ok: boolean;
  message: string | null;
}

/**
 * Not now on the backlog strip: hide one item from it for NOT_NOW_DAYS.
 * Only resurface_after changes; the item stays exactly where it is in the
 * library. The session client and RLS keep it to the reader's own rows, and
 * an item in Trash is left alone. The answer is returned rather than thrown
 * because production strips a Server Function's error message.
 */
export async function notNow(itemId: unknown): Promise<NotNowOutcome> {
  if (!isUuid(itemId))
    return { ok: false, message: "That item is not in your library." };
  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again to change this." };
  const until = new Date(Date.now() + NOT_NOW_DAYS * 86_400_000);
  const { data, error } = await db
    .from("items")
    .update({ resurface_after: until.toISOString() })
    .eq("id", itemId)
    .is("deleted_at", null)
    .select("id");
  if (error || !data)
    return { ok: false, message: "Could not put that off. Try again." };
  if (!data.length)
    return { ok: false, message: "That item is no longer in your library." };
  revalidatePath("/inbox");
  return { ok: true, message: null };
}
