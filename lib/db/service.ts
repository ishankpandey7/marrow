// This import is the guard. `server-only` has no browser entry point, so any
// module graph that reaches this file from a "use client" component fails the
// build with an explicit error instead of shipping a key that bypasses RLS for
// every user to every visitor. Do not remove it, and do not re-export anything
// from this file through a module that client code imports.
import "server-only";

import { createClient } from "@supabase/supabase-js";

import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Supabase client using the service-role key. **This bypasses Row Level
 * Security entirely** and can read and write every user's data.
 *
 * Legitimate uses are exactly two: applying migrations, and cron jobs that act
 * across users. If you are reaching for it inside a request handler to make a
 * query work, the real problem is a missing or wrong RLS policy — fix that
 * instead.
 *
 * Session persistence is off: there is no user here, and a refresh loop on a
 * service key is a way to leak it into logs.
 */
export function createServiceSupabase() {
  return createClient(
    publicEnv.supabaseUrl,
    serverEnv().supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
