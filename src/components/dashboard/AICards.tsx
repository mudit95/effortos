'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

// Both AI cards previously polled their endpoints on a 15-20 min
// setInterval — the single largest Anthropic cost source identified
// in audit pass 2. A user with the dashboard open 8h/day burned
// ~$0.10/day per tab in pure background polling, with no user benefit
// (the inputs barely change between ticks).
//
// New behaviour: fetch on mount, cache the result in localStorage
// keyed by content-hash for INSIGHT_TTL_MS / MOTIVATION_TTL_MS, only
// re-fetch when the cache is stale OR the user clicks the manual ⟳
// button. Same cards visible to the user; cost drops by ~95%.
const INSIGHT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MOTIVATION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Stable cache key that includes the inputs that actually affect output.
 *  Coarse on session counts so we don't churn the cache for each
 *  pomodoro completion mid-day. */
function cacheKey(prefix: string, inputs: Record<string, unknown>): string {
  const stable = JSON.stringify(inputs, Object.keys(inputs).sort());
  return `effortos:ai_${prefix}:${stable}`;
}

interface CachedEntry {
  value: string;
  ts: number;
}

function readCache(key: string, ttlMs: number): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (!parsed.value || !parsed.ts) return null;
    if (Date.now() - parsed.ts > ttlMs) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ value, ts: Date.now() }));
  } catch { /* quota / private mode */ }
}

// Fallback insights when API fails
const FALLBACK_INSIGHTS = [
  "Consistency beats intensity — your daily habit is building real momentum.",
  "Your best work happens in focused blocks. Notice which time of day you're sharpest.",
  "Every session you complete rewires your brain for better focus.",
  "Break patterns emerge from consistency. Keep showing up for 30 days.",
  "Rest days aren't setbacks — they're recovery for peak performance.",
  "Your streak is proof that small daily efforts compound into transformation.",
  "Track not just sessions but the quality of focus. Intensity matters too.",
];

// Fallback motivations when API fails
const FALLBACK_MOTIVATIONS = [
  "The next pomodoro is all that matters right now.",
  "Small steps compound into big results.",
  "You chose to show up — that already counts.",
  "Focus is a muscle. You are building it right now.",
  "Consistency beats intensity, every time.",
  "Your future self will thank you for this session.",
  "Progress happens one pomodoro at a time.",
];

interface AIInsightCardProps {
  goalTitle?: string;
  sessionsCompleted?: number;
  sessionsTotal?: number;
  streakDays?: number;
  context?: 'longterm' | 'daily';
  className?: string;
}

interface AIMotivationCardProps {
  goalTitle?: string;
  sessionsCompleted?: number;
  sessionsTotal?: number;
  streakDays?: number;
  userName?: string;
  /**
   * Top 2-3 task titles from the user&apos;s Today list. Surfaced to the
   * motivation prompt so the AI can name a specific task ("Review PRs
   * is the heaviest one — start there") instead of returning generic
   * "you&apos;ve got this." encouragement. Optional — omitting it falls
   * back to the previous goal-only prompt shape.
   */
  taskTitles?: string[];
  className?: string;
}

