// From @sentry/nextjs/config, not @sentry/nextjs: the latter is deprecated for
// this import and stops working in v11.
import { withSentryConfig } from "@sentry/nextjs/config";
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

// withSentryConfig is applied unconditionally, and that is not a style choice.
// It is the thing that pulls instrumentation-client.ts into the client bundle
// and configures server-side instrumentation; without it the SDK is inert no
// matter how correct the DSN is. Making the wrapper conditional on SENTRY_ORG
// and SENTRY_PROJECT — which are needed only to *upload source maps* — silently
// disabled error reporting entirely. That bug shipped, and the symptom was an
// empty Sentry project while /api/debug-sentry returned a healthy 500.
//
// Only the upload is conditional now. Without the three credentials it needs,
// the plugin skips that step and instrumentation still happens.
const sourcemapUploadConfigured = Boolean(
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT &&
  process.env.SENTRY_AUTH_TOKEN,
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !sourcemapUploadConfigured,
    // Uploaded to Sentry, then removed from the build output, so stack traces
    // are readable in Sentry and not served to the public internet.
    deleteSourcemapsAfterUpload: true,
  },
  silent: !process.env.CI,
  telemetry: false,
  // No disableLogger: it is deprecated, and its replacement
  // (webpack.treeshake.removeDebugLogging) does nothing under Turbopack, which
  // is what Next 16 builds with.
});
