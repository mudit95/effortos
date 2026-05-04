'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Calendar, AlertTriangle, Sparkles } from 'lucide-react';
import { useStore } from '@/store/useStore';
import * as api from '@/lib/api';
import * as storage from '@/lib/storage';
import { projectGoalPace, formatProjectedDate, type PaceProjection } from '@/lib/goal-pace';

/**
 * Compact callout that surfaces the projected completion date for the
 * active goal, plus pace-status colouring (ahead / on-track / behind).
 *
 * Renders below the goal progress bar in the long-term dashboard. Uses
 * the existing sessions API + the goal-pace projection helper to do
 * all the math client-side; no new server endpoints required.
 *
 * UX choices:
 *   - Confidence-tuned copy: "high" gets emphatic ("you'll finish on
 *     Jun 14"); "low" softens to "if you keep this up, mid-July".
 *   - Status-tuned colour: ahead = emerald, on-track = cyan, behind
 *     = amber. Never red — even "behind" is recoverable, not failure.
 *   - Hidden if there's no projection available (zero sessions, or
 *     dormant ≥14 days). The dormant case is already covered by
 *     LapseRecoveryModal / AntiRelapseCard so we don't double up.
 */

export function GoalPaceCallout() {
  const activeGoal = useStore((s) => s.activeGoal);
  const [projection, setProjection] = useState<PaceProjection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!activeGoal) {
      // The "no goal" branch flips state via the same async setter
      // path so we don't have a sync setState-in-effect — Promise
      // microtask defers the update to the next tick.
      Promise.resolve().then(() => {
        if (cancelled) return;
        setProjection(null);
        setLoading(false);
      });
      return () => { cancelled = true; };
    }
    (async () => {
      // Pull the goal's session history — try cloud first, fall back to local.
      let sessions: { start_time?: string | null; status?: string }[];
      try {
        sessions = await api.getSessions(activeGoal.id);
      } catch {
        sessions = storage.getSessions(activeGoal.id);
      }
      if (cancelled) return;
      const proj = projectGoalPace(activeGoal, sessions);
      setProjection(proj);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeGoal]);

  if (!activeGoal || loading || !projection) return null;

  const accent =
    projection.status === 'ahead'
      ? 'text-emerald-300 border-emerald-400/25 bg-emerald-500/[0.04]'
      : projection.status === 'behind'
      ? 'text-amber-300 border-amber-400/25 bg-amber-500/[0.04]'
      : 'text-cyan-300 border-cyan-400/25 bg-cyan-500/[0.04]';

  const Icon =
    projection.status === 'ahead'
      ? Sparkles
      : projection.status === 'behind'
      ? AlertTriangle
      : TrendingUp;

  // Phrasing tunes by confidence. "High" lands the date plainly;
  // "medium" still lands it but with a hedge; "low" frames as a
  // soft estimate.
  const headline = (() => {
    const dateStr = formatProjectedDate(projection.projectedDate);
    if (projection.confidence === 'high') {
      if (projection.status === 'ahead') return `On pace to finish by ${dateStr} — ahead of schedule`;
      if (projection.status === 'behind') return `Currently projected to finish ${dateStr} — past deadline`;
      return `On track to finish by ${dateStr}`;
    }
    if (projection.confidence === 'medium') {
      if (projection.status === 'behind') return `If pace holds, finish around ${dateStr} (deadline at risk)`;
      if (projection.status === 'ahead') return `If pace holds, finish around ${dateStr} (ahead)`;
      return `If you keep this up, around ${dateStr}`;
    }
    return `Early signal: ~${dateStr} at current rate (need more sessions to be sure)`;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`mt-3 px-3.5 py-2.5 rounded-xl border ${accent} flex items-start gap-2.5`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs sm:text-[13px] font-medium leading-snug">{headline}</p>
        <p className="text-[10px] text-white/40 mt-0.5">
          <Calendar className="inline w-2.5 h-2.5 mr-1 -mt-px" />
          Last 14 days: {projection.recentDailyRate.toFixed(1)} sessions/day
          {projection.confidence === 'low' && ' · low confidence'}
        </p>
      </div>
    </motion.div>
  );
}
