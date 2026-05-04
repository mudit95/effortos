'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Lock, Calendar, TrendingUp, Clock, ListChecks, Trophy } from 'lucide-react';
import { useStore } from '@/store/useStore';

/**
 * Weekly AI report card — surfaces on the dashboard between the daily
 * card and the goals/tasks. Same tier rendering pattern as DailyCard:
 *
 *   - Everyone sees the descriptive header (focus minutes, sessions,
 *     completion %, best day).
 *   - Pro users additionally see the multi-paragraph AI insight + a
 *     one-line "try X next week" suggestion.
 *   - Free users see the descriptive header + a Pro upsell band.
 *
 * Cached server-side per (user, week_start) — first dashboard open of
 * the week pays the AI cost, subsequent opens are fast DB reads.
 *
 * Surfaces ALL week long (not just on Sunday) so users opening the
 * dashboard mid-week can see "your week so far" with the Pro insight
 * already settled by the cache from the most recent fetch. The
 * descriptive numbers update across the week as more sessions land
 * (because the cache is invalidated on Sunday→Monday transition by
 * the new week_start key).
 */

interface WeeklyCardData {
  week_start: string;
  cached: boolean;
  descriptive: {
    total_focus_minutes: number;
    total_sessions: number;
    tasks_completed: number;
    tasks_total: number;
    completion_rate: number;
    best_day_name: string | null;
    best_day_sessions: number;
    morning_completion: number | null;
    afternoon_completion: number | null;
    evening_completion: number | null;
    current_streak: number;
    longest_streak: number;
    active_goals_count: number;
    mood_summary: string | null;
    top_tag: string | null;
  };
  ai_insight: string | null;
  ai_suggestion: string | null;
}

export function WeeklyCard() {
  const subscription = useStore((s) => s.subscription);
  const [data, setData] = useState<WeeklyCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isPro =
    subscription.plan_tier === 'pro' &&
    (subscription.status === 'active' || subscription.status === 'trialing');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/coach/weekly-card')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: WeeklyCardData) => {
        if (!cancelled) setData(json);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 min-h-[200px]">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 rounded bg-white/[0.05] animate-pulse" />
          <div className="h-4 w-28 rounded bg-white/[0.05] animate-pulse" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="text-xs text-white/30">Weekly summary unavailable right now.</p>
      </div>
    );
  }

  const d = data.descriptive;
  // Hide entirely if the week has zero activity — no point surfacing
  // a "your week in numbers" with all zeros. Comes back as soon as
  // the user logs anything.
  if (d.total_sessions === 0) return null;

  const focusH = Math.floor(d.total_focus_minutes / 60);
  const focusM = d.total_focus_minutes % 60;
  const completionPct = Math.round(d.completion_rate * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-purple-500/[0.04] to-cyan-500/[0.02] overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Calendar className="w-3.5 h-3.5 text-purple-300" />
          </div>
          <h3 className="text-sm font-semibold text-white/85">This week</h3>
        </div>
        {d.best_day_name && d.best_day_sessions > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <Trophy className="w-3 h-3 text-amber-300" />
            <span>Best: {d.best_day_name} ({d.best_day_sessions})</span>
          </div>
        )}
      </div>

      {/* Stats grid — 4 columns desktop, 2 mobile */}
      <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          icon={<Clock className="w-3 h-3 text-cyan-300/80" />}
          label="Focus"
          value={focusH > 0 ? `${focusH}h ${focusM}m` : `${focusM} min`}
        />
        <Stat
          icon={<Sparkles className="w-3 h-3 text-purple-300/80" />}
          label="Sessions"
          value={`${d.total_sessions}`}
        />
        <Stat
          icon={<ListChecks className="w-3 h-3 text-emerald-300/80" />}
          label="Tasks"
          value={`${d.tasks_completed}/${d.tasks_total}`}
          unit={d.tasks_total > 0 ? `${completionPct}%` : '—'}
        />
        <Stat
          icon={<TrendingUp className="w-3 h-3 text-rose-300/80" />}
          label="Streak"
          value={`${d.current_streak}`}
          unit={d.current_streak === 1 ? 'day' : 'days'}
        />
      </div>

      {/* Time-of-day strip — only when there's a real distribution to show */}
      {d.morning_completion !== null && (d.morning_completion > 0 || (d.afternoon_completion ?? 0) > 0 || (d.evening_completion ?? 0) > 0) && (
        <div className="px-5 pb-3">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">
            When you focused
          </p>
          <TimeOfDayStrip
            morning={d.morning_completion ?? 0}
            afternoon={d.afternoon_completion ?? 0}
            evening={d.evening_completion ?? 0}
          />
        </div>
      )}

      {/* AI insight (Pro) OR upsell (free) */}
      {isPro ? (
        data.ai_insight && (
          <div className="px-5 py-4 border-t border-white/[0.06] bg-purple-500/[0.04]">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-300" />
              <p className="text-[11px] uppercase tracking-wider text-purple-200/70 font-semibold">
                Your week, looking back
              </p>
            </div>
            <div className="text-xs text-white/75 leading-relaxed whitespace-pre-line">
              {data.ai_insight}
            </div>
            {data.ai_suggestion && (
              <div className="mt-3 pt-3 border-t border-purple-500/10 flex items-start gap-2">
                <span className="text-[10px] uppercase tracking-wider text-purple-300/70 font-semibold mt-0.5 shrink-0">
                  Try
                </span>
                <p className="text-xs text-purple-100/85 font-medium leading-relaxed">
                  {data.ai_suggestion}
                </p>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="px-5 py-4 border-t border-white/[0.06] bg-white/[0.02] flex items-start gap-3">
          <Lock className="w-3.5 h-3.5 text-white/30 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[11px] text-white/55 leading-relaxed">
              <span className="text-white/75 font-medium">Pro</span> reads your
              week and surfaces patterns — &ldquo;78% completion in mornings vs 41%
              afternoons; want to rebalance?&rdquo; Plus a one-line action for next
              week.
            </p>
          </div>
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
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40 mb-1">
        {icon}
        {label}
      </div>
      <p className="text-lg font-bold text-white leading-tight">
        {value}
        {unit && <span className="text-[10px] font-normal text-white/40 ml-1">{unit}</span>}
      </p>
    </div>
  );
}

/** Three side-by-side bars showing morning / afternoon / evening
 *  session distribution. Heights normalized to the max bucket so the
 *  comparison reads relative, not absolute. */
function TimeOfDayStrip({
  morning,
  afternoon,
  evening,
}: {
  morning: number;
  afternoon: number;
  evening: number;
}) {
  const max = Math.max(morning, afternoon, evening, 0.001);
  const buckets = [
    { label: 'AM', value: morning, color: 'bg-amber-400/60' },
    { label: 'PM', value: afternoon, color: 'bg-cyan-400/60' },
    { label: 'EVE', value: evening, color: 'bg-violet-400/60' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {buckets.map((b) => {
        const pct = (b.value / max) * 100;
        return (
          <div key={b.label} className="space-y-1">
            <div className="h-8 rounded-md bg-white/[0.03] overflow-hidden flex items-end">
              <div
                className={`w-full ${b.color} transition-all`}
                style={{ height: `${Math.max(8, pct)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[9px] text-white/40">
              <span>{b.label}</span>
              <span className="tabular-nums">{Math.round(b.value * 100)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
