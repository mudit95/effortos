/**
 * Browser Sentry init. Loaded automatically by the @sentry/nextjs webpack plugin.
 *
 * We deliberately keep session replay OFF — it's expensive, privacy-adjacent
 * (EffortOS handles AI reflections + subscription PII), and we don't yet
 * have the tooling to scrub it. Flip on later if debugging calls for it.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubEvent, scrubBreadcrumb } from '@/lib/sentry-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * DPDP/GDPR-friendly consent gate.
 *
 * Sentry collects breadcrumbs (URL, button-click events, console output)
 * and error context which qualifies as non-essential personal data. We
 * skip initialization entirely until the user has accepted error-tracking
 * via the ConsentBanner. Server / edge runtimes still init unconditionally —
 * those events are about our own app health, not about the visitor.
 *
 * Storage shape mirrors src/components/legal/ConsentBanner.tsx — keep in
 * sync if you change the snapshot schema there.
 */
function userConsentedToErrorTracking(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem('effortos:consent');
    if (!raw) return false;
    const snap = JSON.parse(raw) as { error_tracking?: boolean; version?: string };
    return snap.version === 'v1' && snap.error_tracking === true;
  } catch {
    return false;
  }
}

if (dsn && userConsentedToErrorTracking()) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'development',
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
    // Application-level PII scrub. See src/lib/sentry-scrub.ts for what's
    // stripped — request bodies, emails, auth headers, long strings.
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    // Explicitly disable replay; enable per-environment later if needed.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
