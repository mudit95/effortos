'use client';

/**
 * FreeDashboardCallout
 *
 * Replaces the prior UX for non-paying users where they landed on a heavily
 * blurred dashboard with no clear story about what they had vs. what unlocked
 * on subscribe. The fix has two parts:
 *
 *   1. This callout — a single, dismissible card that renders above the
 *      mode toggle when subscription is `none`, `expired`, or `cancelled`.
 *      It owns the "free vs. paid" mental model: explicit list of what's
 *      yours today, explicit list of what unlocks on trial, single primary
 *      CTA, single secondary CTA pointing at the WhatsApp wedge.
 *
 *   2. Softer paywall behaviour for `expired` users — handled in Dashboard.tsx
 *      with a sessionStorage gate so the modal stops auto-popping on every
 *      refresh. Once is informative; on every refresh it's nagware.
 *
 * Why a callout and not a full page rework: the dashboard already contains
 * value-adjacent affordances (timer, journal, goal progress) that work for
 * free users. The bug was framing, not surface area. A callout reframes
 * without hiding the working bits.
 *
 * Hidden after the user dismisses (sessionStorage). Hidden completely for
 * trialing/active subscribers via the early return.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Sparkles, X, Check, MessageCircle } from 'lucide-react';
import { DISPLAY_PRICE_PER_MONTH } from '@/lib/pricing';

const DISMISS_KEY = 'effortos:free-callout:dismissed';

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

export function FreeDashboardCallout() {
  const subscription = useStore((s) => s.subscription);
  const subscriptionLoading = useStore((s) => s.subscriptionLoading);
  const setShowPaywall = useStore((s) => s.setShowPaywall);
  const setShowSettings = useStore((s) => s.setShowSettings);

  // Local dismissal — re-renders fine because we read on mount and update on
  // click. We don't subscribe to storage events; the user only dismisses from
  // their own tab, so it stays consistent within a session.
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  if (subscriptionLoading) return null;
  if (dismissed) return null;

  // Only show for users without active premium or trial.
  const status = subscription.status;
  const isFree = status === 'none' || status === 'expired' || status === 'cancelled';
  if (!isFree) return null;

  // Distinct copy for "never tried" vs "trial expired" — the second cohort
  // already saw the value, so emphasise *resuming* rather than discovery.
  const isPostTrial = status === 'expired' || status === 'cancelled';
  const heading = isPostTrial ? 'Pick up where you left off' : 'You\'re on the free plan';
  const subhead = isPostTrial
    ? 'Restart your subscription to bring back the planner, reports, AI coach and WhatsApp bot.'
    : 'Timer and goal tracking are yours forever. The pieces below unlock with a free 3-day trial.';

  const onDismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        key="free-callout"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className="relative mb-4 sm:mb-6 rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.05] via-blue-500/[0.04] to-transparent p-4 sm:p-5"
      >
        <button
          onClick={onDismiss}
          aria-label="Dismiss callout"
          className="absolute top-2 right-2 p-1.5 rounded-md text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          {/* Lead column — heading + the two lists */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-white">{heading}</h3>
            </div>
            <p className="text-xs sm:text-sm text-white/55 leading-relaxed mb-3">
              {subhead}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              <FreeList
                title="Free, forever"
                items={['Pomodoro timer', 'Goal tracking', 'Journal entries']}
                tone="neutral"
              />
              <FreeList
                title="Unlocks on trial"
                items={['Daily planner', 'Reports & analytics', 'AI coach + WhatsApp bot']}
                tone="primary"
              />
            </div>
          </div>

          {/* CTA column — stacked on mobile, side-by-side on sm+ */}
          <div className="flex flex-col gap-2 sm:min-w-[180px] sm:items-stretch">
            <button
              onClick={() => setShowPaywall(true)}
              className="w-full px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-semibold transition-colors shadow-lg shadow-cyan-500/20"
            >
              {isPostTrial ? 'Resubscribe' : 'Start free trial'}
            </button>
            <p className="text-[10px] text-white/40 text-center leading-tight">
              {isPostTrial
                ? `${DISPLAY_PRICE_PER_MONTH} · cancel anytime`
                : `3 days free, then ${DISPLAY_PRICE_PER_MONTH}`}
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="w-full px-4 py-1.5 rounded-lg bg-transparent border border-white/10 hover:bg-white/[0.04] text-white/70 hover:text-white/90 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
              Connect WhatsApp
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function FreeList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'neutral' | 'primary';
}) {
  const titleClass = tone === 'primary' ? 'text-cyan-300/80' : 'text-white/40';
  const iconClass = tone === 'primary' ? 'text-cyan-400' : 'text-white/30';
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wider font-medium mb-1 ${titleClass}`}>
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-1.5 text-xs text-white/70">
            <Check className={`w-3 h-3 flex-shrink-0 ${iconClass}`} aria-hidden="true" />
            <span className="truncate">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
