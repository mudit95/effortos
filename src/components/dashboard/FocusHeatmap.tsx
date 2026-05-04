'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, TrendingUp } from 'lucide-react';
import * as api from '@/lib/api';
import * as storage from '@/lib/storage';

/**
 * 7×24 focus heatmap — when does the user actually focus?
 *
 * Reads completed sessions from the last 90 days, buckets each by
 * (day-of-week, hour-of-day) using the user's local time, and renders
 * a calendar-heatmap grid (rows = Mon-Sun, cols = 0-23). Each cell's
 * intensity scales with the count of sessions that started in that
 * cell. Surfaces the peak cell as a one-line insight above the grid.
 *
 * Why a separate component:
 *   - Independent data fetch — Reports' aggregator works on daily
 *     tasks (not sessions), so this needs its own /api/sessions read.
 *   - Stable across period switches — the heatmap reflects the user's
 *     long-term pattern, not the current week. Period selector in the
 *     parent Reports component doesn't affect what this shows.
 *   - Cheap re-render — the data is fetched once on mount and memoised.
 *
 * Privacy: this component never sends data anywhere. The session
 * timestamps stay client-side; only an empirical bucket count is
 * derived for rendering. Nothing is sent to Anthropic or any other
 * external service from here.
 */

// 90 days of history is enough to surface a stable circadian pattern
// without making the query expensive. Users with fewer sessions than
// this just see a sparser grid.
const LOOKBACK_DAYS = 90;

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Convert JS getDay() (0=Sun..6=Sat) to our (0=Mon..6=Sun) order. */
function jsDayToMonStart(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/** "9 AM" / "1 PM" / "12 AM" — for display in the peak-hour callout. */
function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

interface HeatmapCell {
  count: number;
  /** 0..1 normalised intensity for visual scaling. */
  intensity: number;
}

interface SessionLite {
  start_time?: string | null;
  status?: string;
}

export function FocusHeatmap() {
  const [grid, setGrid] = useState<HeatmapCell[][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalSessions, setTotalSessions] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      const sinceIso = new Date(cutoff).toISOString();
      let sessions: SessionLite[];
      try {
        // Server-side `since` filter — previously we pulled every
        // session and filtered client-side. With years of history
        // that was O(n) bytes over the wire and on the heap.
        sessions = (await api.getSessions({ since: sinceIso })) as SessionLite[];
      } catch {
        // Cloud unreachable — fall back to local cache.
        sessions = storage.getSessions() as SessionLite[];
      }
      if (cancelled) return;
      const counts: number[][] = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, () => 0),
      );
      let totalCounted = 0;

      for (const s of sessions) {
        if (s.status !== 'completed') continue;
        if (!s.start_time) continue;
        const ts = new Date(s.start_time).getTime();
        if (Number.isNaN(ts) || ts < cutoff) continue;
        const d = new Date(ts);
        // Local-time day + hour. The user's circadian pattern is in
        // their local frame; UTC bucketing would smear evening-IST
        // sessions across two days.
        const dow = jsDayToMonStart(d.getDay());
        const hour = d.getHours();
        counts[dow][hour] += 1;
        totalCounted += 1;
      }

      const max = Math.max(1, ...counts.flat());
      const normalised: HeatmapCell[][] = counts.map((row) =>
        row.map((count) => ({
          count,
          intensity: count / max,
        })),
      );
      setGrid(normalised);
      setTotalSessions(totalCounted);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Find the peak cell for the callout. Ties broken by lowest dow,
  // then lowest hour — deterministic so the callout doesn't shuffle
  // on re-render with the same data.
  const peak = useMemo(() => {
    if (!grid) return null;
    let best: { count: number; dow: number; hour: number } | null = null;
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const c = grid[dow][hour].count;
        if (c > 0 && (best === null || c > best.count)) {
          best = { count: c, dow, hour };
        }
      }
    }
    return best;
  }, [grid]);

  // Min/max columns to render — collapses leading/trailing empty hours
  // (e.g., 0-5 and 22-23) so the grid focuses on the user's actual
  // active window. Keeps a 1-hour pad on each side so the visual edge
  // doesn't sit right at the first lit cell.
  const { startHour, endHour } = useMemo(() => {
    if (!grid) return { startHour: 0, endHour: 23 };
    let firstLit = 24;
    let lastLit = -1;
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        if (grid[dow][hour].count > 0) {
          if (hour < firstLit) firstLit = hour;
          if (hour > lastLit) lastLit = hour;
        }
      }
    }
    if (lastLit < 0) return { startHour: 6, endHour: 22 }; // empty: show daytime
    return {
      startHour: Math.max(0, firstLit - 1),
      endHour: Math.min(23, lastLit + 1),
    };
  }, [grid]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-cyan-400/50" />
          <h3 className="text-sm font-semibold text-white/70">When you focus</h3>
        </div>
        <div className="h-32 rounded-lg bg-white/[0.02] animate-pulse" />
      </div>
    );
  }

  if (!grid || totalSessions === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-white/30" />
          <h3 className="text-sm font-semibold text-white/70">When you focus</h3>
        </div>
        <p className="text-xs text-white/30">
          Your time-of-day pattern shows up here once you&rsquo;ve logged a
          handful of sessions.
        </p>
      </div>
    );
  }

  const visibleHours = endHour - startHour + 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400/70" />
          <h3 className="text-sm font-semibold text-white/80">When you focus</h3>
          <span className="text-[10px] text-white/30">last {LOOKBACK_DAYS} days</span>
        </div>
        {peak && (
          <div className="flex items-center gap-1.5 text-xs text-white/55">
            <TrendingUp className="w-3 h-3 text-cyan-400" />
            Peak: <span className="text-white/85 font-medium">{DAY_LABELS[peak.dow]} {formatHour(peak.hour)}</span>
          </div>
        )}
      </div>

      {/* Hour-axis labels — render every 3 hours to avoid clutter. */}
      <div
        className="grid gap-px mb-1 ml-[34px] text-[9px] text-white/25"
        style={{ gridTemplateColumns: `repeat(${visibleHours}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {Array.from({ length: visibleHours }, (_, i) => {
          const hour = startHour + i;
          const showLabel = i === 0 || i === visibleHours - 1 || hour % 3 === 0;
          return (
            <span key={hour} className="text-center">
              {showLabel ? (hour === 0 ? '12a' : hour === 12 ? '12p' : hour > 12 ? `${hour - 12}p` : `${hour}a`) : ''}
            </span>
          );
        })}
      </div>

      {/* The grid: 7 rows (Mon..Sun) × visibleHours cols. */}
      <div className="space-y-px">
        {DAY_LABELS.map((label, dow) => (
          <div key={label} className="flex items-center gap-1">
            <span className="w-7 text-[10px] text-white/30 text-right shrink-0">
              {label}
            </span>
            <div
              role="row"
              aria-label={`${label} focus pattern`}
              className="grid gap-px flex-1"
              style={{ gridTemplateColumns: `repeat(${visibleHours}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: visibleHours }, (_, i) => {
                const hour = startHour + i;
                const cell = grid[dow][hour];
                // Cyan with intensity-modulated alpha. 0.05 base so empty
                // cells aren't invisible (the grid shape stays legible).
                const alpha = cell.count === 0 ? 0.05 : 0.15 + cell.intensity * 0.7;
                return (
                  <div
                    key={hour}
                    role="cell"
                    title={`${label} ${formatHour(hour)} — ${cell.count} session${cell.count === 1 ? '' : 's'}`}
                    className="aspect-square rounded-[2px] border border-white/[0.04]"
                    style={{ backgroundColor: `rgba(34, 211, 238, ${alpha})` }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer scale — visual key, low-priority but shows what the
          colour ramp means at a glance. */}
      <div className="flex items-center justify-end gap-1 mt-3 text-[10px] text-white/25">
        <span>less</span>
        {[0.05, 0.2, 0.4, 0.6, 0.85].map((a, i) => (
          <span
            key={i}
            className="w-2.5 h-2.5 rounded-[2px] border border-white/[0.04]"
            style={{ backgroundColor: `rgba(34, 211, 238, ${a})` }}
          />
        ))}
        <span>more</span>
      </div>
    </motion.div>
  );
}
