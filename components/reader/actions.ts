"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/db/server";
import { FAIL_REASON_COPY } from "@/lib/constants";
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

export async function retryReadingItem(id: string) {
  const { db } = await authenticatedClient();
  const { data, error } = await db
    .from("items")
    .select("url, canonical_url, url_hash, status, fail_reason")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  const item = data as Pick<
    Item,
    "url" | "canonical_url" | "url_hash" | "status" | "fail_reason"
  > | null;
  if (
    error ||
    !item ||
    item.status !== "failed" ||
    !item.fail_reason ||
    !FAIL_REASON_COPY[item.fail_reason].offerRetry
  ) {
    throw new Error("This saved link cannot be retried.");
  }
  const { error: retryError } = await db.rpc("save_item", {
    p_url: item.url,
    p_canonical_url: item.canonical_url,
    p_url_hash: item.url_hash,
  });
  if (retryError)
    throw new Error("Could not retry just now. Your link is still saved.");
  revalidatePath(`/read/${id}`);
}
