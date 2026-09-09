import { NextResponse, type NextRequest } from "next/server";

import { createProxySupabase } from "@/lib/db/proxy";

/** Everything under these prefixes requires a session. */
const PROTECTED_PREFIXES = ["/inbox", "/read", "/settings"];

export async function proxy(request: NextRequest) {
  const { supabase, getResponse } = createProxySupabase(request);

  // getUser(), not getSession(). getSession() decodes the cookie and believes
  // it; getUser() verifies the JWT with Supabase. On the server the difference
  // is whether a forged cookie gets you in. It also performs the refresh whose
  // cookies setAll writes onto the response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !user) {
    const signIn = new URL("/auth/sign-in", request.url);
    // Carry the destination so the magic link lands where they were going,
    // instead of dumping them on the inbox and making them navigate again.
    signIn.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  // Signed in and looking at the sign-in page: nothing to do there.
  if (user && pathname === "/auth/sign-in") {
    return NextResponse.redirect(new URL("/inbox", request.url));
  }

  // Must be the response the Supabase client wrote to, or the refreshed
  // session cookies are dropped and the user is logged out an hour later.
  return getResponse();
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. The auth callback is
     * deliberately included: it needs the cookie plumbing to persist the
     * session it creates.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
