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
 * Used for migrations, cross-user cron jobs, and the save-only extension
 * entry point. That entry point verifies a stored token hash and uses its
 * owner for both the required rate-limit scope and restricted save RPC.
 * Ordinary session requests must keep using their own RLS-scoped client.
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
