'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import * as storage from '@/lib/storage';
import { sessionsToHours, formatDate } from '@/lib/utils';
import { TASK_TAGS, type TaskTagId, type DailyTask } from '@/types';
import {
  BarChart3, Calendar, Clock, Flame, Target,
  ChevronLeft, ChevronRight, TrendingUp, CheckCircle2,
  Tag,
} from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

type ReportPeriod = 'daily' | 'weekly' | 'monthly';

function getTagInfo(tagId?: string) {
  if (!tagId) return null;
  return TASK_TAGS.find(t => t.id === tagId) || null;
}

/* ── Date helpers ──────────────────────────────────────────────────── */
function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d;
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = getWeekEnd(weekStart);
  const startLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${startLabel} — ${endLabel}`;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function getDatesInRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getDayLabel(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

/* ── Data aggregation ─────────────────────────────────────────────── */
interface DayReport {
  date: string;
  tasks: DailyTask[];
  totalPomodoros: number;
  completedPomodoros: number;
  tasksCompleted: number;
  totalTasks: number;
  focusMinutes: number;
  tagBreakdown: Record<string, { label: string; color: string; count: number }>;
}

function aggregateDay(date: string, focusDuration: number): DayReport {
  const tasks = storage.getDailyTasksForDate(date);
  const totalPomodoros = tasks.reduce((sum, t) => sum + t.pomodoros_target, 0);
  const completedPomodoros = tasks.reduce((sum, t) => sum + t.pomodoros_done, 0);
  const tasksCompleted = tasks.filter(t => t.completed).length;
  const focusMinutes = completedPomodoros * (focusDuration / 60);

  const tagBreakdown: Record<string, { label: string; color: string; count: number }> = {};
  tasks.forEach(t => {
    const tag = t.tag || 'untagged';
    const info = getTagInfo(t.tag);
    if (!tagBreakdown[tag]) {
      tagBreakdown[tag] = { label: info?.label || 'Other', color: info?.color || 'rgba(255,255,255,0.2)', count: 0 };
    }
    tagBreakdown[tag].count += t.pomodoros_done;
  });

  return { date, tasks, totalPomodoros, completedPomodoros, tasksCompleted, totalTasks: tasks.length, focusMinutes, tagBreakdown };
}

interface PeriodReport {
  days: DayReport[];
  totalPomodoros: number;
  completedPomodoros: number;
  totalTasks: number;
  tasksCompleted: number;
  totalFocusMinutes: number;
  avgPomodorosPerDay: number;
  bestDay: DayReport | null;
  tagBreakdown: Record<string, { label: string; color: string; count: number }>;
  tasksSummary: { title: string; tag?: string; pomodoros: number; completed: boolean }[];
}

function aggregatePeriod(dates: string[], focusDuration: number): PeriodReport {
  const days = dates.map(d => aggregateDay(d, focusDuration));
  const totalPomodoros = days.reduce((s, d) => s + d.totalPomodoros, 0);
  const completedPomodoros = days.reduce((s, d) => s + d.completedPomodoros, 0);
  const totalTasks = days.reduce((s, d) => s + d.totalTasks, 0);
  const tasksCompleted = days.reduce((s, d) => s + d.tasksCompleted, 0);
  const totalFocusMinutes = days.reduce((s, d) => s + d.focusMinutes, 0);

  const daysWithActivity = days.filter(d => d.completedPomodoros > 0).length;
  const avgPomodorosPerDay = daysWithActivity > 0 ? completedPomodoros / daysWithActivity : 0;

  const bestDay = days.reduce<DayReport | null>((best, d) => {
    if (!best || d.completedPomodoros > best.completedPomodoros) return d;
    return best;
  }, null);

  // Aggregate tag breakdown
  const tagBreakdown: Record<string, { label: string; color: string; count: number }> = {};
  days.forEach(d => {
    Object.entries(d.tagBreakdown).forEach(([tag, val]) => {
      if (!tagBreakdown[tag]) {
        tagBreakdown[tag] = { ...val, count: 0 };
      }
      tagBreakdown[tag].count += val.count;
    });
  });

  // Tasks summary — deduplicate by title
  const taskMap: Record<string, { title: string; tag?: string; pomodoros: number; completed: boolean }> = {};
  days.forEach(d => {
    d.tasks.forEach(t => {
      const key = t.title.toLowerCase();
      if (!taskMap[key]) {
        taskMap[key] = { title: t.title, tag: t.tag, pomodoros: 0, completed: false };
      }
      taskMap[key].pomodoros += t.pomodoros_done;
      if (t.completed) taskMap[key].completed = true;
    });
  });
  const tasksSummary = Object.values(taskMap)
    .sort((a, b) => b.pomodoros - a.pomodoros);

  return { days, totalPomodoros, completedPomodoros, totalTasks, tasksCompleted, totalFocusMinutes, avgPomodorosPerDay, bestDay, tagBreakdown, tasksSummary };
}

/* ── Bar Chart (pure CSS) ──────────────────────────────────────────── */
function BarChart({
  data,
  maxVal,
  labelKey,
  accentColor = 'var(--accent, #22d3ee)',
}: {
  data: { label: string; value: number; isToday?: boolean }[];
  maxVal: number;
  labelKey: string;
  accentColor?: string;
}) {
  const safeMax = Math.max(maxVal, 1);

  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((item, i) => {
        const height = (item.value / safeMax) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[9px] text-white/30 font-mono">{item.value || ''}</span>
            <motion.div
              className="w-full rounded-t-md min-h-[2px]"
              style={{ backgroundColor: item.value > 0 ? accentColor : 'rgba(255,255,255,0.04)' }}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(height, 2)}%` }}
              transition={{ duration: 0.5, delay: i * 0.05, ease }}
            />
            <span className={`text-[9px] ${item.isToday ? 'text-[var(--accent,#22d3ee)] font-semibold' : 'text-white/20'}`}>
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Reports Component ────────────────────────────────────────── */
export function Reports() {
  const user = useStore(s => s.user);
  const focusDuration = user?.settings?.focus_duration || 25 * 60;

  const [period, setPeriod] = useState<ReportPeriod>('daily');
  const [offset, setOffset] = useState(0); // 0 = current, -1 = previous, etc.

  const today = new Date();

  const { dateRange, periodLabel } = useMemo(() => {
    if (period === 'daily') {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const key = d.toISOString().split('T')[0];
      const label = offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' :
        d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      return { dateRange: [key], periodLabel: label };
    } else if (period === 'weekly') {
      const ref = new Date(today);
      ref.setDate(ref.getDate() + offset * 7);
      const weekStart = getWeekStart(ref);
      const weekEnd = getWeekEnd(weekStart);
      const label = offset === 0 ? `This Week` : offset === -1 ? 'Last Week' : formatWeekLabel(weekStart);
      return { dateRange: getDatesInRange(weekStart, weekEnd), periodLabel: label };
    } else {
      const ref = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const monthStart = getMonthStart(ref);
      const monthEnd = getMonthEnd(ref);
      const label = offset === 0 ? 'This Month' : offset === -1 ? 'Last Month' : formatMonthLabel(ref);
      return { dateRange: getDatesInRange(monthStart, monthEnd), periodLabel: label };
    }
  }, [period, offset]);

  const report = useMemo(() => aggregatePeriod(dateRange, focusDuration), [dateRange, focusDuration]);

  const focusHours = Math.floor(report.totalFocusMinutes / 60);
  const focusMins = Math.round(report.totalFocusMinutes % 60);

  // Bar chart data
  const barData = useMemo(() => {
    const todayKey = getTodayKey();
    if (period === 'daily') {
      // Show hourly breakdown — not practical without timestamp data, show single day stats
      return null;
    } else if (period === 'weekly') {
      return report.days.map(d => ({
        label: getDayLabel(d.date),
        value: d.completedPomodoros,
        isToday: d.date === todayKey,
      }));
    } else {
      // Monthly — group by week
      const weeks: { label: string; value: number; isToday?: boolean }[] = [];
      let weekNum = 1;
      for (let i = 0; i < report.days.length; i += 7) {
        const chunk = report.days.slice(i, i + 7);
        const total = chunk.reduce((s, d) => s + d.completedPomodoros, 0);
        const hasToday = chunk.some(d => d.date === todayKey);
        weeks.push({ label: `W${weekNum}`, value: total, isToday: hasToday });
        weekNum++;
      }
      return weeks;
    }
  }, [report, period]);

  const maxBarVal = barData ? Math.max(...barData.map(d => d.value), 1) : 1;

  // Tag entries sorted by count
  const sortedTags = Object.entries(report.tagBreakdown).sort((a, b) => b[1].count - a[1].count);
  const totalTagPomodoros = sortedTags.reduce((s, [, v]) => s + v.count, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Period selector + navigation */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
      >
        {/* Period tabs */}
        <div className="flex items-center justify-center gap-1 mb-5">
          {(['daily', 'weekly', 'monthly'] as const).map(p => (
            <button
              key={p}
              onClick={() => { setPeriod(p); setOffset(0); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
                period === p
                  ? 'bg-white/10 text-white'
                  : 'text-white/30 hover:text-white/50 hover:bg-white/5'
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        {/* Date navigation */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <button
            onClick={() => setOffset(o => o - 1)}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-bold text-white min-w-[180px] text-center">{periodLabel}</h2>
          <button
            onClick={() => setOffset(o => Math.min(o + 1, 0))}
            disabled={offset >= 0}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all disabled:opacity-20"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {offset !== 0 && (
            <button
              onClick={() => setOffset(0)}
              className="text-xs px-2 py-1 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-all ml-1"
            >
              Current
            </button>
          )}
        </div>
      </motion.div>

      {/* Summary cards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4, ease }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-1.5 mb-2">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-[10px] text-white/30 uppercase tracking-wider">Pomodoros</span>
          </div>
          <p className="text-2xl font-bold text-white">{report.completedPomodoros}</p>
          {report.totalPomodoros > 0 && (
            <p className="text-[10px] text-white/20 mt-0.5">of {report.totalPomodoros} planned</p>
          )}
        </div>

        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="w-3.5 h-3.5 text-[var(--accent,#22d3ee)]" />
            <span className="text-[10px] text-white/30 uppercase tracking-wider">Focus Time</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {focusHours > 0 ? `${focusHours}h` : ''}{focusMins > 0 ? `${focusMins}m` : focusHours === 0 ? '0m' : ''}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
            <span className="text-[10px] text-white/30 uppercase tracking-wider">Tasks Done</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {report.tasksCompleted}
            <span className="text-sm text-white/20 font-normal">/{report.totalTasks}</span>
          </p>
        </div>

        <div className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[10px] text-white/30 uppercase tracking-wider">Avg/Day</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {report.avgPomodorosPerDay.toFixed(1)}
          </p>
          <p className="text-[10px] text-white/20 mt-0.5">pomodoros</p>
        </div>
      </motion.div>

      {/* Bar chart (weekly / monthly only) */}
      {barData && barData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease }}
          className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02]"
        >
          <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-4">
            Pomodoros {period === 'weekly' ? 'by Day' : 'by Week'}
          </h3>
          <BarChart data={barData} maxVal={maxBarVal} labelKey={period} />
        </motion.div>
      )}

      {/* Two-column: Tag breakdown + Best day */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Tag breakdown */}
        {sortedTags.length > 0 && totalTagPomodoros > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4, ease }}
            className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
          >
            <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-3">
              <Tag className="w-3 h-3 inline mr-1" />
              Category Breakdown
            </h3>

            {/* Donut-style stacked bar */}
            <div className="h-3 rounded-full bg-white/[0.04] overflow-hidden flex mb-3">
              {sortedTags.map(([key, val]) => (
                <motion.div
                  key={key}
                  initial={{ width: 0 }}
                  animate={{ width: `${(val.count / totalTagPomodoros) * 100}%` }}
                  transition={{ duration: 0.5, ease }}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ backgroundColor: val.color }}
                />
              ))}
            </div>

            <div className="space-y-2">
              {sortedTags.map(([key, val]) => (
                <div key={key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: val.color }} />
                    <span className="text-xs text-white/50">{val.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white/30 font-mono">{val.count}</span>
                    <span className="text-[10px] text-white/15">
                      ({Math.round((val.count / totalTagPomodoros) * 100)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Best day */}
        {report.bestDay && report.bestDay.completedPomodoros > 0 && period !== 'daily' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4, ease }}
            className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
          >
            <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-3">
              <Flame className="w-3 h-3 inline mr-1" />
              Best Day
            </h3>
            <p className="text-sm text-white/60 mb-1">
              {new Date(report.bestDay.date + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'long', month: 'short', day: 'numeric'
              })}
            </p>
            <p className="text-3xl font-bold text-white mb-1">{report.bestDay.completedPomodoros}</p>
            <p className="text-xs text-white/25">
              pomodoros &middot; {report.bestDay.tasksCompleted} tasks done &middot; {Math.round(report.bestDay.focusMinutes)}m focus
            </p>
          </motion.div>
        )}
      </div>

      {/* Tasks worked on */}
      {report.tasksSummary.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4, ease }}
          className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
        >
          <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-3">
            <Target className="w-3 h-3 inline mr-1" />
            Tasks Worked On
          </h3>
          <div className="space-y-1.5">
            {report.tasksSummary.slice(0, 15).map((task, i) => {
              const tagInfo = getTagInfo(task.tag);
              return (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  {task.completed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400/60 flex-shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-white/10 flex-shrink-0" />
                  )}
                  <span className={`text-sm flex-1 truncate ${task.completed ? 'text-white/40' : 'text-white/60'}`}>
                    {task.title}
                  </span>
                  {tagInfo && (
                    <span
                      className="text-[8px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0"
                      style={{ color: tagInfo.color, backgroundColor: tagInfo.color + '15' }}
                    >
                      {tagInfo.label}
                    </span>
                  )}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Flame className="w-3 h-3 text-orange-400/40" />
                    <span className="text-xs text-white/30 font-mono">{task.pomodoros}</span>
                  </div>
                </div>
              );
            })}
            {report.tasksSummary.length > 15 && (
              <p className="text-[10px] text-white/20 text-center pt-2">
                +{report.tasksSummary.length - 15} more tasks
              </p>
            )}
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {report.completedPomodoros === 0 && report.totalTasks === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16"
        >
          <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="w-6 h-6 text-white/10" />
          </div>
          <p className="text-sm text-white/30 mb-1">No data for this period</p>
          <p className="text-xs text-white/15">
            Complete some pomodoros to see your reports here
          </p>
        </motion.div>
      )}
    </div>
  );
}
