import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabase } from "@/lib/db/server";
import { safeNext } from "@/lib/safe-next";

/**
 * Where the magic link lands.
 *
 * Supabase verifies the emailed token on its own domain and then redirects
 * here with `?code=`. That code is exchanged for a session, which sets the
 * cookies that every later request reads.
 *
 * The exchange is PKCE: it needs the code verifier cookie that was written
 * when the link was requested. That cookie lives in the browser that asked, so
 * requesting the link on a laptop and opening it on a phone cannot work. The
 * error copy says so, because "invalid request" sends people looking in
 * entirely the wrong place.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  const errorRedirect = (reason: string) =>
    NextResponse.redirect(
      new URL(`/auth/sign-in?error=${encodeURIComponent(reason)}`, request.url),
    );

  // Supabase reports a rejected or expired link by redirecting here with its
  // own error parameters rather than a code.
  const supabaseError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (supabaseError) {
    return errorRedirect(supabaseError);
  }

  if (!code) {
    return errorRedirect("That sign-in link is missing its code.");
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return errorRedirect(
      "That link could not be used. Sign-in links expire, work once, and have " +
        "to be opened in the browser that asked for them.",
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
