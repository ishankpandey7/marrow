import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type errors fail the build. The alternative — ignoring them here and
  // relying on CI — means a broken build can still deploy from a laptop.
  //
  // There is no matching `eslint` key: Next 16 removed `next lint` and rejects
  // the option outright. Linting is a separate CI step, `npm run lint`.
  typescript: { ignoreBuildErrors: false },

  // Security headers. The Content-Security-Policy is deliberately absent until
  // Slice 8: adding one halfway through breaks things silently and the slice
  // that adds it is the slice that verifies it on the deployed site.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

// Only wrap when Sentry is actually configured. Wrapping unconditionally means
// every keyless build — CI, a fresh clone, a contributor — prints upload
// warnings for a step that cannot run.
const sentryConfigured = Boolean(
  process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default sentryConfigured
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      // Source maps are uploaded to Sentry and then deleted from the build
      // output, so stack traces are readable in Sentry and not on the public
      // internet.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      silent: !process.env.CI,
      telemetry: false,
      disableLogger: true,
    })
  : nextConfig;
