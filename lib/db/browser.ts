import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/**
 * Supabase client for Client Components. Anon key, subject to RLS.
 *
 * Call this inside the component rather than holding a module-level singleton:
 * `createBrowserClient` already memoises per browser context, and a module
 * singleton would be shared across requests during SSR.
 */
export function createBrowserSupabase() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
