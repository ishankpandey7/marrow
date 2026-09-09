import { NextResponse, type NextRequest } from "next/server";

import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/**
 * Supabase client for proxy.ts, plus the response it must write cookies to.
 *
 * A Supabase session is a short-lived JWT and a refresh token. Server
 * Components cannot set cookies, so nothing there can persist a refreshed
 * token — which is why the proxy exists: it runs before the page, refreshes
 * the session, and writes the new cookies onto a response the browser actually
 * receives. Without it a signed-in user is silently logged out roughly an hour
 * after signing in.
 *
 * The response object is reassigned inside setAll rather than mutated because
 * the request's own cookies have to carry the new values forward to the page
 * render in the same pass, and NextResponse.next() snapshots them.
 */
export function createProxySupabase(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  return { supabase, getResponse: () => response };
}
