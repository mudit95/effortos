'use client';

/**
 * Connection / outage banner.
 *
 * Renders a sticky strip at the top of the viewport when the store reports
 * `connectionStatus === 'degraded'`. The store flips into 'degraded' when:
 *
 *   - initializeApp's Supabase session/profile read throws.
 *   - fetchSubscriptionStatus 5xx's or throws (network).
 *   - any future cloud call we wire into setConnectionStatus.
 *
 * UX intent:
 *
 *   - Calm, not alarmist. The app is still usable — local state survives the
 *     outage, writes queue (see lib/offline-queue), data syncs back when the
 *     cloud is reachable.
 *   - Explicit retry. Pressing "Try again" re-runs initializeApp. If that
 *     succeeds it sets status back to 'ok' and the banner collapses out.
 *   - Auto-probe. While degraded, ping /api/health on a 30s loop so the user
 *     doesn't need to remember to retry — if the cloud comes back, the banner
 *     dismisses itself.
 *
 * No Sentry capture here — the underlying call sites already log/throw and
 * Sentry has them. This component is pure presentation + retry plumbing.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useStore } from '@/store/useStore';

const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

async function probeHealth(): Promise<boolean> {
  // Use AbortController so a stuck fetch doesn't accumulate while the user
  // sits on a degraded session — we just want a yes/no every 30s.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

export function ConnectionBanner() {
  const status = useStore((s) => s.connectionStatus);
  const initializeApp = useStore((s) => s.initializeApp);
  const setConnectionStatus = useStore((s) => s.setConnectionStatus);
  const [retrying, setRetrying] = useState(false);

  // Background auto-probe. Only runs while the banner is visible — once we
  // flip back to 'ok', the effect's cleanup tears the interval down.
  useEffect(() => {
    if (status !== 'degraded') return;
    let cancelled = false;
    const tick = async () => {
      const ok = await probeHealth();
      if (cancelled) return;
      if (ok) setConnectionStatus('ok');
    };
    // First probe fires after a short delay, not immediately — gives the user
    // a beat to read the banner before it potentially disappears.
    const initial = setTimeout(tick, 4_000);
    const interval = setInterval(tick, PROBE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [status, setConnectionStatus]);

  const onRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      // initializeApp will set 'ok' on success or re-set 'degraded' on failure.
      await Promise.resolve(initializeApp());
    } finally {
      // Small delay so the spinner is visible even on a fast success — feels
      // less janky than an instantaneous flicker.
      setTimeout(() => setRetrying(false), 600);
    }
  };

  return (
    <AnimatePresence>
      {status === 'degraded' && (
        <motion.div
          key="connection-banner"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed top-0 inset-x-0 z-[60] bg-amber-500/95 text-amber-950 backdrop-blur-sm shadow-lg"
          role="status"
          aria-live="polite"
        >
          <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <p className="flex-1 leading-snug">
              <span className="font-semibold">Trouble reaching EffortOS.</span>{' '}
              <span className="opacity-90">
                Your work is saved locally and will sync when we&apos;re back.
              </span>
            </p>
            <button
              onClick={onRetry}
              disabled={retrying}
              className="flex items-center gap-1.5 rounded-md bg-amber-950/15 hover:bg-amber-950/25 disabled:opacity-50 px-3 py-1 text-xs font-medium transition"
              aria-label="Retry connection"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
              {retrying ? 'Retrying…' : 'Try again'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
