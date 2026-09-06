import * as Sentry from "@sentry/nextjs";

// Middleware and any edge route. Note that nothing security-critical runs here:
// lib/fetcher.ts requires the Node runtime (ARCHITECTURE.md section 5).
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1,
    sendDefaultPii: false,
    enableLogs: false,
  });
}