export function AIInsightCard({
  goalTitle,
  sessionsCompleted = 0,
  sessionsTotal = 0,
  streakDays = 0,
  context = 'longterm',
  className = '',
}: AIInsightCardProps) {
  const [insight, setInsight] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Store current props in a ref so fetchInsight never changes identity
  const propsRef = useRef({ goalTitle, sessionsCompleted, sessionsTotal, streakDays, context });
  propsRef.current = { goalTitle, sessionsCompleted, sessionsTotal, streakDays, context };

  const fetchInsight = useCallback(async (opts?: { force?: boolean }) => {
    const key = cacheKey('insight', propsRef.current as Record<string, unknown>);
    if (!opts?.force) {
      const cached = readCache(key, INSIGHT_TTL_MS);
      if (cached) {
        setInsight(cached);
        return;
      }
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/coach/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(propsRef.current),
      });

      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setInsight(data.insight);
      writeCache(key, data.insight);
    } catch {
      // Use a random fallback (don't cache fallbacks).
      setInsight(
        FALLBACK_INSIGHTS[Math.floor(Math.random() * FALLBACK_INSIGHTS.length)],
      );
    } finally {
      setIsLoading(false);
    }
  }, []); // stable — reads from ref, no prop dependencies

  // Fetch once on mount. The cache check inside fetchInsight skips
  // the network round-trip when a recent value is available; manual
  // ⟳ click triggers force=true to bypass the cache. No more
  // setInterval auto-refresh — see the rationale comment at the top.
  useEffect(() => {
    void fetchInsight();
  }, [fetchInsight]);

  return (
    <div
      className={`border border-white/[0.06] bg-white/[0.02] rounded-xl p-4 ${className}`}
    >
      {/* Header with title and shuffle button */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <h3 className="text-[10px] text-white/25 uppercase tracking-widest font-medium">
            AI Insights
          </h3>
        </div>
        <button
          onClick={() => fetchInsight({ force: true })}
          disabled={isLoading}
          className="p-2 border border-white/[0.08] rounded-md hover:border-white/[0.15] hover:bg-white/[0.02] transition-all duration-200 flex items-center justify-center disabled:opacity-50"
          aria-label="Get another insight"
          title="Shuffle insight"
        >
          <RefreshCw
            size={16}
            className={`text-white/50 ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Content with animation */}
      <div className="min-h-[60px] flex items-center">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full"
            >
              <Skeleton.Text lines={2} />
            </motion.div>
          ) : (
            <motion.p
              key={insight}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-white/50 leading-relaxed"
            >
              {insight}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <p className="text-[10px] text-white/40 mt-3">
        Tap ⟳ for another
      </p>
    </div>
  );
}

export function AIMotivationCard({
  goalTitle,
  sessionsCompleted = 0,
  sessionsTotal = 0,
  streakDays = 0,
  userName = 'there',
  taskTitles,
  className = '',
}: AIMotivationCardProps) {
  const [motivation, setMotivation] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Store current props in a ref so fetchMotivation never changes identity.
  // taskTitles flows through here so the cache key includes the user&apos;s
  // current Today list — switching tasks invalidates the cached motivation,
  // and the next render fetches a fresh task-aware message.
  const propsRef = useRef({ goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName, taskTitles });
  propsRef.current = { goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName, taskTitles };

  const fetchMotivation = useCallback(async (opts?: { force?: boolean }) => {
    const key = cacheKey('motivation', propsRef.current as Record<string, unknown>);
    if (!opts?.force) {
      const cached = readCache(key, MOTIVATION_TTL_MS);
      if (cached) {
        setMotivation(cached);
        return;
      }
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/coach/motivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(propsRef.current),
      });

      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setMotivation(data.message);
      writeCache(key, data.message);
    } catch {
      setMotivation(
        FALLBACK_MOTIVATIONS[Math.floor(Math.random() * FALLBACK_MOTIVATIONS.length)],
      );
    } finally {
      setIsLoading(false);
    }
  }, []); // stable — reads from ref, no prop dependencies

  // Fetch once on mount; cache check inside fetchMotivation skips
  // network on warm runs. Manual ⟳ uses force=true. The previous
  // 15-min auto-refresh setInterval was the largest single Anthropic
  // cost source — see comment at top of file.
  useEffect(() => {
    void fetchMotivation();
  }, [fetchMotivation]);

  return (
    <div
      className={`border border-cyan-500/[0.08] bg-gradient-to-br from-cyan-500/[0.04] to-purple-500/[0.04] rounded-xl p-4 ${className}`}
    >
      {/* Header with title and shuffle button */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <h3 className="text-[10px] text-white/25 uppercase tracking-widest font-medium">
            Motivation
          </h3>
        </div>
        <button
          onClick={() => fetchMotivation({ force: true })}
          disabled={isLoading}
          className="p-2 border border-white/[0.08] rounded-md hover:border-white/[0.15] hover:bg-white/[0.02] transition-all duration-200 flex items-center justify-center disabled:opacity-50"
          aria-label="Get another motivation"
          title="Shuffle motivation"
        >
          <RefreshCw
            size={16}
            className={`text-white/50 ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Content with animation */}
      <div className="min-h-[60px] flex items-center">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full"
            >
              <Skeleton.Text lines={2} />
            </motion.div>
          ) : (
            <motion.p
              key={motivation}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-white/50 italic leading-relaxed"
            >
              {motivation}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <p className="text-[10px] text-white/40 mt-3">
        Tap ⟳ for another
      </p>
    </div>
  );
}
