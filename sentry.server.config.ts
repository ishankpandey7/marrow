import * as Sentry from "@sentry/nextjs";

// Absent DSN means error reporting is off, and that is a supported
// configuration — see ARCHITECTURE.md section 8. Guarding here rather than
// passing `dsn: undefined` keeps the console clean when running without keys.
const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Dial this down once there is real traffic. At launch volume, complete
    // traces are worth more than the quota they cost.
    tracesSampleRate: 1,
    // Do not attach IP addresses, cookies or headers to events. This app knows
    // what people read; that is not data to leak into an error tracker.
    sendDefaultPii: false,
    enableLogs: false,
  });
}
