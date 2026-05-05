'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Sparkles, X, Flame, AlertCircle, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Personalized "Welcome back" card shown at the top of the dashboard
 * when the user opens the app. Summarizes:
 *
 *   - Unfinished tasks from yesterday
 *   - Current streak
 *   - Goal pace (ahead / behind / on track)
 *   - AI-generated one-liner (fetched once per session)
 *
 * Dismissible per session. Appears only if there's meaningful context
 * to show (not for brand new users with no history).
 */

const SESSION_KEY = 'effortos_brief_dismissed';

export function DailyBrief() {
  const user = useStore(s => s.user);
  const activeGoal = useStore(s => s.activeGoal);
  const dashboardStats = useStore(s => s.dashboardStats);
  const dailyTasks = useStore(s => s.dailyTasks);

  const [dismissed, setDismissed] = useState(false);
  const [aiLine, setAiLine] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  // Check if dismissed this session
  useEffect(() => {
    try {
      const d = sessionStorage.getItem(SESSION_KEY);
      if (d === 'true') setDismissed(true);
    } catch {}
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(SESSION_KEY, 'true'); } catch {}
  };

  // We only have today's tasks in the store by default.
  // For the brief, we compute insights from what we have.
  const todayTasks = dailyTasks;
  const incompleteTodayCount = todayTasks.filter(t => !t.completed).length;
  const completeTodayCount = todayTasks.filter(t => t.completed).length;

  const streak = dashboardStats?.current_streak ?? 0;
  const longestStreak = dashboardStats?.longest_streak ?? 0;

  // Goal pace
  const paceInfo = useMemo(() => {
    if (!activeGoal || !dashboardStats) return null;
    const { estimated_sessions_current } = activeGoal;
    const pct = dashboardStats.completion_percentage;
    if (estimated_sessions_current <= 0) return null;

    // Calculate expected pace based on days since goal creation
    const createdAt = new Date(activeGoal.created_at);
    const now = new Date();
    const daysSinceCreation = Math.max(1, Math.floor((now.getTime() - createdAt.getTime()) / 86400000));

    // If they have a deadline, use that for pace calculation
    const deadline = activeGoal.deadline ? new Date(activeGoal.deadline) : null;
    if (deadline) {
      const totalDays = Math.max(1, Math.floor((deadline.getTime() - createdAt.getTime()) / 86400000));
      const expectedPct = Math.min(100, Math.round((daysSinceCreation / totalDays) * 100));
      const diff = pct - expectedPct;
      if (diff >= 5) return { status: 'ahead' as const, diff };
      if (diff <= -5) return { status: 'behind' as const, diff: Math.abs(diff) };
      return { status: 'on-track' as const, diff: 0 };
    }

    return null;
  }, [activeGoal, dashboardStats]);

  // Fetch AI one-liner (with per-day client-side cache).
  //
  // Pre-cache, this fired on every dashboard mount — every page refresh,
  // back-button, deeplink, etc. burned Anthropic tokens. The brief is
  // generated from inputs that are mostly stable over a single day
  // (streak count, goal title, completion %), so caching the response
  // by (user_id, local-date) is a clean win. The cache key lives in
  // localStorage so it survives reload but not log-out-then-back-in
  // (different account). Stale-after-midnight is the right TTL —
  // tomorrow's brief should reflect tomorrow's data.
  useEffect(() => {
    if (!user || !activeGoal || dismissed) return;
    let cancelled = false;
    setLoadingAi(true);

    const todayKey = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const cacheKey = `effortos:dailyBrief:${user.id}:${todayKey}`;

    // Try the cache first.
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setAiLine(cached);
        setLoadingAi(false);
        return () => { cancelled = true; };
      }
    } catch {
      // localStorage unavailable — fall through to network.
    }

    (async () => {
      try {
        const res = await fetch('/api/ai/daily-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: user.name || 'there',
            streak,
            goalTitle: activeGoal.title,
            completionPct: dashboardStats?.completion_percentage ?? 0,
            incompleteTasks: incompleteTodayCount,
            paceStatus: paceInfo?.status,
          }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setAiLine(data.message);
          if (data.message) {
            try { localStorage.setItem(cacheKey, data.message); } catch { /* ignore */ }
          }
        }
      } catch {
        // Silently fail — the brief still works without the AI line
      } finally {
        if (!cancelled) setLoadingAi(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Don't show for brand new users with no data, or if dismissed
  const hasContent = streak > 0 || incompleteTodayCount > 0 || completeTodayCount > 0 || paceInfo;
  if (dismissed || !user || !hasContent) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -12, height: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6"
      >
        <div className="relative p-4 sm:p-5 rounded-xl border border-white/[0.06] bg-gradient-to-r from-cyan-500/[0.04] to-purple-500/[0.04] overflow-hidden">
          {/* Dismiss button */}
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 text-white/20 hover:text-white/50 transition-colors"
            aria-label="Dismiss daily brief"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Greeting */}
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/90">
                Welcome back{user.name ? `, ${user.name.split(' ')[0]}` : ''}
              </p>
              {aiLine ? (
                <p className="text-xs text-white/40 mt-0.5 italic">{aiLine}</p>
              ) : loadingAi ? (
                // Shimmer placeholder for the AI one-liner. Real prose
                // resolution feels much faster when the line slot is
                // already styled rather than a tiny "..." cursor.
                <Skeleton className="h-3 mt-1.5" style={{ width: '78%' }} ariaLabel="Loading AI brief" />
              ) : null}
            </div>
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap gap-3 sm:gap-4">
            {/* Streak */}
            {streak > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <Flame className="w-3.5 h-3.5 text-orange-400" />
                <span className="text-white/70">
                  <strong className="text-white/90">{streak}-day</strong> streak
                  {streak === longestStreak && streak >= 5 && (
                    <span className="text-orange-400 ml-1">Personal best!</span>
                  )}
                </span>
              </div>
            )}

            {/* Incomplete tasks */}
            {incompleteTodayCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400/70" />
                <span className="text-white/70">
                  <strong className="text-white/90">{incompleteTodayCount}</strong> task{incompleteTodayCount !== 1 ? 's' : ''} pending today
                </span>
              </div>
            )}

            {/* Goal pace */}
            {paceInfo && (
              <div className="flex items-center gap-1.5 text-xs">
                <TrendingUp className={`w-3.5 h-3.5 ${
                  paceInfo.status === 'ahead' ? 'text-green-400' :
                  paceInfo.status === 'behind' ? 'text-red-400' :
                  'text-cyan-400'
                }`} />
                <span className="text-white/70">
                  {paceInfo.status === 'ahead' && `${paceInfo.diff}% ahead of pace`}
                  {paceInfo.status === 'behind' && `${paceInfo.diff}% behind pace — you can catch up`}
                  {paceInfo.status === 'on-track' && 'On track'}
                </span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
