'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { X, Sparkles, Flame, Clock } from 'lucide-react';

/**
 * Lapse-recovery modal (Wave 2).
 *
 * Triggered when the user opens the dashboard after 7+ days dormant.
 * Doesn't punish the absence — shows longest-streak (not the broken
 * current streak), days-since-last-session, and a single tap "start
 * a quick 25 min" CTA.
 *
 * Trigger conditions, ALL of which must hold:
 *   1. user.last_session_date is set (mig 035 column).
 *   2. ≥ 7 days between last_session_date and today (local clock).
 *   3. We haven't already shown the modal today on this device
 *      (localStorage dismissal flag, keyed by user_id + day).
 *
 * Why localStorage not server-state:
 *   - The modal is a one-time-per-day-per-device prompt, not a
 *     globally-tracked event. We don't need it to persist across
 *     devices — re-showing on a different device is fine, in fact
 *     mildly helpful.
 *   - Avoids a new DB column and a write on dismissal.
 *
 * Mounted once at the dashboard root. The "Start 25 min" CTA opens
 * Focus Mode the same way the rest of the app does.
 */

const LAPSE_THRESHOLD_DAYS = 7;
const STORAGE_KEY = (userId: string) => `effortos_lapse_dismissed_${userId}`;

/** Returns the user's local-date 'YYYY-MM-DD' string. */
function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Compute lapse state from current user props + impure sources
 *  (Date.now, localStorage). Pure-ish: same inputs → same outputs
 *  for a given moment in time. Called once via useState's lazy
 *  initializer so the impure reads happen exactly at mount.
 */
function computeLapseState(
  userId: string | undefined,
  lastSessionDate: string | undefined,
): { open: boolean; days: number } {
  if (!userId || !lastSessionDate) return { open: false, days: 0 };

  const today = localDateKey();
  if (lastSessionDate >= today) return { open: false, days: 0 };

  const lastDate = new Date(lastSessionDate + 'T00:00:00');
  const days = Math.floor(
    (Date.now() - lastDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days < LAPSE_THRESHOLD_DAYS) return { open: false, days };

  // Per-device dismissal check.
  try {
    const dismissed = localStorage.getItem(STORAGE_KEY(userId));
    if (dismissed === today) return { open: false, days };
  } catch {
    // Private-mode / SSR boundary — fail-open, show the modal.
  }

  return { open: true, days };
}

export function LapseRecoveryModal() {
  const user = useStore((s) => s.user);
  const dashboardStats = useStore((s) => s.dashboardStats);
  const startTimer = useStore((s) => s.startTimer);
  const setView = useStore((s) => s.setView);

  // Lazy initializer runs ONCE at mount, capturing Date.now() and
  // localStorage at that instant. Avoids the
  // react-hooks/set-state-in-effect rule (we're not setting state in
  // an effect; we're computing initial state from the props at
  // mount time, which is the supported "lazy initial state" pattern).
  const [lapseState, setLapseState] = useState(() =>
    computeLapseState(user?.id, user?.last_session_date),
  );

  // No hydration-race effect: the lazy initializer above runs at the
  // exact moment Dashboard mounts the modal. By that point AppShell
  // has already finished store initialization, so user.id and
  // last_session_date are populated. If a future race appears in
  // practice, the worst case is the modal stays hidden for that
  // session — not a regression vs. today (the modal didn't exist).

  const open = lapseState.open;
  const daysDormant = lapseState.days;
  const longestStreak = dashboardStats?.longest_streak ?? 0;

  if (!open || !user) return null;

  const dismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY(user.id), localDateKey());
    } catch {
      // Private mode etc — modal will reopen tomorrow regardless.
    }
    setLapseState({ open: false, days: daysDormant });
  };

  const handleStart = (): void => {
    dismiss();
    // Open focus mode the same way other CTAs do — flip the view
    // and let useTimer pick up from there. The user's existing
    // active goal/task setup remains untouched.
    setView('focus');
    // startTimer is the canonical "begin a 25-min focus block" action.
    startTimer();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      >
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={dismiss}
          aria-hidden="true"
        />

        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.96 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-md bg-[#0d1117] border border-white/[0.08] rounded-2xl overflow-hidden"
          role="dialog"
          aria-labelledby="lapse-modal-title"
        >
          {/* Soft gradient header — warm, welcoming, NOT alarmist. */}
          <div className="relative px-6 pt-8 pb-5 text-center bg-gradient-to-b from-amber-500/[0.08] to-transparent">
            <button
              onClick={dismiss}
              className="absolute top-4 right-4 text-white/25 hover:text-white/60 transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-500/20">
              <Sparkles className="w-7 h-7 text-white" />
            </div>

            <h2 id="lapse-modal-title" className="text-xl font-bold text-white mb-1">
              Welcome back, {user.name?.split(' ')[0] || 'friend'}
            </h2>
            <p className="text-sm text-white/45 leading-relaxed">
              {daysDormant === 1
                ? 'It\'s been a day since your last session.'
                : `It's been ${daysDormant} days since your last session.`}
              {' '}No judgement &mdash; just glad you&rsquo;re here.
            </p>
          </div>

          {/* Stats card — show longest, NOT current (which is 0 / broken).
              The point is to remind the user what they've already proven
              they can do, not rub their face in the gap. */}
          <div className="px-6 py-4 grid grid-cols-2 gap-3">
            {longestStreak > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/30 mb-1">
                  <Flame className="w-3 h-3 text-orange-400" />
                  Longest streak
                </div>
                <p className="text-2xl font-bold text-white">
                  {longestStreak}
                  <span className="text-xs font-normal text-white/40 ml-1">
                    day{longestStreak === 1 ? '' : 's'}
                  </span>
                </p>
              </div>
            )}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/30 mb-1">
                <Clock className="w-3 h-3 text-cyan-400" />
                One small thing
              </div>
              <p className="text-2xl font-bold text-white">25</p>
              <p className="text-xs text-white/40">minutes is enough</p>
            </div>
          </div>

          {/* CTA — single primary action. The dismiss-X is the secondary. */}
          <div className="px-6 pb-6 pt-2 space-y-2">
            <Button
              variant="glow"
              size="lg"
              onClick={handleStart}
              className="w-full gap-2 h-12 text-base"
            >
              <Sparkles className="w-4 h-4" />
              Start a quick 25 min
            </Button>
            <button
              onClick={dismiss}
              className="w-full text-xs text-white/30 hover:text-white/50 transition-colors py-1"
            >
              Not right now
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
