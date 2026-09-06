import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Without this, errors thrown inside React Server Components are swallowed by
// the framework and never reach Sentry.
export const onRequestError = Sentry.captureRequestError;
