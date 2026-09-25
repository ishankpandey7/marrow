"use server";

import { createServerSupabase } from "@/lib/db/server";
import { toPlainText } from "@/lib/extract";
import {
  HIGHLIGHT_COLUMNS,
  cleanNote,
  highlightFits,
  isUuid,
  type SavedHighlight,
} from "@/lib/highlights";
import { sanitiseArticleHtml } from "@/lib/sanitize";

/**
 * Returned rather than thrown for the answers the reader has to see:
 * production strips a Server Function's error message.
 * - `changed`: the text at those offsets is not the quote, usually because the
 *   article was re-extracted since the page loaded.
 * - `unavailable`: the item is not a readable article of this user's.
 */
export type AddHighlightOutcome =
  | { ok: true; highlight: SavedHighlight }
  | { ok: false; reason: "changed" | "unavailable" };

async function authenticatedClient() {
  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("Sign in again to keep your highlights.");
  return { db, user };
}

export async function addHighlight(
  itemId: unknown,
  start: unknown,
  end: unknown,
  quote: unknown,
): Promise<AddHighlightOutcome> {
  if (!isUuid(itemId)) return { ok: false, reason: "unavailable" };
  const { db, user } = await authenticatedClient();
  const [itemResult, contentResult] = await Promise.all([
    db
      .from("items")
      .select("id")
      .eq("id", itemId)
      .eq("status", "ready")
      .is("deleted_at", null)
      .maybeSingle(),
    db.from("item_content").select("html").eq("item_id", itemId).maybeSingle(),
  ]);
  if (itemResult.error || contentResult.error)
    throw new Error("Could not save the highlight.");
  const html = (contentResult.data as { html: string } | null)?.html;
  if (!itemResult.data || !html) return { ok: false, reason: "unavailable" };
  // The text the reader is looking at is today's sanitised HTML, not the
  // stored item_content.text, which the sanitiser of fetch day produced.
  const text = toPlainText(sanitiseArticleHtml(html));
  if (!highlightFits(text, start, end, quote))
    return { ok: false, reason: "changed" };
  const { data, error } = await db
    .from("highlights")
    .insert({
      item_id: itemId,
      user_id: user.id,
      quote,
      start_offset: start,
      end_offset: end,
    })
    .select(HIGHLIGHT_COLUMNS)
    .single();
  if (error || !data) throw new Error("Could not save the highlight.");
  return { ok: true, highlight: data as SavedHighlight };
}

export async function saveHighlightNote(
  id: unknown,
  input: unknown,
): Promise<string | null> {
  const note = cleanNote(input);
  if (!isUuid(id) || note === undefined)
    throw new Error("That note cannot be saved.");
  const { db } = await authenticatedClient();
  // Only note is updatable by a session (0010); quote and offsets are what
  // the reader marked and never change.
  const { data, error } = await db
    .from("highlights")
    .update({ note })
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) throw new Error("Could not save the note.");
  return note;
}

export async function deleteHighlight(id: unknown): Promise<void> {
  if (!isUuid(id)) throw new Error("That highlight cannot be deleted.");
  const { db } = await authenticatedClient();
  const { data, error } = await db
    .from("highlights")
    .delete()
    .eq("id", id)
    .select("id")
    .single();
  if (error || !data) throw new Error("Could not delete the highlight.");
}
