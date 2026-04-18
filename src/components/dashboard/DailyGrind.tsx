'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { useTimer } from '@/hooks/useTimer';
import { formatDuration } from '@/lib/utils';
import { TASK_TAGS, type TaskTagId, type DailyTask, type Goal } from '@/types';
import {
  Plus, Trash2, Play, Pause, RotateCcw, SkipForward,
  Repeat, ChevronLeft, ChevronRight, Maximize2, Circle,
  CheckCircle2, Clock, Flame, Tag, PlusCircle, X, Calendar, Sparkles,
  CalendarPlus,
} from 'lucide-react';
import * as storage from '@/lib/storage';
import { PiPButton } from '@/components/timer/PiPButton';
import { HintBanner } from '@/components/ui/HintBanner';
import { CoachPlanPanel } from './CoachPlanPanel';
import { CoachDebriefCard } from './CoachDebriefCard';
import { MotivationMessage } from './MotivationMessage';
import { GoalProgressBar } from './GoalProgressBar';
import { AIPlanWizard } from './AIPlanWizard';
import { StreakCalendar } from './StreakCalendar';
import { AIInsightCard, AIMotivationCard } from './AICards';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

// Add `n` calendar days to a YYYY-MM-DD key using LOCAL time, so the result
// never drifts a day back/forward due to UTC conversion near midnight. We
// split the key manually instead of `new Date(dateKey)` (which parses as UTC
// for 'YYYY-MM-DD') and rebuild via local-calendar math.
function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDateLabel(dateStr: string): string {
  const today = getTodayKey();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = tomorrow.toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().split('T')[0];

  if (dateStr === today) return 'Today';
  if (dateStr === tomorrowKey) return 'Tomorrow';
  if (dateStr === yesterdayKey) return 'Yesterday';

  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getTagInfo(tagId?: TaskTagId) {
  if (!tagId) return null;
  return TASK_TAGS.find(t => t.id === tagId) || null;
}

/* ── Manual Pomodoro Entry Modal ──────────────────────────────────── */
// Outer shell returns null when closed so the body component unmounts and
// state resets naturally — avoids the setState-in-effect cascade React 19
// flags. The AnimatePresence exit animation still plays because the body
// is rendered inside it when open flips.
function ManualPomodoroModal(props: {
  open: boolean;
  onClose: () => void;
  tasks: DailyTask[];
  onSubmit: (taskId: string | null, count: number) => void;
}) {
  return (
    <AnimatePresence>
      {props.open && <ManualPomodoroBody {...props} />}
    </AnimatePresence>
  );
}

function ManualPomodoroBody({
  onClose,
  tasks,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  tasks: DailyTask[];
  onSubmit: (taskId: string | null, count: number) => void;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [count, setCount] = useState(1);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="w-full max-w-sm bg-[#131820] border border-white/10 rounded-2xl shadow-2xl"
          >
            <div className="flex items-center justify-between p-4 pb-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold text-white">Log Manual Pomodoro</h3>
              <button onClick={onClose} className="text-white/30 hover:text-white/60 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Task selection */}
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Assign to task</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {/* Unassigned option */}
                  <button
                    onClick={() => setSelectedTaskId(null)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${
                      selectedTaskId === null
                        ? 'bg-[var(--accent,#22d3ee)]/10 border border-[var(--accent,#22d3ee)]/20 text-white'
                        : 'text-white/50 hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Unassigned</span>
                  </button>
                  {tasks.filter(t => !t.completed).map(task => {
                    const tagInfo = getTagInfo(task.tag as TaskTagId);
                    return (
                      <button
                        key={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-sm ${
                          selectedTaskId === task.id
                            ? 'bg-[var(--accent,#22d3ee)]/10 border border-[var(--accent,#22d3ee)]/20 text-white'
                            : 'text-white/50 hover:bg-white/5 border border-transparent'
                        }`}
                      >
                        <span className="truncate flex-1">{task.title}</span>
                        {tagInfo && (
                          <span
                            className="text-[8px] font-medium px-1 py-0.5 rounded uppercase"
                            style={{ color: tagInfo.color, backgroundColor: tagInfo.color + '15' }}
                          >
                            {tagInfo.label}
                          </span>
                        )}
                        <span className="text-[10px] text-white/20 flex-shrink-0">
                          {task.pomodoros_done}/{task.pomodoros_target}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Count */}
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Number of pomodoros</p>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${
                        count === n
                          ? 'bg-[var(--accent,#22d3ee)]/20 text-[var(--accent,#22d3ee)] border border-[var(--accent,#22d3ee)]/30'
                          : 'bg-white/5 text-white/30 hover:text-white/50 border border-transparent'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <Button
                variant="glow"
                onClick={() => { onSubmit(selectedTaskId, count); onClose(); }}
                className="w-full gap-1.5 text-sm"
              >
                <PlusCircle className="w-4 h-4" />
                Log {count} Pomodoro{count > 1 ? 's' : ''}
              </Button>
            </div>
          </motion.div>
        </motion.div>
  );
}

/* ── Large Centered Timer Clock ───────────────────────────────────── */
function LargeTimerClock({
  timeRemaining,
  isBreak,
  progress,
  timerState,
  activeTask,
  onPause,
  onResume,
  onReset,
  onSkipBreak,
  onFocusMode,
}: {
  timeRemaining: number;
  isBreak: boolean;
  progress: number;
  timerState: string;
  activeTask: DailyTask | undefined;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onSkipBreak: () => void;
  onFocusMode: () => void;
}) {
  const ringSize = 220;
  const strokeWidth = 6;
  const radius = (ringSize - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const timerColor = isBreak ? '#22c55e' : 'var(--accent, #22d3ee)';

  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease }}
      className="flex flex-col items-center py-6"
    >
      {/* Task label */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4 text-center"
      >
        <p className="text-[10px] text-white/25 uppercase tracking-widest">
          {isBreak ? 'Break Time' : 'Focusing on'}
        </p>
        <p className="text-sm text-white/70 font-medium mt-0.5 max-w-[260px] truncate">
          {activeTask ? activeTask.title : 'Unassigned Pomodoro'}
        </p>
        {activeTask && (
          <div className="flex items-center justify-center gap-1 mt-1">
            {Array.from({ length: activeTask.pomodoros_target }).map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i < activeTask.pomodoros_done ? 'bg-[var(--accent,#22d3ee)]' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        )}
      </motion.div>

      {/* Large ring + timer */}
      <div className="relative" style={{ width: ringSize, height: ringSize }}>
        {/* Background track */}
        <svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} className="absolute inset-0 transform -rotate-90">
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={strokeWidth}
          />
          {/* Progress arc */}
          <motion.circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={radius}
            fill="none"
            stroke={timerColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{ filter: `drop-shadow(0 0 8px ${timerColor}40)` }}
          />
        </svg>

        {/* Center time display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.div
            key={timeRemaining}
            initial={{ opacity: 0.8 }}
            animate={{ opacity: 1 }}
            className="text-5xl font-mono font-bold text-white tracking-wider"
          >
            {minutes.toString().padStart(2, '0')}
            <span className="text-white/30">:</span>
            {seconds.toString().padStart(2, '0')}
          </motion.div>
          <p className="text-[10px] text-white/20 mt-1 uppercase tracking-wider">
            {isBreak ? 'Break' : 'Focus'}
          </p>
        </div>

        {/* Pulsing glow when running */}
        {timerState === 'running' && !isBreak && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: `inset 0 0 30px ${timerColor}08, 0 0 40px ${timerColor}06`,
            }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mt-6">
        {timerState === 'running' && (
          <>
            <button
              onClick={onPause}
              className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
            >
              <Pause className="w-5 h-5 fill-current" />
            </button>
            <button
              onClick={onReset}
              className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/5 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={onFocusMode}
              className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/5 transition-all"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </>
        )}
        {timerState === 'paused' && (
          <>
            <button
              onClick={onResume}
              className="w-12 h-12 rounded-2xl bg-[var(--accent,#22d3ee)]/10 border border-[var(--accent,#22d3ee)]/20 flex items-center justify-center text-[var(--accent,#22d3ee)] hover:bg-[var(--accent,#22d3ee)]/20 transition-all"
            >
              <Play className="w-5 h-5 fill-current" />
            </button>
            <button
              onClick={onReset}
              className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/25 hover:text-white/50 hover:bg-white/5 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </>
        )}
        {timerState === 'break' && (
          <button
            onClick={onSkipBreak}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white/50 hover:text-white/80 hover:bg-white/10 transition-all"
          >
            <SkipForward className="w-4 h-4" />
            Skip Break
          </button>
        )}
      </div>

      {/* PiP float button */}
      <PiPButton className="mt-2" compact />
    </motion.div>
  );
}

/* ── Main DailyGrind Component ────────────────────────────────────── */
export function DailyGrind() {
  const {
    dailyTasks,
    activeDailyTaskId,
    dailyViewDate,
    user,
    setActiveDailyTask,
    addDailyTaskForDate,
    toggleTaskComplete,
    deleteDailyTask,
    setDailyViewDate,
    updateDailyTaskDetails,
    setView,
    addToast,
    refreshDailyTasks,
    requestPlanMyDay,
    coachPlanLoading,
    activeGoal,
    dashboardStats,
    goals,
    setShowAIPlanWizard,
  } = useStore();

  const {
    timerState,
    timeRemaining,
    isBreak,
    startTimer: _startTimer,
    pauseTimer,
    resumeTimer,
    skipBreak,
    resetTimer,
  } = useTimer();

  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPomodoros, setNewTaskPomodoros] = useState(1);
  const [newTaskRepeating, setNewTaskRepeating] = useState(false);
  const [newTaskTag, setNewTaskTag] = useState<TaskTagId | undefined>(undefined);
  const [showManualPomodoro, setShowManualPomodoro] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isToday = dailyViewDate === getTodayKey();
  const isFutureDate = dailyViewDate > getTodayKey();

  // Filter to the currently-viewed date defensively. When a task is
  // rolled to tomorrow, its `date` changes but the in-memory store still
  // holds the row until a refresh — this filter makes the rolled task
  // fall out of the list immediately so the exit animation plays.
  const visibleTasks = dailyTasks.filter(t => t.date === dailyViewDate);
  const completedTasks = visibleTasks.filter(t => t.completed);
  const pendingTasks = visibleTasks.filter(t => !t.completed);
  const totalPomodoros = visibleTasks.reduce((sum, t) => sum + t.pomodoros_target, 0);
  const donePomodoros = visibleTasks.reduce((sum, t) => sum + t.pomodoros_done, 0);

  const todayKey = getTodayKey();
  // Only offer "roll to tomorrow" on today/past tasks — not future-dated ones.
  const canRollForward = dailyViewDate <= todayKey;

  // Roll forward by one day RELATIVE to the task's own date — so a task from
  // two days ago moves to yesterday, another click moves it to today, etc.
  // Previously this hard-jumped to today+1, which skipped intermediate days
  // and made multi-day backlogs unmanageable.
  const handleRollToTomorrow = (task: DailyTask) => {
    const next = addDays(task.date, 1);
    updateDailyTaskDetails(task.id, { date: next });
    addToast(`"${task.title}" rolled to ${formatDateLabel(next)}`, 'success');
  };

  const activeTask = dailyTasks.find(t => t.id === activeDailyTaskId);
  const isTimerActive = timerState === 'running' || timerState === 'paused' || timerState === 'break';

  useEffect(() => {
    if (showAddTask && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showAddTask]);

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) {
      addToast('Please enter a task name', 'warning');
      inputRef.current?.focus();
      return;
    }
    addDailyTaskForDate(newTaskTitle.trim(), dailyViewDate, newTaskPomodoros, newTaskRepeating, newTaskTag);
    setNewTaskTitle('');
    setNewTaskPomodoros(1);
    setNewTaskRepeating(false);
    setNewTaskTag(undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddTask();
    if (e.key === 'Escape') { setShowAddTask(false); setNewTaskTitle(''); }
  };

  const goToPreviousDay = () => {
    const d = new Date(dailyViewDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    setDailyViewDate(d.toISOString().split('T')[0]);
  };

  const goToNextDay = () => {
    const d = new Date(dailyViewDate + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    setDailyViewDate(d.toISOString().split('T')[0]);
  };

  const goToToday = () => setDailyViewDate(getTodayKey());

  const goToTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    setDailyViewDate(d.toISOString().split('T')[0]);
  };

  const handleStartPomodoro = (taskId: string) => {
    setActiveDailyTask(taskId);
    _startTimer();
  };

  const handleStartUnassigned = () => {
    setActiveDailyTask(null);
    _startTimer();
  };

  const handleManualPomodoro = (taskId: string | null, count: number) => {
    if (taskId) {
      const task = dailyTasks.find(t => t.id === taskId);
      if (task) {
        const newPomodorosDone = (task.pomodoros_done || 0) + count;
        const isNowComplete = newPomodorosDone >= task.pomodoros_target;

        // Update through the store
        updateDailyTaskDetails(taskId, {
          pomodoros_done: newPomodorosDone,
          completed: isNowComplete,
        });

        addToast(`Logged ${count} pomodoro${count > 1 ? 's' : ''} for "${task.title}"`, 'success');
      }
    } else {
      // Unassigned — just show toast, counted in daily totals conceptually
      addToast(`Logged ${count} unassigned pomodoro${count > 1 ? 's' : ''}`, 'success');
    }
  };

  // Timer calculations
  const focusDuration = user?.settings?.focus_duration || 25 * 60;
  const breakDuration = user?.settings?.break_duration || 5 * 60;

  // Total estimated work time (all pomodoros * focus duration)
  const totalEstMinutes = totalPomodoros * (focusDuration / 60);
  const totalEstHours = Math.floor(totalEstMinutes / 60);
  const totalEstMins = Math.round(totalEstMinutes % 60);
  const progress = isBreak
    ? 1 - (timeRemaining / breakDuration)
    : 1 - (timeRemaining / focusDuration);

  // Daily insights
  const focusMinutes = donePomodoros * (focusDuration / 60);
  const focusHours = Math.floor(focusMinutes / 60);
  const focusMins = Math.round(focusMinutes % 60);

  // Tag breakdown
  const tagBreakdown = dailyTasks.reduce<Record<string, { done: number; total: number; label: string; color: string }>>((acc, t) => {
    const tag = t.tag || 'untagged';
    const info = getTagInfo(t.tag as TaskTagId);
    if (!acc[tag]) {
      acc[tag] = { done: 0, total: 0, label: info?.label || 'Other', color: info?.color || 'rgba(255,255,255,0.2)' };
    }
    acc[tag].total += t.pomodoros_target;
    acc[tag].done += t.pomodoros_done;
    return acc;
  }, {});

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left column: Calendar + AI Insight */}
      <div className="lg:col-span-3 space-y-4">
        <StreakCalendar
          dailySessions={dashboardStats?.daily_sessions || []}
          recommendedDaily={activeGoal?.recommended_sessions_per_day}
          focusDurationSec={user?.settings?.focus_duration ?? 25 * 60}
        />
        <AIInsightCard
          sessionsCompleted={donePomodoros}
          sessionsTotal={totalPomodoros}
          streakDays={dashboardStats?.current_streak ?? 0}
          context="daily"
        />
      </div>

      {/* Main column */}
      <div className="lg:col-span-5 space-y-4">
        {/* Date nav + progress */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <button onClick={goToPreviousDay} className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="text-lg font-bold text-white min-w-[100px] text-center">
                {formatDateLabel(dailyViewDate)}
              </h2>
              <button onClick={goToNextDay} className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all">
                <ChevronRight className="w-4 h-4" />
              </button>
              {!isToday && (
                <button onClick={goToToday} className="text-xs px-2 py-1 rounded-lg bg-white/5 text-white/40 hover:text-white/70 transition-all ml-1">
                  Today
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/25 font-mono">{donePomodoros}/{totalPomodoros}</span>
              {isToday && (
                <button
                  onClick={() => setShowManualPomodoro(true)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-white/5 text-white/30 hover:text-white/60 hover:bg-white/10 transition-all flex items-center gap-1"
                  title="Log manual pomodoro"
                >
                  <PlusCircle className="w-3 h-3" />
                  Log
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {totalPomodoros > 0 && (
            <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden mb-2">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: 'var(--accent, #22d3ee)' }}
                animate={{ width: `${(donePomodoros / totalPomodoros) * 100}%` }}
                transition={{ duration: 0.5, ease }}
              />
            </div>
          )}

          {/* Daily totals bar */}
          {totalPomodoros > 0 && (
            <div className="flex items-center justify-between text-xs text-white/30">
              <span>
                {donePomodoros} of {totalPomodoros} pomodoros done
              </span>
              <span>
                {totalEstHours > 0 ? `${totalEstHours}h ` : ''}{totalEstMins}m total work planned
              </span>
            </div>
          )}

          {/* Plan buttons row */}
          <div className="mt-2 flex items-center gap-4">
            {/* Plan My Day with AI button */}
            <button
              onClick={() => setShowAIPlanWizard(true)}
              disabled={coachPlanLoading}
              className="relative flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 hover:border-cyan-500/40 text-cyan-400 text-sm font-medium transition-all hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] disabled:opacity-40"
            >
              <Sparkles className="w-4 h-4" />
              {coachPlanLoading ? 'Planning...' : 'Plan My Day with AI'}
            </button>

            {/* Plan Tomorrow button */}
            {isToday && (
              <button
                onClick={() => {
                  goToTomorrow();
                  addToast('Switched to tomorrow — add tasks for your next day', 'info');
                }}
                className="flex items-center gap-1.5 text-xs text-white/20 hover:text-[var(--accent,#22d3ee)]/60 transition-colors"
              >
                <Calendar className="w-3.5 h-3.5" />
                Plan Tomorrow
              </button>
            )}
          </div>
        </motion.div>

        {/* ── AI Coach Panels ── */}
        <AIPlanWizard />
        <CoachPlanPanel />
        <CoachDebriefCard />

        {/* AI motivation message — shown before timer starts */}
        {isToday && !isTimerActive && activeGoal && (
          <MotivationMessage
            taskTitle={activeTask?.title}
            goalTitle={activeGoal.title}
            sessionsCompleted={activeGoal.sessions_completed}
            sessionsTotal={activeGoal.estimated_sessions_current}
            streakDays={dashboardStats?.current_streak ?? 0}
            userName={user?.name || 'there'}
          />
        )}

        {/* ── LARGE CENTERED TIMER ─── when a pomodoro is active */}
        <AnimatePresence>
          {isToday && isTimerActive && (
            <LargeTimerClock
              timeRemaining={timeRemaining}
              isBreak={isBreak}
              progress={progress}
              timerState={timerState}
              activeTask={activeTask}
              onPause={pauseTimer}
              onResume={resumeTimer}
              onReset={resetTimer}
              onSkipBreak={skipBreak}
              onFocusMode={() => setView('focus')}
            />
          )}
        </AnimatePresence>

        {/* Hint for first-time Daily Grind users */}
        <HintBanner id="daily-grind-intro">
          Add tasks and assign pomodoros for your day. Use <strong className="text-cyan-400/70">Plan My Day with AI</strong> to let AI build your schedule automatically.
        </HintBanner>

        {/* Task list — framed panel so the day's plan reads as a distinct block */}
        {pendingTasks.length > 0 && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <p className="text-[10px] text-white/30 uppercase tracking-widest">
                {isToday ? "Today's tasks" : 'Tasks'} ({pendingTasks.length})
              </p>
              <p className="text-[10px] text-white/20">
                {donePomodoros}/{totalPomodoros} pom
              </p>
            </div>
            <div className="space-y-1.5">
              <AnimatePresence>
                {pendingTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isActive={task.id === activeDailyTaskId && isTimerActive}
                    isToday={isToday}
                    onToggle={() => toggleTaskComplete(task.id)}
                    onDelete={() => deleteDailyTask(task.id)}
                    onStart={() => handleStartPomodoro(task.id)}
                    onExtend={() => updateDailyTaskDetails(task.id, { pomodoros_target: task.pomodoros_target + 1 })}
                    // Only surface the roll action on today/past pending, non-repeating
                    // tasks. Repeating tasks auto-generate fresh copies tomorrow, so
                    // rolling them would double up.
                    onRollToTomorrow={
                      canRollForward && !task.repeating
                        ? () => handleRollToTomorrow(task)
                        : undefined
                    }
                    timerBusy={isTimerActive}
                    goals={goals}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Quick start unassigned pomodoro */}
        {isToday && !isTimerActive && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={handleStartUnassigned}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-white/20 hover:text-[var(--accent,#22d3ee)]/60 hover:bg-[var(--accent,#22d3ee)]/[0.03] transition-all text-xs border border-dashed border-white/[0.04] hover:border-[var(--accent,#22d3ee)]/15"
          >
            <Play className="w-3 h-3 fill-current" />
            Start unassigned pomodoro
          </motion.button>
        )}

        {/* Add task */}
        <AnimatePresence mode="wait">
          {showAddTask ? (
            <motion.div
              key="add-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02] space-y-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="What needs doing?"
                  className="w-full bg-transparent text-sm text-white placeholder:text-white/25 focus:outline-none"
                />

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Pomodoro count */}
                  <div className="flex items-center gap-1 mr-1">
                    <Clock className="w-3 h-3 text-white/20" />
                    {[1, 2, 3, 4].map(n => (
                      <button
                        key={n}
                        onClick={() => setNewTaskPomodoros(n)}
                        className={`w-6 h-6 rounded-md text-xs font-medium transition-all ${
                          newTaskPomodoros >= n
                            ? 'bg-[var(--accent,#22d3ee)]/20 text-[var(--accent,#22d3ee)]'
                            : 'bg-white/5 text-white/20 hover:text-white/40'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>

                  <div className="w-px h-4 bg-white/[0.06]" />

                  {/* Tag selector */}
                  <div className="flex items-center gap-1">
                    {TASK_TAGS.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => setNewTaskTag(newTaskTag === tag.id ? undefined : tag.id)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all border ${
                          newTaskTag === tag.id
                            ? 'border-current'
                            : 'border-transparent hover:bg-white/5'
                        }`}
                        style={{ color: newTaskTag === tag.id ? tag.color : 'rgba(255,255,255,0.25)' }}
                      >
                        {tag.label}
                      </button>
                    ))}
                  </div>

                  <div className="w-px h-4 bg-white/[0.06]" />

                  {/* Repeat */}
                  <button
                    onClick={() => setNewTaskRepeating(!newTaskRepeating)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${
                      newTaskRepeating
                        ? 'bg-[var(--accent,#22d3ee)]/10 text-[var(--accent,#22d3ee)]'
                        : 'text-white/25 hover:text-white/40'
                    }`}
                  >
                    <Repeat className="w-3 h-3" />
                    Daily
                  </button>
                </div>

                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-white/[0.04]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowAddTask(false); setNewTaskTitle(''); }}
                    className="text-xs h-7 px-2"
                  >
                    Done
                  </Button>
                  <Button
                    variant="glow"
                    size="sm"
                    onClick={handleAddTask}
                    disabled={!newTaskTitle.trim()}
                    className="text-xs h-7 px-4"
                  >
                    Add
                  </Button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="add-btn"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => setShowAddTask(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-white/25 hover:text-white/50 hover:bg-white/[0.02] transition-all text-sm border border-dashed border-white/[0.06] hover:border-white/10"
            >
              <Plus className="w-4 h-4" />
              Add task{isFutureDate ? ` for ${formatDateLabel(dailyViewDate)}` : ''}
            </motion.button>
          )}
        </AnimatePresence>

        {/* Completed */}
        {completedTasks.length > 0 && (
          <div className="mt-4 rounded-2xl border border-white/[0.05] bg-white/[0.01] p-2">
            <p className="text-[10px] text-white/25 uppercase tracking-widest mb-2 px-2 pt-1">
              Done ({completedTasks.length})
            </p>
            <div className="space-y-1">
              {completedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isActive={false}
                  isToday={isToday}
                  onToggle={() => toggleTaskComplete(task.id)}
                  onDelete={() => deleteDailyTask(task.id)}
                  onStart={() => {}}
                  onExtend={() => {}}
                  timerBusy={false}
                  completed
                  goals={goals}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty */}
        {dailyTasks.length === 0 && !showAddTask && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4">
              <Plus className="w-6 h-6 text-white/10" />
            </div>
            <p className="text-sm text-white/30 mb-1">
              {isFutureDate ? 'Plan your day ahead' : 'Ready to start your day?'}
            </p>
            <p className="text-xs text-white/15 mb-4">
              Add tasks, assign pomodoros, and work through them
            </p>
            <Button variant="glow" size="sm" onClick={() => setShowAddTask(true)} className="gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Add your first task
            </Button>
          </motion.div>
        )}
      </div>

      {/* Right sidebar: insights */}
      <div className="lg:col-span-4 space-y-4">
        <AIMotivationCard
          sessionsCompleted={donePomodoros}
          sessionsTotal={totalPomodoros}
          streakDays={dashboardStats?.current_streak ?? 0}
          userName={useStore.getState().user?.name || 'there'}
        />
        {/* Today's Charter progress */}
        {activeGoal && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.4, ease }}
            className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
          >
            <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-3">Today&apos;s Charter</h3>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-white/70">{donePomodoros} of {totalPomodoros} pomodoros</p>
              <span className="text-xs text-white/30">{totalPomodoros > 0 ? Math.round((donePomodoros / totalPomodoros) * 100) : 0}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: 'var(--accent, #22d3ee)' }}
                animate={{ width: `${totalPomodoros > 0 ? (donePomodoros / totalPomodoros) * 100 : 0}%` }}
                transition={{ duration: 0.5, ease }}
              />
            </div>
            <p className="text-[10px] text-white/20 mt-2">{completedTasks.length} of {dailyTasks.length} tasks completed</p>
          </motion.div>
        )}

        {/* Today's stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease }}
          className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
        >
          <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-3">
            {isToday ? "Today's Focus" : formatDateLabel(dailyViewDate)}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="w-3 h-3 text-[var(--accent,#22d3ee)]" />
                <span className="text-[10px] text-white/30 uppercase">Time</span>
              </div>
              <p className="text-lg font-bold text-white">
                {focusHours > 0 ? `${focusHours}h ${focusMins}m` : `${focusMins}m`}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Flame className="w-3 h-3 text-orange-400" />
                <span className="text-[10px] text-white/30 uppercase">Sessions</span>
              </div>
              <p className="text-lg font-bold text-white">
                {donePomodoros}<span className="text-sm text-white/25 font-normal">/{totalPomodoros}</span>
              </p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="w-3 h-3 text-green-400" />
                <span className="text-[10px] text-white/30 uppercase">Tasks</span>
              </div>
              <p className="text-lg font-bold text-white">
                {completedTasks.length}<span className="text-sm text-white/25 font-normal">/{dailyTasks.length}</span>
              </p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Tag className="w-3 h-3 text-purple-400" />
                <span className="text-[10px] text-white/30 uppercase">Focus</span>
              </div>
              <p className="text-lg font-bold text-white">
                {totalPomodoros > 0 ? Math.round((donePomodoros / totalPomodoros) * 100) : 0}
                <span className="text-sm text-white/25 font-normal">%</span>
              </p>
            </div>
          </div>
        </motion.div>

        {/* Effort breakdown by tag */}
        {Object.keys(tagBreakdown).length > 0 && totalPomodoros > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4, ease }}
            className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
          >
            <h3 className="text-[10px] text-white/25 uppercase tracking-widest mb-3">Effort Breakdown</h3>

            <div className="h-3 rounded-full bg-white/[0.04] overflow-hidden flex mb-3">
              {Object.entries(tagBreakdown).map(([key, val]) => (
                <motion.div
                  key={key}
                  initial={{ width: 0 }}
                  animate={{ width: `${(val.total / totalPomodoros) * 100}%` }}
                  transition={{ duration: 0.5, ease }}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ backgroundColor: val.color, opacity: val.done > 0 ? 1 : 0.3 }}
                />
              ))}
            </div>

            <div className="space-y-1.5">
              {Object.entries(tagBreakdown).map(([key, val]) => (
                <div key={key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: val.color }} />
                    <span className="text-xs text-white/50">{val.label}</span>
                  </div>
                  <span className="text-xs text-white/30 font-mono">{val.done}/{val.total}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Manual Pomodoro Modal */}
      <ManualPomodoroModal
        open={showManualPomodoro}
        onClose={() => setShowManualPomodoro(false)}
        tasks={dailyTasks}
        onSubmit={handleManualPomodoro}
      />
    </div>
  );
}

