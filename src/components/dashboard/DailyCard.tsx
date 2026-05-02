'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Clock, ListChecks, Flame, Lock } from 'lucide-react';
import { useStore } from '@/store/useStore';

/**
 * Daily AI card (Wave 3).
 *
 * Renders today's stats + (Pro only) one-line AI suggestion. Backed
 * by /api/coach/daily-card which caches the row in the daily_cards
 * table — first dashboard open of the day pays the AI cost, every
 * subsequent open is a fast DB read.
 *
 * Tier rendering:
 *   - Everyone sees focus minutes, sessions completed, task count,
 *     and the streak chip — those are descriptive, no AI cost.
 *   - Pro users additionally see the prescriptive "try X tomorrow"
 *     line in a highlighted band at the bottom.
 *   - Free users see a muted "Pro: get a personalised suggestion
 *     each evening" upsell band — same vertical space so the layout
 *     doesn't shift when a user upgrades.
 *
 * Loading / empty:
 *   - Render skeleton stats during the fetch.
 *   - When the user has done literally nothing today (focus_minutes
 *     == 0 AND tasks_total == 0), show a short "no activity yet"
 *     placeholder instead of a wall of zeroes.
 */

interface DailyCardData {
  date: string;
  descriptive: {
    focus_minutes: number;
    sessions_completed: number;
    tasks_completed: number;
    tasks_total: number;
    completion_rate: number | null;
    mood: string | null;
    current_streak: number;
    active_goal_pct: number | null;
  };
  ai_suggestion: string | null;
}

export function DailyCard() {
  const subscription = useStore((s) => s.subscription);
  const [data, setData] = useState<DailyCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Determine Pro tier from the subscription state. Same shape as
  // PremiumGate / requireActiveSub server-side. Trialing users get
  // Pro card too — same access pattern.
  const isPro =
    (subscription.plan_tier === 'pro') &&
    (subscription.status === 'active' || subscription.status === 'trialing');

  useEffect(() => {
    let cancelled = false;
    // Fetch-on-mount is the canonical "load remote data" pattern.
    // setState-in-effect here is intentional — fetch returns
    // asynchronously, the cancelled flag prevents a stale-update race,
    // and we can't compute the response synchronously in render. The
    // newer rule version no longer flags this pattern, so the previous
    // disable directive is unused (eslint warning).
    fetch('/api/coach/daily-card')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: DailyCardData) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Skeleton state — match the final layout's height so the dashboard
  // doesn't jump when the data lands.
  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 min-h-[180px]">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 rounded bg-white/[0.05] animate-pulse" />
          <div className="h-4 w-24 rounded bg-white/[0.05] animate-pulse" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    // Quiet failure — the daily card is non-essential. Render a one-
    // line placeholder so we don't burden the user with an error stack.
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="text-xs text-white/30">Daily summary unavailable right now.</p>
      </div>
    );
  }

  const d = data.descriptive;
  const noActivity = d.focus_minutes === 0 && d.tasks_total === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-white/[0.01] overflow-hidden"
    >
      {/* Header row */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <h3 className="text-sm font-semibold text-white/80">Today&rsquo;s card</h3>
        </div>
        {d.current_streak > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <Flame className="w-3 h-3 text-orange-400" />
            <span className="font-semibold text-white/80">{d.current_streak}</span>
            <span>day streak</span>
          </div>
        )}
      </div>

      {/* Stats grid OR no-activity placeholder */}
      {noActivity ? (
        <div className="px-5 pb-5">
          <p className="text-sm text-white/50">
            Nothing logged today yet. Open Focus Mode and run a quick 25 min — even one session anchors the day.
          </p>
        </div>
      ) : (
        <div className="px-5 pb-4 grid grid-cols-3 gap-3">
          <Stat
            icon={<Clock className="w-3 h-3 text-cyan-400/80" />}
            label="Focus"
            value={`${d.focus_minutes}`}
            unit={d.focus_minutes === 1 ? 'min' : 'mins'}
          />
          <Stat
            icon={<Sparkles className="w-3 h-3 text-purple-400/80" />}
            label="Sessions"
            value={`${d.sessions_completed}`}
            unit={d.sessions_completed === 1 ? 'pom' : 'poms'}
          />
          <Stat
            icon={<ListChecks className="w-3 h-3 text-emerald-400/80" />}
            label="Tasks"
            value={`${d.tasks_completed}/${d.tasks_total}`}
            unit={
              d.completion_rate != null
                ? `${Math.round(d.completion_rate * 100)}%`
                : '—'
            }
          />
        </div>
      )}

      {/* Mood line — only when present */}
      {d.mood && !noActivity && (
        <div className="px-5 pb-3 text-xs text-white/40">
          Mood today: <span className="text-white/70">{d.mood}</span>
        </div>
      )}

      {/* AI suggestion band (Pro) OR upsell band (free) */}
      {isPro ? (
        data.ai_suggestion && (
          <div className="px-5 py-4 border-t border-white/[0.06] bg-cyan-500/[0.04]">
            <p className="text-xs text-cyan-300/80 leading-relaxed">
              <span className="font-semibold">For tomorrow:</span> {data.ai_suggestion}
            </p>
          </div>
        )
      ) : (
        <div className="px-5 py-4 border-t border-white/[0.06] bg-white/[0.02] flex items-center gap-3">
          <Lock className="w-3.5 h-3.5 text-white/30 shrink-0" />
          <p className="text-[11px] text-white/40 leading-relaxed">
            <span className="text-white/60">Pro</span> adds a personalised one-line suggestion each evening based on your day&rsquo;s pattern.
          </p>
        </div>
      )}
    </motion.div>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40 mb-1">
        {icon}
        {label}
      </div>
      <p className="text-xl font-bold text-white leading-tight">
        {value}
        {unit && <span className="text-xs font-normal text-white/40 ml-1.5">{unit}</span>}
      </p>
    </div>
  );
}
