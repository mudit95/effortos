/**
 * Server-runtime Sentry init. Loaded via instrumentation.ts on cold start.
 *
 * Required env vars (set in Vercel):
 *   NEXT_PUBLIC_SENTRY_DSN   — project DSN (safe to expose)
 *
 * Optional:
 *   SENTRY_ENVIRONMENT       — overrides env label (defaults to VERCEL_ENV)
 *   SENTRY_TRACES_SAMPLE_RATE — 0..1, default 0.1
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || 'development',
    // Sample 10% of transactions in prod by default; noise-vs-visibility tradeoff
    // tuned for a small product. Bump to 1.0 temporarily when debugging.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Keep PII out of breadcrumbs by default. Flip on per-event via setUser
    // in a route handler when useful.
    sendDefaultPii: false,
    // Release is auto-detected by the Sentry Next.js plugin from Vercel env
    // (VERCEL_GIT_COMMIT_SHA). No need to set manually.
  });
}
