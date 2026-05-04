'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Briefcase, Activity, Compass, Sparkles, X } from 'lucide-react';
import { useStore } from '@/store/useStore';

/**
 * Anti-Relapse Mini-Survey card.
 *
 * When a user returns after 7+ days of dormancy, dropping them straight
 * into the dashboard ignores the most fragile psychological moment. The
 * card asks "what's been blocking you?" with 4 buttons + optional
 * free-text note. It records the answer (privately, RLS-bound) and
 * replaces itself with a tuned recovery message.
 *
 * Why these 4 categories specifically:
 *   - work       : the most common cause; doesn't need a "you should
 *                  prioritise yourself" lecture, needs a "let's pick
 *                  ONE small thing"
 *   - health     : physical or mental; the empathetic response is
 *                  "rest is part of the work" not "let's grind"
 *   - motivation : intrinsic; this is the case where re-anchoring on
 *                  why they started matters most
 *   - life_event : moves, family, travel; not a habit failure, just
 *                  a real-world disruption
 *
 * UX principles:
 *   - Empathetic copy throughout. Never "why did you stop." Always
 *     "what's been going on."
 *   - 4 buttons because 3 feels reductive and 5+ creates choice
 *     paralysis at exactly the moment we want low decision cost.
 *   - Free-text note is OPTIONAL and small. Most users won't use it;
 *     the few who do get a tiny "we hear you" moment.
 *   - The card is dismissible without submitting. We don't gate the
 *     dashboard. Pressure → churn.
 *   - After submit, we replace the survey with a short message tuned
 *     to the chosen reason, not a generic "thanks". The user just
 *     told us something personal; respond personally.
 *
 * Storage:
 *   - lapse_reasons table (mig 040)
 *   - localStorage flag `effortos:lapse_survey_submitted_at` so the
 *     same dormancy episode doesn't re-prompt on the next dashboard
 *     mount. Cleared automatically when last_session_date moves.
 */

const SUBMITTED_KEY = 'effortos:lapse_survey_submitted_at';
const DISMISSED_KEY = 'effortos:lapse_survey_dismissed_at';
/** Days of inactivity that trigger the survey. */
const LAPSE_THRESHOLD = 7;

type Reason = 'work' | 'health' | 'motivation' | 'life_event' | 'other';

interface ReasonOption {
  id: Reason;
  label: string;
  icon: React.ReactNode;
  /** Tone for the icon background — keeps the four options visually distinct. */
  accent: string;
}

const REASON_OPTIONS: ReasonOption[] = [
  {
    id: 'work',
    label: 'Work / deadlines',
    icon: <Briefcase className="w-4 h-4" />,
    accent: 'text-amber-300 bg-amber-500/[0.08] border-amber-400/25 hover:bg-amber-500/15',
  },
  {
    id: 'health',
    label: 'Health (mental or physical)',
    icon: <Activity className="w-4 h-4" />,
    accent: 'text-emerald-300 bg-emerald-500/[0.08] border-emerald-400/25 hover:bg-emerald-500/15',
  },
  {
    id: 'motivation',
    label: 'Lost motivation',
    icon: <Compass className="w-4 h-4" />,
    accent: 'text-cyan-300 bg-cyan-500/[0.08] border-cyan-400/25 hover:bg-cyan-500/15',
  },
  {
    id: 'life_event',
    label: 'Something in life',
    icon: <Heart className="w-4 h-4" />,
    accent: 'text-pink-300 bg-pink-500/[0.08] border-pink-400/25 hover:bg-pink-500/15',
  },
];

const TUNED_MESSAGE: Record<Reason, string> = {
  work: "Work crunches happen. The trick after one is picking ONE small thing — not catching up. Try a single 25-min session today; the rest will follow.",
  health: "Rest IS part of the work. Don't push through. When you're ready, even a 10-min session counts as a win, not a comeback.",
  motivation: "The hardest hour is the first one back. Forget streaks for now — pick the smallest version of what excited you originally and start there.",
  life_event: "Real life pulls everyone off the wagon sometimes. Gentle reset: one focus block today, no streak pressure. Tomorrow handles itself.",
  other: "Glad you're back. Whatever it was, the next 25 min is yours — start with anything small.",
};

interface AntiRelapseCardProps {
  /** Days the user has been dormant (computed by caller from last_session_date). */
  daysDormant: number;
  /** Called when the user dismisses the card. */
  onDismiss: () => void;
}

