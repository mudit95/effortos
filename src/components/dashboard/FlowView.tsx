'use client';

/* ─────────────────────────────────────────────────────────────────────
 * FlowView
 * --------------------------------------------------------------------
 * Third lens over the same daily task list. Two-column "Plan vs Done"
 * split:
 *
 *   ┌──────────────────────┬──────────────────────┐
 *   │ Plan (pending tasks) │ Done (today ledger)  │
 *   │ — active task pinned │ — entries stamp in   │
 *   │   at the top w/ ring │   as pomodoros land  │
 *   └──────────────────────┴──────────────────────┘
 *
 * Same data, different framing. The point is the loop: you see what you
 * planned on the left, and watch the right column fill up. List view
 * shows tasks; this view shows progress.
 *
 * The Done column reads from `dailyTasks` (already in the store) rather
 * than from individual sessions, because per-session timestamps would
 * require a network fetch on every render. We aggregate at task level —
 * one row per task with `pomodoros_done > 0` — which matches the unit
 * the user actually thinks in ("I cleared two tasks this morning").
 * Fully-completed tasks use `completed_at` for the timestamp; partials
 * fall back to "in progress".
 *
 * The left column reuses TaskRow from DailyGrind so the active-task
 * highlight, tag pills, repeat indicator, and goal links all behave
 * identically across List and Flow.
 * ──────────────────────────────────────────────────────────────────── */

import React, { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, CircleDot, Clock } from 'lucide-react';
import { TaskRow } from './DailyGrind';
import type { DailyTask, Goal, TaskTagId } from '@/types';
import { TASK_TAGS } from '@/types';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

function getTagInfo(tagId?: TaskTagId) {
  if (!tagId) return null;
  return TASK_TAGS.find(t => t.id === tagId) || null;
}

