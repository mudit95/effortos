'use client';

import React from 'react';
import { useStore } from '@/store/useStore';
import { Lock, Sparkles } from 'lucide-react';
import { DISPLAY_PRICE_PER_MONTH } from '@/lib/pricing';

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

  const isActive = subscription.status === 'trialing' || subscription.status === 'active';

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
