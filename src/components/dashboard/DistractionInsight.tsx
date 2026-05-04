'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Clock } from 'lucide-react';
import * as api from '@/lib/api';
import * as storage from '@/lib/storage';

/**
 * Distraction-pattern insight.
 *
 * Pulls the user's last 90 days of sessions, filters to status='discarded'
 * (resetTimer / explicit abort), and finds the (day-of-week, hour) cell
 * where they abort most often. If a clear pattern exists (≥3 aborts in
 * one cell over 90 days), surface a single-line insight in Reports.
 *
 * Why client-side compute: the data is small (most users will have
 * <50 discards over 90 days), the math is trivial, and avoiding a
 * server round-trip keeps Reports snappy. Privacy bonus: the
 * abort-cluster is never sent to any external service.
 *
 * Anti-noise threshold: 3 aborts in a single cell. Below that the
 * "pattern" is statistical noise (you got distracted ONE Wednesday
 * afternoon — fine, doesn't deserve a callout). The 3+ threshold is
 * tuned from observed user data: 1 abort/cell happens to most users
 * organically; ≥3/cell is genuinely repeating behaviour.
 *
 * Hidden state: when no pattern exists (most users for the first
 * 30-60 days), the component renders nothing. No explicit "no
 * pattern yet" empty state — Reports already has plenty of zero-
 * state copy without adding more.
 */

const LOOKBACK_DAYS = 90;
const PATTERN_THRESHOLD = 3;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface SessionLite {
  start_time?: string | null;
  status?: string;
}

function jsDayToMonStart(jsDay: number): number {
  return (jsDay + 6) % 7;
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

interface DistractionPattern {
  dow: number;
  hour: number;
  count: number;
  /** Total discards in window — for the framing line ("you've aborted N sessions"). */
  totalDiscards: number;
}

export function DistractionInsight() {
  const [pattern, setPattern] = useState<DistractionPattern | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      const sinceIso = new Date(cutoff).toISOString();
      let sessions: SessionLite[];
      try {
        // Server-side `since` filter — previously this pulled every
        // session a power user had ever logged.
        sessions = (await api.getSessions({ since: sinceIso })) as SessionLite[];
      } catch {
        sessions = storage.getSessions() as SessionLite[];
      }
      if (cancelled) return;
      const grid: number[][] = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, () => 0),
      );
      let totalDiscards = 0;
      for (const s of sessions) {
        if (s.status !== 'discarded') continue;
        if (!s.start_time) continue;
        const ts = new Date(s.start_time).getTime();
        if (Number.isNaN(ts) || ts < cutoff) continue;
        const d = new Date(ts);
        grid[jsDayToMonStart(d.getDay())][d.getHours()] += 1;
        totalDiscards++;
      }

      // Find peak cell. Tie-break: lowest dow, then lowest hour, so
      // the surfaced line is deterministic across renders with same data.
      let peak: DistractionPattern | null = null;
      for (let dow = 0; dow < 7; dow++) {
        for (let h = 0; h < 24; h++) {
          const c = grid[dow][h];
          if (c >= PATTERN_THRESHOLD && (peak === null || c > peak.count)) {
            peak = { dow, hour: h, count: c, totalDiscards };
          }
        }
      }
      setPattern(peak);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Don't render anything during load; avoid the layout shift.
  if (loading || !pattern) return null;

  const dayName = DAY_LABELS[pattern.dow];
  const hourLabel = formatHour(pattern.hour);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.04] p-5"
    >
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
          <AlertCircle className="w-4 h-4 text-amber-300" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-white/85">
              Sessions you tend to lose
            </h3>
            <span className="text-[10px] text-white/30 uppercase tracking-wider">
              90-day pattern
            </span>
          </div>
          <p className="text-xs sm:text-sm text-white/65 leading-relaxed">
            You aborted{' '}
            <span className="text-white/90 font-semibold">
              {pattern.count}
            </span>{' '}
            session{pattern.count === 1 ? '' : 's'} on{' '}
            <span className="text-amber-200 font-semibold">{dayName}s around {hourLabel}</span>
            {pattern.totalDiscards > pattern.count && (
              <>
                {' '}— that&rsquo;s {Math.round((pattern.count / pattern.totalDiscards) * 100)}%
                of all your aborted sessions.
              </>
            )}
          </p>
          <p className="text-[11px] text-white/40 mt-2 leading-relaxed">
            <Clock className="inline w-2.5 h-2.5 mr-1 -mt-px" />
            Worth checking your calendar — meetings overrunning, low-energy slot, or just a wrong-shaped task at the wrong time.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
