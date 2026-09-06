import * as Sentry from "@sentry/nextjs";

// Client-side init. This file is bundled and shipped, so it may only read
// NEXT_PUBLIC_ variables. A Sentry DSN is safe to publish: it identifies a
// project and grants write access to it, nothing more.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 1,
    sendDefaultPii: false,
    // Session Replay is deliberately off. It records the DOM, and the DOM of
    // this app is what the user is reading.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