/* ── TaskRow ──────────────────────────────────────────────────────── */
function TaskRow({
  task,
  isActive,
  isToday,
  onToggle,
  onDelete,
  onStart,
  onExtend,
  onRollToTomorrow,
  timerBusy,
  completed = false,
  goals = [],
}: {
  task: DailyTask;
  isActive: boolean;
  isToday: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onStart: () => void;
  onExtend: () => void;
  onRollToTomorrow?: () => void;
  timerBusy: boolean;
  completed?: boolean;
  goals?: Goal[];
}) {
  const tagInfo = getTagInfo(task.tag as TaskTagId);
  const linkedGoal = task.goal_id ? goals.find(g => g.id === task.goal_id) : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
        isActive && !completed
          ? 'bg-[var(--accent,#22d3ee)]/[0.06] border border-[var(--accent,#22d3ee)]/30 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]'
          : completed
            ? 'bg-white/[0.015] border border-white/[0.04] opacity-50'
            : 'bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14]'
      } ${task.goal_id ? 'border-l-2 border-l-violet-500/60' : ''}`}
    >
      {/* Play / Checkbox area */}
      {!completed && isToday ? (
        <button
          onClick={timerBusy ? onToggle : onStart}
          className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
            timerBusy
              ? 'text-white/15 hover:text-white/30'
              : 'text-[var(--accent,#22d3ee)]/60 hover:text-[var(--accent,#22d3ee)] hover:bg-[var(--accent,#22d3ee)]/10'
          }`}
          title={timerBusy ? 'Mark complete' : 'Start pomodoro'}
        >
          {timerBusy ? (
            <Circle className="w-[18px] h-[18px]" />
          ) : (
            <Play className="w-4 h-4 fill-current" />
          )}
        </button>
      ) : (
        <button onClick={onToggle} className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors">
          {completed ? (
            <CheckCircle2 className="w-[18px] h-[18px] text-[var(--accent,#22d3ee)]" />
          ) : (
            <Circle className="w-[18px] h-[18px] text-white/15 hover:text-white/30" />
          )}
        </button>
      )}

      {/* Task content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-sm leading-tight truncate ${
            completed ? 'text-white/30 line-through' : 'text-white/80'
          }`}>
            {task.title}
          </p>
          {task.repeating && !completed && (
            <Repeat className="w-2.5 h-2.5 text-white/15 flex-shrink-0" />
          )}
          {linkedGoal && !completed && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400/80 flex-shrink-0 whitespace-nowrap truncate max-w-[100px]">
              {linkedGoal.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {tagInfo && (
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded-md uppercase tracking-wider"
              style={{
                color: tagInfo.color,
                backgroundColor: tagInfo.color + '15',
              }}
            >
              {tagInfo.label}
            </span>
          )}
          <div className="flex items-center gap-0.5">
            {Array.from({ length: task.pomodoros_target }).map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i < task.pomodoros_done
                    ? 'bg-[var(--accent,#22d3ee)]'
                    : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Extend by +1 pomodoro */}
      {!completed && (
        <button
          onClick={onExtend}
          className="flex-shrink-0 px-1.5 py-1 rounded-lg text-[10px] font-medium text-white/0 group-hover:text-white/20 hover:!text-[var(--accent,#22d3ee)] hover:bg-[var(--accent,#22d3ee)]/10 transition-all"
          title="Add 1 more pomodoro"
        >
          +1
        </button>
      )}

      {/* Roll to tomorrow (on hover) — only for uncompleted, rollable tasks */}
      {!completed && onRollToTomorrow && (
        <button
          onClick={onRollToTomorrow}
          className="flex-shrink-0 p-1.5 rounded-lg text-white/0 group-hover:text-white/15 hover:!text-amber-300 hover:bg-amber-400/10 transition-all"
          title="Roll forward one day"
          aria-label="Roll this task forward by one day"
        >
          <CalendarPlus className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Delete (on hover) */}
      {!completed && (
        <button
          onClick={onDelete}
          className="flex-shrink-0 p-1.5 rounded-lg text-white/0 group-hover:text-white/15 hover:!text-red-400 hover:bg-red-500/10 transition-all"
          title="Delete task"
          aria-label="Delete task"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
  );
}
