'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * First-visit cookie / data-processing consent banner.
 *
 * What it asks for:
 *   - analytics:      product analytics (PostHog/Plausible when wired)
 *   - error_tracking: Sentry error events
 *   - marketing:      lifecycle / promotional email beyond transactional
 *
 * Strictly necessary stuff (auth, billing, transactional email tied to
 * billing) is not gated — those are core service. Only the optional
 * processing categories appear here.
 *
 * Storage:
 *   - localStorage  : effortos:consent → snapshot for fast page loads
 *   - cookie        : effortos_anon=<UUID>; SameSite=Lax; 1 year
 *                     (lets pre-signup consent be tied to a future account)
 *   - server        : consent_log table via /api/consent
 *
 * Display rules:
 *   - First visit (no localStorage entry) → show.
 *   - Returning visitor with banner_version unchanged → don't show.
 *   - Returning visitor with banner_version bumped → show again so the
 *     new wording gets a fresh consent decision (DPDP §6 implication).
 *
 * Other modules check the consent state via window.localStorage; in
 * particular sentry.client.config.ts will read it when we gate Sentry on
 * accept (handled in a follow-up step).
 */

const BANNER_VERSION = 'v1';
const STORAGE_KEY = 'effortos:consent';
const ANON_COOKIE = 'effortos_anon';
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

interface ConsentSnapshot {
  version: string;
  analytics: boolean;
  error_tracking: boolean;
  marketing: boolean;
  decided_at: number;
}

function readSnapshot(): ConsentSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as Partial<ConsentSnapshot>;
    if (typeof snap.version !== 'string') return null;
    return snap as ConsentSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: ConsentSnapshot) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    // private mode quotas — ignore, the server log is the source of truth.
  }
}

/** Read or mint the long-lived anonymous-id cookie. */
function getAnonId(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)effortos_anon=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);

  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.cookie = `${ANON_COOKIE}=${encodeURIComponent(fresh)}; path=/; max-age=${ANON_COOKIE_MAX_AGE}; SameSite=Lax`;
  return fresh;
}

export function ConsentBanner() {
  const [show, setShow] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const snap = readSnapshot();
    if (!snap || snap.version !== BANNER_VERSION) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  async function persist(decision: { analytics: boolean; error_tracking: boolean; marketing: boolean }) {
    setSubmitting(true);
    const snap: ConsentSnapshot = {
      version: BANNER_VERSION,
      analytics: decision.analytics,
      error_tracking: decision.error_tracking,
      marketing: decision.marketing,
      decided_at: Date.now(),
    };
    writeSnapshot(snap);
    try {
      await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...decision,
          anonymous_id: getAnonId(),
          banner_version: BANNER_VERSION,
        }),
      });
    } catch {
      // server write failed — the localStorage snapshot still works for the
      // current device, and the user can retry on next page load if needed.
    }
    setShow(false);
    setSubmitting(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie and data-processing consent"
      className="fixed inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-w-sm z-[70] rounded-2xl border border-white/[0.08] bg-[#0e131a]/95 backdrop-blur-xl shadow-2xl p-4"
    >
      <p className="text-xs font-semibold text-white/80 mb-1.5">Privacy &amp; cookies</p>
      <p className="text-[12px] leading-relaxed text-white/55">
        We use cookies and a few service providers to run EffortOS — sign-in, billing, and the
        emails you ask for. We&rsquo;d also like your permission for product analytics and error
        tracking so we can fix things faster. You can change this any time in Settings.
      </p>
      <p className="text-[11px] text-white/35 mt-2">
        Details:{' '}
        <Link href="/legal/privacy" className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
      </p>
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <Button
          size="sm"
          onClick={() => persist({ analytics: true, error_tracking: true, marketing: false })}
          disabled={submitting}
          className="flex-1"
        >
          Accept
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => persist({ analytics: false, error_tracking: false, marketing: false })}
          disabled={submitting}
          className="flex-1"
        >
          Reject non-essential
        </Button>
      </div>
    </div>
  );
}

/**
 * Read the user's current consent for a given scope. Server-side code
 * shouldn't use this — it's for client modules that gate behaviour on
 * consent (Sentry init, analytics init).
 *
 * Returns false (deny) when no decision has been made yet — sane default
 * under DPDP/GDPR.
 */
export function readConsent(scope: 'analytics' | 'error_tracking' | 'marketing'): boolean {
  const snap = readSnapshot();
  if (!snap || snap.version !== BANNER_VERSION) return false;
  return snap[scope] === true;
}
