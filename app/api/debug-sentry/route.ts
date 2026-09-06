// Temporary. Exists to prove Sentry capture works end to end during Slice 0.
// Its removal is a checked item in docs/ROADMAP.md under Slice 8 — it is
// tracked there rather than as a comment nobody greps for.
//
// Hitting GET /api/debug-sentry should produce an event in the Sentry
// dashboard within a few seconds.

export const dynamic = "force-dynamic";

export function GET() {
  throw new Error("Sentry verification error from /api/debug-sentry");
}
