'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store/useStore';
import * as api from '@/lib/api';
import { sessionsToHours, getStreaks } from '@/lib/utils';
import type { Session, DailySession } from '@/types';
import { Button } from '@/components/ui/button';
import { GoalProgressBar } from './GoalProgressBar';
import {
  ArrowLeft, Clock, Flame, Target, TrendingUp,
  Calendar, BarChart3, CheckCircle2, Loader,
} from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] text-white/30 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      {sub && <p className="text-[10px] text-white/25 mt-0.5">{sub}</p>}
    </div>
  );
}

export function GoalDetailReport() {
  const reportGoalId = useStore(s => s.reportGoalId);
  const setReportGoalId = useStore(s => s.setReportGoalId);
  const goals = useStore(s => s.goals);
  const user = useStore(s => s.user);

  const goal = goals.find(g => g.id === reportGoalId);
  const focusDuration = user?.settings?.focus_duration || 25 * 60;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [dailySessions, setDailySessions] = useState<DailySession[]>([]);
  const [loading, setLoading] = useState(false);
  // Freeze "now" at mount. Calling Date.now() inside useMemo / render
  // body is flagged as impure; the days-existing calc only needs to be
  // stable across a single visit to the report.
  const [nowAtMount] = useState(() => Date.now());

  // Load sessions from API when goal changes. We guard the `no-goal`
  // reset with a length check so we're not calling setState on every run
  // when the arrays are already empty — that turns the cascading-render
  // warning off for the normal path. The actual async setState happens
  // inside the Promise.then, which is post-render and safe.
  useEffect(() => {
    if (!goal) {
      if (sessions.length || dailySessions.length) {
        setSessions([]);
        setDailySessions([]);
      }
      return;
    }

    setLoading(true);
    Promise.all([
      api.getSessions(goal.id).then(s => s.filter(x => x.status === 'completed')),
      api.getDailySessions(goal.id),
    ])
      .then(([s, ds]) => {
        setSessions(s);
        setDailySessions(ds);
      })
      .catch(err => {
        console.error('Failed to load sessions:', err);
        setSessions([]);
        setDailySessions([]);
      })
      .finally(() => setLoading(false));
    // We intentionally depend only on goal?.id so the fetch doesn't
    // refire when the array lengths we read above change mid-resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal?.id]);

  const stats = useMemo(() => {
    if (!goal) return null;

    const streaks = getStreaks(dailySessions);

    // Time spent today
    const todayStr = new Date().toISOString().split('T')[0];
    const todaySessions = sessions.filter(s =>
      (s.end_time || s.start_time).startsWith(todayStr)
    );
    const todayMinutes = todaySessions.reduce((sum, s) => sum + (s.duration || focusDuration), 0) / 60;

    // Time spent this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);
    const weekSessions = sessions.filter(s => {
      const d = new Date(s.end_time || s.start_time);
      return d >= weekStart;
    });
    const weekMinutes = weekSessions.reduce((sum, s) => sum + (s.duration || focusDuration), 0) / 60;

    // Total time
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration || focusDuration), 0) / 60;
    const totalHours = sessionsToHours(sessions.length);

    // Days active
    const activeDays = new Set(
      sessions.map(s => (s.end_time || s.start_time).split('T')[0])
    ).size;
    const daysExisting = Math.max(1, Math.ceil(
      (nowAtMount - new Date(goal.created_at).getTime()) / (1000 * 60 * 60 * 24)
    ));

    // Consistency = active days / total days
    const consistency = Math.round((activeDays / daysExisting) * 100);

    // Average sessions per active day
    const avgPerDay = activeDays > 0 ? (sessions.length / activeDays).toFixed(1) : '0';

    // Best day
    const dayMap: Record<string, number> = {};
    sessions.forEach(s => {
      const d = (s.end_time || s.start_time).split('T')[0];
      dayMap[d] = (dayMap[d] || 0) + 1;
    });
    const bestDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0];

    // Last 7 days activity chart
    const last7Days: { label: string; value: number; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
      last7Days.push({
        label: dayLabel,
        value: dayMap[dateStr] || 0,
        isToday: i === 0,
      });
    }

    // Estimation accuracy
    const estimationDiff = goal.sessions_completed - goal.estimated_sessions_initial;
    const estimationLabel = estimationDiff === 0
      ? 'Perfectly estimated'
      : estimationDiff < 0
      ? `${Math.abs(estimationDiff)} sessions ahead of estimate`
      : `${estimationDiff} sessions over estimate`;

    return {
      todaySessions: todaySessions.length,
      todayMinutes: Math.round(todayMinutes),
      weekSessions: weekSessions.length,
      weekMinutes: Math.round(weekMinutes),
      totalSessions: sessions.length,
      totalHours,
      totalMinutes: Math.round(totalMinutes),
      activeDays,
      daysExisting,
      consistency,
      avgPerDay,
      bestDay: bestDay ? { date: bestDay[0], count: bestDay[1] } : null,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      last7Days,
      estimationLabel,
      estimationDiff,
    };
  }, [sessions, dailySessions, goal, focusDuration, nowAtMount]);

  if (!goal) return null;

  // Show loading state while fetching sessions
  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        className="space-y-5"
      >
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => setReportGoalId(null)}
            className="text-white/30 hover:text-white/60 transition-colors p-1"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-semibold text-white">Goal Report</h2>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader className="w-6 h-6 text-white/40 animate-spin" />
        </div>
      </motion.div>
    );
  }

  if (!stats) return null;

  const maxChartVal = Math.max(...stats.last7Days.map(d => d.value), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setReportGoalId(null)}
          className="w-8 h-8"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-white/25 uppercase tracking-wider">Goal Report</p>
          <h2 className="text-lg font-bold text-white truncate">{goal.title}</h2>
        </div>
      </div>

      {/* Progress bar */}
      <GoalProgressBar
        sessionsCompleted={goal.sessions_completed}
        sessionsTotal={goal.estimated_sessions_current}
        milestones={goal.milestones}
      />

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard
          icon={<Clock className="w-3 h-3 text-cyan-400" />}
          label="Today"
          value={stats.todaySessions}
          sub={`${stats.todayMinutes}m focused`}
        />
        <StatCard
          icon={<Flame className="w-3 h-3 text-orange-400" />}
          label="This Week"
          value={stats.weekSessions}
          sub={`${Math.round(stats.weekMinutes / 60 * 10) / 10}h total`}
        />
        <StatCard
          icon={<Target className="w-3 h-3 text-blue-400" />}
          label="Total Sessions"
          value={stats.totalSessions}
          sub={`${stats.totalHours}h invested`}
        />
        <StatCard
          icon={<Calendar className="w-3 h-3 text-green-400" />}
          label="Consistency"
          value={`${stats.consistency}%`}
          sub={stats.daysExisting <= 7 ? `${stats.activeDays} active day${stats.activeDays !== 1 ? 's' : ''} so far` : `${stats.activeDays} of ${stats.daysExisting} days`}
        />
        <StatCard
          icon={<TrendingUp className="w-3 h-3 text-purple-400" />}
          label="Streak"
          value={stats.currentStreak}
          sub={`Best: ${stats.longestStreak} days`}
        />
        <StatCard
          icon={<BarChart3 className="w-3 h-3 text-yellow-400" />}
          label="Avg/Day"
          value={stats.avgPerDay}
          sub={stats.bestDay ? `Best: ${stats.bestDay.count} on ${new Date(stats.bestDay.date + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No sessions yet'}
        />
      </div>

      {/* Last 7 days bar chart */}
      <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-3">Last 7 Days</h3>
        <div className="flex items-end gap-1 h-24">
          {stats.last7Days.map((day, i) => {
            const height = (day.value / maxChartVal) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[9px] text-white/30 font-mono">{day.value || ''}</span>
                <motion.div
                  className="w-full rounded-t-md min-h-[2px]"
                  style={{
                    backgroundColor: day.value > 0
                      ? day.isToday ? 'var(--accent, #22d3ee)' : 'rgba(34, 211, 238, 0.5)'
                      : 'rgba(255,255,255,0.04)',
                  }}
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(height, 2)}%` }}
                  transition={{ duration: 0.5, delay: i * 0.05, ease }}
                />
                <span className={`text-[9px] ${day.isToday ? 'text-[var(--accent,#22d3ee)] font-semibold' : 'text-white/20'}`}>
                  {day.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Estimation accuracy */}
      <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-2">Estimation Accuracy</h3>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm text-white/60">{stats.estimationLabel}</p>
            <p className="text-xs text-white/25 mt-1">
              Originally estimated: {goal.estimated_sessions_initial} sessions ·
              Current: {goal.estimated_sessions_current}
            </p>
          </div>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            Math.abs(stats.estimationDiff) <= 2
              ? 'bg-green-500/10'
              : stats.estimationDiff < 0
              ? 'bg-blue-500/10'
              : 'bg-yellow-500/10'
          }`}>
            <CheckCircle2 className={`w-5 h-5 ${
              Math.abs(stats.estimationDiff) <= 2
                ? 'text-green-400'
                : stats.estimationDiff < 0
                ? 'text-blue-400'
                : 'text-yellow-400'
            }`} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
