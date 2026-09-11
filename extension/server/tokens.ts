import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const TOKEN_METADATA = "id, name, created_at, revoked_at";

export interface ExtensionTokenMetadata {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
}

export function extensionTokenSecret(): string {
  const secret = process.env.EXTENSION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "EXTENSION_TOKEN_SECRET must contain at least 32 characters.",
    );
  }
  return secret;
}

export function isExtensionToken(value: string): boolean {
  return value.length === 47 && /^mrx_[A-Za-z0-9_-]{43}$/.test(value);
}

export function hashExtensionToken(token: string, secret: string): string {
  return createHmac("sha256", secret)
    .update("extension-save:v1:")
    .update(token)
    .digest("hex");
}

export async function issueExtensionToken(
  client: SupabaseClient,
  userId: string,
  name: string,
  secret: string,
): Promise<string> {
  const token = `mrx_${randomBytes(32).toString("base64url")}`;
  const { error } = await client.from("extension_tokens").insert({
    user_id: userId,
    name,
    token_hash: hashExtensionToken(token, secret),
  });
  if (error) throw new Error("Could not create the extension token.");
  return token;
}

export async function findExtensionTokenOwner(
  client: SupabaseClient,
  token: string,
  secret: string,
): Promise<string | null> {
  if (!isExtensionToken(token)) return null;
  const { data, error } = await client
    .from("extension_tokens")
    .select("user_id")
    .eq("token_hash", hashExtensionToken(token, secret))
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error("Could not verify the extension token.");
  // Identity comes only from the stored owner, never from a request field.
  return data && typeof data.user_id === "string" ? data.user_id : null;
}
