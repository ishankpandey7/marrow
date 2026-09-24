"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/db/server";
import { FAIL_REASON_COPY } from "@/lib/constants";
import { extractSoon } from "@/lib/extract-now";
import { SAVE_LIMIT_SQLSTATE } from "@/lib/rate-limit";
import { isRecord, mergeReaderSettings, readerSettings } from "@/lib/reading";
import type { Item } from "@/lib/types";

async function authenticatedClient() {
  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("Sign in again to save your reading preferences.");
  return { db, user };
}

export async function saveReaderSettings(input: unknown) {
  const settings = readerSettings(input);
  if (
    !isRecord(input) ||
    settings.theme !== input.theme ||
    settings.family !== input.family ||
    settings.size !== input.size
  ) {
    throw new Error("Choose one of the available reading settings.");
  }
  const { db, user } = await authenticatedClient();
  const { data, error } = await db
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .single();
  if (error || !data) throw new Error("Could not save your reading settings.");
  const { data: saved, error: writeError } = await db
    .from("profiles")
    .update({ settings: mergeReaderSettings(data.settings, settings) })
    .eq("id", user.id)
    .select("id")
    .single();
  if (writeError || !saved)
    throw new Error("Could not save your reading settings.");
  revalidatePath("/read/[id]", "page");
}

export async function saveReadingProgress(id: string, progress: number) {
  if (
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > 1
  ) {
    throw new Error("Invalid reading position.");
  }
  const { db } = await authenticatedClient();
  const { data, error } = await db
    .from("items")
    .update({ read_progress: progress })
    .eq("id", id)
    .eq("status", "ready")
    .is("deleted_at", null)
    .select("id")
    .single();
  if (error || !data) throw new Error("Could not sync your reading position.");
}

/**
 * Returned rather than thrown: production strips a Server Function's error
 * message, and "you hit the limit" is an answer the reader has to see.
 */
export type RetryOutcome = "queued" | "limited";

export async function retryReadingItem(id: string): Promise<RetryOutcome> {
  const { db, user } = await authenticatedClient();
  const { data, error } = await db
    .from("items")
    .select("status, fail_reason")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  const item = data as Pick<Item, "status" | "fail_reason"> | null;
  if (
    error ||
    !item ||
    item.status !== "failed" ||
    !item.fail_reason ||
    !FAIL_REASON_COPY[item.fail_reason].offerRetry
  ) {
    throw new Error("This saved link cannot be retried.");
  }
  // Not save_item: a re-save brings an archived item back to the inbox, and a
  // retry must only re-queue the fetch. retry_item also spends the save limit.
  const { error: retryError } = await db.rpc("retry_item", { p_item_id: id });
  if (retryError?.code === SAVE_LIMIT_SQLSTATE) return "limited";
  if (retryError)
    throw new Error("Could not retry just now. Your link is still saved.");
  // retry_item only matched a row owned by auth.uid(), so user.id is the owner.
  extractSoon(id, user.id, "read/retry");
  revalidatePath(`/read/${id}`);
  return "queued";
}
