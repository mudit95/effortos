'use client';

import React from 'react';
import { useStore } from '@/store/useStore';
import { Lock, Sparkles } from 'lucide-react';
import { DISPLAY_PRICE_PER_MONTH } from '@/lib/pricing';

/**
 * Mirror of subscription-guard.PAST_DUE_GRACE_DAYS — kept here as a
 * separate constant so the client doesn't depend on a server-only file.
 * Bump both together if the policy changes.
 */
const PAST_DUE_GRACE_DAYS = 7;
const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Wraps any UI that should only be visible to subscribed users.
 * - `trialing` / `active`  → renders children normally
 * - everything else        → renders children blurred + non-interactive,
 *                            with a "Subscribe to continue" overlay
 */
export function PremiumGate({
  children,
  label,
  className = '',
  minHeight,
}: {
  children: React.ReactNode;
  /** Short label shown on the overlay, e.g. "AI Motivation" */
  label?: string;
  className?: string;
  /** Optional min-height for the wrapper (useful for small cards) */
  minHeight?: string;
}) {
  const subscription = useStore(s => s.subscription);
  const subscriptionLoading = useStore(s => s.subscriptionLoading);
  const setShowPaywall = useStore(s => s.setShowPaywall);

  // User has premium access if:
  //   (a) any status with a future current_period_end, OR
  //   (b) status is trialing with a future trial end, OR
  //   (c) status is active (fallback when period end not yet set), OR
  //   (d) status is past_due AND we're inside the grace window past
  //       current_period_end (Razorpay is retrying the failed charge —
  //       give the user time to update their card before hard-blocking).
  const now = new Date();
  const periodEndMs = subscription.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : null;
  const hasFuturePeriodEnd = periodEndMs != null && periodEndMs > now.getTime();
  const hasFutureTrial =
    !!subscription.trial_ends_at && new Date(subscription.trial_ends_at) > now;
  const inPastDueGrace =
    subscription.status === 'past_due' &&
    periodEndMs != null &&
    now.getTime() < periodEndMs + PAST_DUE_GRACE_MS;
  // Paused (mig 034) is explicitly NOT active — the user opted out of
  // premium until they resume. Razorpay keeps current_period_end alive
  // during pause, so we have to short-circuit before the period-end
  // fast-path or every paused user would still see premium content.
  const isPaused = subscription.status === 'paused';
  const isActive =
    !isPaused && (
      hasFuturePeriodEnd ||
      (subscription.status === 'trialing' && hasFutureTrial) ||
      subscription.status === 'active' ||
      inPastDueGrace
    );

  // While we're still figuring out subscription state, don't show a gate
  // (prevents flash of "Subscribe" for paying users).
  if (subscriptionLoading || isActive) {
    return <>{children}</>;
  }

  return (
    <div
      className={`relative ${className}`}
      style={minHeight ? { minHeight } : undefined}
    >
      {/* The real content, blurred and inert */}
      <div
        aria-hidden
        className="pointer-events-none select-none blur-md saturate-50 opacity-60"
      >
        {children}
      </div>

      {/* Overlay */}
      <button
        type="button"
        onClick={() => setShowPaywall(true)}
        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/40 backdrop-blur-[2px] border border-white/[0.06] hover:bg-black/50 transition-colors cursor-pointer group"
      >
        <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-400/30 flex items-center justify-center group-hover:scale-110 transition-transform">
          <Lock className="w-4 h-4 text-cyan-300" />
        </div>
        <div className="text-center px-4">
          {label && (
            <p className="text-[11px] text-white/40 uppercase tracking-wider mb-0.5">{label}</p>
          )}
          <p className="text-sm font-semibold text-white flex items-center justify-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Subscribe to continue
          </p>
          <p className="text-[11px] text-white/50 mt-0.5">
            {DISPLAY_PRICE_PER_MONTH} · 3-day free trial
          </p>
        </div>
      </button>
    </div>
  );
}
