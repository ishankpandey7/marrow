"use server";

import { redirect } from "next/navigation";

import type { SignInState } from "@/app/auth/state";
import { createServerSupabase } from "@/lib/db/server";
import { publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";

export async function sendMagicLink(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const next = safeNext(String(formData.get("next") ?? ""));

  // Deliberately shallow. Real validation is whether the mail arrives, and a
  // clever regex only ever rejects addresses that turn out to be valid.
  if (!email || !email.includes("@") || email.startsWith("@")) {
    return {
      status: "error",
      message: "That does not look like an email address.",
    };
  }

  const supabase = await createServerSupabase();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      // No implicit signup would mean an unknown address silently does
      // nothing. Letting it create the account is the whole flow: there is no
      // password, so signing up and signing in are the same action.
      shouldCreateUser: true,
    },
  });

  if (error) {
    // Rate limiting is the common one, and Supabase words it usefully, so it
    // is passed through rather than flattened into "something went wrong".
    return { status: "error", message: error.message };
  }

  return { status: "sent", email };
}

export async function signOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/");
}