export function AntiRelapseCard({ daysDormant, onDismiss }: AntiRelapseCardProps) {
  const user = useStore((s) => s.user);
  const [phase, setPhase] = useState<'survey' | 'thanks'>('survey');
  const [picked, setPicked] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const firstName = user?.name?.split(' ')[0] || 'you';

  const handlePick = async (reason: Reason) => {
    setPicked(reason);
    setSubmitting(true);
    try {
      await fetch('/api/lapse-reasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          days_dormant: daysDormant,
          note: note.trim() || undefined,
        }),
      });
    } catch {
      // Network failure — still flip to thanks. The user did the
      // emotional work; we don't show them an error toast for the
      // survey path. Aggregate analytics tolerate the rare drop.
    }
    try {
      window.localStorage.setItem(SUBMITTED_KEY, new Date().toISOString());
    } catch { /* ignore */ }
    setSubmitting(false);
    setPhase('thanks');
  };

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
    } catch { /* ignore */ }
    onDismiss();
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={phase}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative rounded-2xl border border-white/[0.08] bg-gradient-to-br from-pink-500/[0.04] to-purple-500/[0.04] p-5 sm:p-6 mb-6 overflow-hidden"
      >
        {/* Soft glow accent */}
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-pink-500/[0.08] blur-3xl pointer-events-none"
        />

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 p-1 text-white/25 hover:text-white/55 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative">
          {phase === 'survey' && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-7 h-7 rounded-lg bg-pink-500/15 border border-pink-400/30 flex items-center justify-center">
                  <Heart className="w-3.5 h-3.5 text-pink-300" />
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-pink-300/85">
                  Welcome back, {firstName}
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white tracking-tight mb-1">
                It&rsquo;s been {daysDormant} days. No judgment — just curiosity.
              </h3>
              <p className="text-xs sm:text-sm text-white/55 mb-4 leading-relaxed">
                What&rsquo;s been going on? One tap; you can skip the note. Your
                answer stays private and helps us not repeat anything that didn&rsquo;t
                help last time.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {REASON_OPTIONS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handlePick(r.id)}
                    disabled={submitting}
                    className={`text-left flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm transition-all disabled:opacity-50 ${r.accent}`}
                  >
                    <span className="shrink-0">{r.icon}</span>
                    <span className="flex-1">{r.label}</span>
                  </button>
                ))}
              </div>

              <div>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                  placeholder="Optional — anything you want us to know"
                  className="w-full px-3.5 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs text-white placeholder:text-white/25 outline-none focus:border-white/15"
                  maxLength={200}
                />
              </div>

              <p className="mt-3 text-[10px] text-white/25">
                Private. Never shared. Helps us tune the experience for you.
              </p>
            </>
          )}

          {phase === 'thanks' && picked && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-cyan-300" />
                </span>
                <span className="text-xs font-semibold text-white/80">
                  Thanks for telling us
                </span>
              </div>
              <p className="text-sm text-white/85 leading-relaxed mb-4">
                {TUNED_MESSAGE[picked]}
              </p>
              <button
                onClick={handleDismiss}
                className="text-xs text-cyan-300 hover:text-cyan-200 transition-colors font-medium"
              >
                Got it →
              </button>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Should-show predicate. Caller (Dashboard) gates the card on this.
 *
 * The card surfaces when:
 *   - The user has a last_session_date set on their profile (i.e.
 *     they've ever logged a session — first-time users are handled
 *     by FirstSessionRitual instead, not this).
 *   - last_session_date is at least LAPSE_THRESHOLD days ago.
 *   - They haven't already submitted a survey OR dismissed in the
 *     current dormancy episode (we use submitted_at / dismissed_at
 *     timestamps in localStorage to track this; both reset
 *     automatically when last_session_date moves to a newer value
 *     because the dormancy episode is bound to the last-session
 *     timestamp itself).
 */
export function shouldShowAntiRelapseCard(opts: {
  lastSessionDate: string | null | undefined; // ISO date YYYY-MM-DD
}): { show: false } | { show: true; daysDormant: number } {
  if (typeof window === 'undefined') return { show: false };
  if (!opts.lastSessionDate) return { show: false };

  const lastSession = new Date(opts.lastSessionDate + 'T00:00:00');
  if (Number.isNaN(lastSession.getTime())) return { show: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysDormant = Math.floor(
    (today.getTime() - lastSession.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (daysDormant < LAPSE_THRESHOLD) return { show: false };

  // Check submitted/dismissed flags. The flags carry an ISO timestamp;
  // we re-show the survey only if the flag predates the most recent
  // session — i.e., if the user came back, did a session, then
  // lapsed AGAIN. The same-episode dedupe is by comparing flag
  // timestamps to last_session_date.
  try {
    const submittedAt = window.localStorage.getItem(SUBMITTED_KEY);
    const dismissedAt = window.localStorage.getItem(DISMISSED_KEY);
    const lastSessionMs = lastSession.getTime();
    if (submittedAt && new Date(submittedAt).getTime() > lastSessionMs) {
      return { show: false };
    }
    if (dismissedAt && new Date(dismissedAt).getTime() > lastSessionMs) {
      return { show: false };
    }
  } catch {
    // localStorage unavailable — show. Worst case the user sees the
    // card twice in private mode, which is a minor UX papercut.
  }

  return { show: true, daysDormant };
}
