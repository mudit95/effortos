/**
 * Browser Sentry init. Loaded automatically by the @sentry/nextjs webpack plugin.
 *
 * We deliberately keep session replay OFF — it's expensive, privacy-adjacent
 * (EffortOS handles AI reflections + subscription PII), and we don't yet
 * have the tooling to scrub it. Flip on later if debugging calls for it.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'development',
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    // Explicitly disable replay; enable per-environment later if needed.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
