import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Anon key plus the caller's session cookie, so every query is subject to RLS
 * as that user.
 *
 * Always `await supabase.auth.getUser()` on the server, never `getSession()`.
 * `getSession()` decodes the cookie and trusts it; `getUser()` verifies the JWT
 * with Supabase. See ARCHITECTURE.md section 9.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. This is expected and not an
          // error: middleware.ts refreshes the session on every request, so the
          // write that fails here has already happened there.
        }
      },
    },
  });
}
