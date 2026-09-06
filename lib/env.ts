/**
 * Environment access. Every variable the app reads is listed in
 * ARCHITECTURE.md section 8 and mirrored, empty, in .env.example.
 *
 * Two rules:
 *
 *   1. No placeholder fallbacks. A missing required variable throws with the
 *      variable's name in the message. Failing loudly at boot beats failing
 *      mysteriously in production at 3 a.m.
 *   2. NEXT_PUBLIC_ variables are read as literal `process.env.NEXT_PUBLIC_X`
 *      expressions. Next.js inlines those at build time by textual
 *      substitution — `process.env[someVariable]` is not substituted and
 *      arrives in the browser as undefined. That is why the name is passed
 *      alongside the value below instead of being used to look it up.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.example and docs/ARCHITECTURE.md section 8.`,
    );
  }
  return value;
}

/**
 * Safe to read from the browser. These values are compiled into the client
 * bundle. Never add a secret here.
 *
 * Validated at module load, so importing this module without a configured
 * environment throws immediately rather than producing a client that silently
 * points at `undefined`.
 */
export const publicEnv = {
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
} as const;

/**
 * Server-only secrets. A function rather than a constant so that merely
 * importing this module from a context that has no secrets — a client bundle,
 * a build step — does not throw. The throw happens when a secret is actually
 * used.
 */
export function serverEnv() {
  return {
    supabaseServiceRoleKey: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  } as const;
}

/**
 * Genuinely optional. Absent means the feature is off, and that is a supported
 * configuration — not a degraded one.
 */
export const optionalEnv = {
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
} as const;