function formatStamp(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Total minutes spent on a task = pomodoros_done × focus_duration. */
function minutesOnTask(task: DailyTask, focusSeconds: number): number {
  return Math.round((task.pomodoros_done * focusSeconds) / 60);
}

export interface FlowViewProps {
  /** All tasks scoped to the currently-viewed date (pending + completed). */
  tasks: DailyTask[];
  activeTaskId: string | null;
  isTimerActive: boolean;
  isToday: boolean;
  /** Whether "Roll to tomorrow" should be offered (today + past days). */
  canRollForward: boolean;
  goals: Goal[];
  /** From user.settings — used to compute time-spent in the Done column. */
  focusDurationSeconds: number;
  onToggleComplete: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onStart: (taskId: string) => void;
  onExtend: (taskId: string) => void;
  onRollToTomorrow: (task: DailyTask) => void;
}

export function FlowView({
  tasks,
  activeTaskId,
  isTimerActive,
  isToday,
  canRollForward,
  goals,
  focusDurationSeconds,
  onToggleComplete,
  onDelete,
  onStart,
  onExtend,
  onRollToTomorrow,
}: FlowViewProps) {
  // ── Plan column ──────────────────────────────────────────────────────
  // Active task pinned to the top, then the rest of the pending tasks in
  // their existing order. Pinning the active task means a long backlog
  // can't push the in-progress row off-screen mid-session.
  const planTasks = useMemo(() => {
    const pending = tasks.filter(t => !t.completed);
    if (!activeTaskId) return pending;
    const active = pending.find(t => t.id === activeTaskId);
    if (!active) return pending;
    return [active, ...pending.filter(t => t.id !== activeTaskId)];
  }, [tasks, activeTaskId]);

  // ── Done column ──────────────────────────────────────────────────────
  // Anything with at least one pomodoro logged. Sort: fully-completed
  // tasks first (by completed_at desc — most recent stamp on top), then
  // partials (in-progress, no completion timestamp yet). This way the
  // ledger reads as a chronological "what landed today" list.
  const doneEntries = useMemo(() => {
    const withProgress = tasks.filter(t => t.pomodoros_done > 0 || t.completed);
    return withProgress.sort((a, b) => {
      // Fully completed before partial
      if (a.completed && !b.completed) return -1;
      if (!a.completed && b.completed) return 1;
      // Among completed, most recent first
      if (a.completed && b.completed) {
        return (b.completed_at || '').localeCompare(a.completed_at || '');
      }
      // Among partials, more pomodoros done first
      return b.pomodoros_done - a.pomodoros_done;
    });
  }, [tasks]);

  const totalDonePomodoros = doneEntries.reduce((sum, t) => sum + t.pomodoros_done, 0);
  const totalDoneMinutes = Math.round((totalDonePomodoros * focusDurationSeconds) / 60);
  const totalDoneHours = Math.floor(totalDoneMinutes / 60);
  const remainderMins = totalDoneMinutes % 60;
  const elapsedLabel =
    totalDoneHours > 0 ? `${totalDoneHours}h ${remainderMins}m` : `${totalDoneMinutes}m`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* ── Plan column ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <p className="text-[10px] text-white/30 uppercase tracking-widest">
            Plan ({planTasks.length})
          </p>
          {activeTaskId && isTimerActive && (
            <span className="text-[10px] text-[var(--accent,#22d3ee)]/70 flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent,#22d3ee)] opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--accent,#22d3ee)]" />
              </span>
              In progress
            </span>
          )}
        </div>
        {planTasks.length > 0 ? (
          <div className="space-y-1.5">
            <AnimatePresence>
              {planTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isActive={task.id === activeTaskId && isTimerActive}
                  isToday={isToday}
                  onToggle={() => onToggleComplete(task.id)}
                  onDelete={() => onDelete(task.id)}
                  onStart={() => onStart(task.id)}
                  onExtend={() => onExtend(task.id)}
                  onRollToTomorrow={
                    canRollForward && !task.repeating
                      ? () => onRollToTomorrow(task)
                      : undefined
                  }
                  timerBusy={isTimerActive}
                  goals={goals}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-xs text-white/25">
            Plan&rsquo;s clear. Add a task or pick the next one to grind.
          </div>
        )}
      </div>

      {/* ── Done column ── */}
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01] p-2">
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <p className="text-[10px] text-white/30 uppercase tracking-widest">
            Done ({doneEntries.length})
          </p>
          {totalDonePomodoros > 0 && (
            <p className="text-[10px] text-white/30 tabular-nums">
              {totalDonePomodoros}p &middot; {elapsedLabel}
            </p>
          )}
        </div>

        {doneEntries.length > 0 ? (
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {doneEntries.map(task => {
                const tagInfo = getTagInfo(task.tag);
                const stamp = formatStamp(task.completed_at);
                const mins = minutesOnTask(task, focusDurationSeconds);
                const isFullyDone = task.completed;
                return (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
                    transition={{ duration: 0.25, ease }}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border ${
                      isFullyDone
                        ? 'bg-emerald-500/[0.04] border-emerald-500/[0.12]'
                        : 'bg-white/[0.02] border-white/[0.05]'
                    }`}
                  >
                    {isFullyDone ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400/80 flex-shrink-0" />
                    ) : (
                      <CircleDot className="w-4 h-4 text-[var(--accent,#22d3ee)]/60 flex-shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-xs leading-tight truncate ${
                          isFullyDone ? 'text-white/70' : 'text-white/80'
                        }`}
                      >
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {tagInfo && (
                          <span
                            className="text-[8px] font-medium px-1 py-0.5 rounded uppercase tracking-wider"
                            style={{
                              color: tagInfo.color,
                              backgroundColor: tagInfo.color + '15',
                            }}
                          >
                            {tagInfo.label}
                          </span>
                        )}
                        <span className="text-[10px] text-white/30 tabular-nums flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {mins}m
                        </span>
                        <span className="text-[10px] text-white/25 tabular-nums">
                          {task.pomodoros_done}/{task.pomodoros_target}p
                        </span>
                      </div>
                    </div>

                    {/* Right-aligned timestamp — only present for completed
                        tasks since partials don't have a meaningful "stamp"
                        time (they're still accruing). */}
                    {stamp && (
                      <span className="text-[10px] text-white/30 tabular-nums flex-shrink-0">
                        {stamp}
                      </span>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-xs text-white/25">
            No pomodoros logged yet today.
            {isToday && (
              <p className="mt-1 text-[11px] text-white/20">
                Hit play on a task and watch this column fill up.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
