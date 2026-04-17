import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  /* config options here */
};

/**
 * Wraps the Next.js config with Sentry's plugin. Uploads source maps during
 * production builds (when SENTRY_AUTH_TOKEN is set) and auto-injects the
 * client config. Harmless no-op if no DSN is configured.
 */
export default withSentryConfig(nextConfig, {
  // Sentry org/project — set from env so CI doesn't need to hardcode them.
  // These are safe to omit for local dev; Sentry's plugin just skips upload.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quieter build output
  silent: !process.env.CI,

  // Route browser calls to /monitoring to avoid ad-blockers dropping Sentry
  // traffic. Safe default.
  tunnelRoute: '/monitoring',

  // Don't widen the client bundle with optional Sentry features we don't use.
  widenClientFileUpload: false,
  disableLogger: true,
});
