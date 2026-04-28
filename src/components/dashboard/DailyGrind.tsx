'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { useTimer } from '@/hooks/useTimer';
import { getLocalTodayKey, toLocalDateKey } from '@/lib/utils';
import { TASK_TAGS, type TaskTagId, type DailyTask, type Goal, type OtherTodo } from '@/types';
import {
  Plus, Trash2, Play, Pause, RotateCcw, SkipForward,
  Repeat, ChevronLeft, ChevronRight, Maximize2, Circle,
  CheckCircle2, Clock, Flame, PlusCircle, X, Calendar, Sparkles,
  CalendarPlus, List, LayoutGrid, ListTodo,
} from 'lucide-react';
import { PiPButton } from '@/components/timer/PiPButton';
import { HintBanner } from '@/components/ui/HintBanner';
import { CoachPlanPanel } from './CoachPlanPanel';
import { CoachDebriefCard } from './CoachDebriefCard';
// MotivationMessage (the italic AI quote above the task list) was removed
// during the density pass — AIMotivationCard in the right rail covers the
// same job, so having both created a third pep talk on a single screen.
import { AIPlanWizard } from './AIPlanWizard';
import { StreakCalendar } from './StreakCalendar';
// AIInsightCard lives on the long-term dashboard; the daily view only
// surfaces a single AI pep talk via AIMotivationCard in the right rail.
// Having two AI text blocks stacked in the same viewport created
// redundant "motivate the user" real estate.
import { AIMotivationCard } from './AICards';
import { TimeBoxView } from './TimeBoxView';
import { OtherTodosDrawer } from './OtherTodosDrawer';
import { countOpenOtherTodos, listOtherTodos } from '@/lib/other-todos';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

function getTodayKey(): string {
  return getLocalTodayKey();
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
  const tomorrowKey = toLocalDateKey(tomorrow);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toLocalDateKey(yesterday);

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

/* ── Compact Timer Cockpit (left-rail) ────────────────────────────── */
// Used to be a large centred clock that lived in the middle column. The
// new workbench layout pins the timer to the left rail instead, so it's
// always next to the streak calendar and never has to compete for the
// task-list real estate. The component keeps the same control surface
// (pause / resume / reset / skip-break / focus-mode) but renders smaller
// to fit the narrower column.
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
  const ringSize = 168;
  const strokeWidth = 5;
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
      className="flex flex-col items-center p-4 rounded-2xl border border-[var(--accent,#22d3ee)]/20 bg-[var(--accent,#22d3ee)]/[0.04]"
    >
      {/* Task label */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-3 text-center w-full"
      >
        <p className="text-[9px] text-[var(--accent,#22d3ee)]/70 uppercase tracking-widest font-medium">
          {isBreak ? 'Break Time' : 'Now focusing'}
        </p>
        <p className="text-[13px] text-white/85 font-medium mt-0.5 leading-tight px-1 truncate">
          {activeTask ? activeTask.title : 'Unassigned Pomodoro'}
        </p>
        {activeTask && (
          <div className="flex items-center justify-center gap-1 mt-1.5">
            {Array.from({ length: activeTask.pomodoros_target }).map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
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
            className="text-3xl font-mono font-bold text-white tracking-tight tabular-nums"
          >
            {minutes.toString().padStart(2, '0')}
            <span className="text-white/30">:</span>
            {seconds.toString().padStart(2, '0')}
          </motion.div>
          <p className="text-[9px] text-white/25 mt-0.5 uppercase tracking-wider">
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

      {/* Controls — three slots: reset, primary action, focus-mode. Equal
          width so the row reads as a deliberate cockpit, not a scattered
          set of icons. */}
      <div className="flex items-center gap-1.5 mt-4 w-full">
        {timerState === 'running' && (
          <>
            <button
              onClick={onReset}
              className="flex-1 h-9 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
              title="Reset"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onPause}
              className="flex-[2] h-9 rounded-lg bg-[var(--accent,#22d3ee)]/15 border border-[var(--accent,#22d3ee)]/25 flex items-center justify-center gap-1.5 text-[var(--accent,#22d3ee)] hover:bg-[var(--accent,#22d3ee)]/20 transition-all text-xs font-medium"
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              Pause
            </button>
            <button
              onClick={onFocusMode}
              className="flex-1 h-9 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
              title="Enter focus mode"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        {timerState === 'paused' && (
          <>
            <button
              onClick={onReset}
              className="flex-1 h-9 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
              title="Reset"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onResume}
              className="flex-[2] h-9 rounded-lg bg-[var(--accent,#22d3ee)] border border-[var(--accent,#22d3ee)] flex items-center justify-center gap-1.5 text-[#062028] hover:brightness-110 transition-all text-xs font-medium"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Resume
            </button>
            <button
              onClick={onFocusMode}
              className="flex-1 h-9 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
              title="Enter focus mode"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        {timerState === 'break' && (
          <button
            onClick={onSkipBreak}
            className="w-full h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center gap-1.5 text-xs text-white/55 hover:text-white/80 hover:bg-white/[0.06] transition-all"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip Break
          </button>
        )}
      </div>

      {/* PiP float button — small text-only chip beneath the controls. */}
      <PiPButton className="mt-2" compact />
    </motion.div>
  );
}

/* ── Idle Timer Placeholder ───────────────────────────────────────── */
// Shown in the left rail when no pomodoro is running, so the cockpit
// area never collapses to a void. Quiet visual: dim ring, small CTA.
// Click pulls focus to the task list to remind users where to start.
function IdleTimerPlaceholder({
  onStartUnassigned,
  hasTasks,
}: {
  onStartUnassigned: () => void;
  hasTasks: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease }}
      className="flex flex-col items-center p-4 rounded-2xl border border-white/[0.05] bg-white/[0.015]"
    >
      <p className="text-[9px] text-white/30 uppercase tracking-widest font-medium mb-1.5">
        Ready when you are
      </p>
      <p className="text-[13px] text-white/55 font-medium mb-3 text-center leading-tight px-1">
        {hasTasks ? 'Click play on a task to begin' : 'Add tasks to start a session'}
      </p>

      <div className="relative w-[168px] h-[168px] flex items-center justify-center">
        <svg width="168" height="168" viewBox="0 0 168 168" className="absolute inset-0 transform -rotate-90">
          <circle cx="84" cy="84" r="79" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5" />
        </svg>
        <div className="flex flex-col items-center">
          <Play className="w-6 h-6 text-white/15" />
          <p className="text-[10px] text-white/20 mt-2 uppercase tracking-wider">Idle</p>
        </div>
      </div>

      <button
        onClick={onStartUnassigned}
        className="mt-4 w-full h-9 rounded-lg bg-white/[0.03] border border-dashed border-white/[0.08] flex items-center justify-center gap-1.5 text-xs text-white/45 hover:text-[var(--accent,#22d3ee)]/80 hover:border-[var(--accent,#22d3ee)]/20 hover:bg-[var(--accent,#22d3ee)]/[0.04] transition-all"
      >
        <Play className="w-3.5 h-3.5 fill-current" />
        Start unassigned
      </button>
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
    coachPlanLoading,
    activeGoal,
    dashboardStats,
    goals,
    setShowAIPlanWizard,
    dailyGrindLayout,
    setDailyGrindLayout,
  } = useStore();

  // Journal subscriptions — kept as individual selectors so the grid doesn't
  // re-render when unrelated store slices change. `journalEntries` is a list
  // of all entries (all dates) so the calendar cell indicator is accurate
  // regardless of which day we're viewing.
  const journalEntries = useStore(s => s.journalEntries);
  const setJournalModalDate = useStore(s => s.setJournalModalDate);
  const journalDates = React.useMemo(
    () => journalEntries.map(e => e.date),
    [journalEntries],
  );

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
  const [showOtherTodos, setShowOtherTodos] = useState(false);
  // Cached count of open errands so the trigger button can show a red dot
  // without re-querying every render. Refreshed when the drawer opens or
  // mutates a row (the drawer calls onOpenCountChange).
  const [openOtherTodoCount, setOpenOtherTodoCount] = useState(0);
  // Top 3 open errands shown in the right-rail mini card. We refresh this
  // alongside the count so the inline preview never goes stale relative
  // to the badge. The full drawer still owns the source-of-truth list.
  const [topErrands, setTopErrands] = useState<OtherTodo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initial fetch of open-errand count + the top 3 for the inline preview.
  // The two queries run in parallel; either failing leaves the rail in a
  // graceful empty state rather than showing stale data.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      countOpenOtherTodos(),
      listOtherTodos({ includeCompleted: false }),
    ]).then(([n, list]) => {
      if (cancelled) return;
      setOpenOtherTodoCount(n);
      setTopErrands(list.slice(0, 3));
    });
    return () => { cancelled = true; };
  }, []);

  // Re-fetch the inline errand preview whenever the drawer's count
  // changes (drawer calls onOpenCountChange after every mutation).
  // Wrapped so we can pass the same callback shape to the drawer.
  const handleErrandCountChange = (n: number) => {
    setOpenOtherTodoCount(n);
    listOtherTodos({ includeCompleted: false }).then(list => {
      setTopErrands(list.slice(0, 3));
    });
  };

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
    setDailyViewDate(toLocalDateKey(d));
  };

  const goToNextDay = () => {
    const d = new Date(dailyViewDate + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    setDailyViewDate(toLocalDateKey(d));
  };

  const goToToday = () => setDailyViewDate(getTodayKey());

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
      {/* Left column: Timer cockpit (active or idle) + month streak calendar.
          The cockpit lives here in the new workbench layout instead of
          floating into the middle column when active — it's always next
          to the calendar so the user's eye doesn't have to track between
          two distant areas of the screen. The calendar shows pomodoro
          intensity per day plus a journal-entry indicator dot, so a
          single grid carries both streaks. */}
      <div className="lg:col-span-3 space-y-4">
        {isToday && (
          isTimerActive ? (
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
          ) : (
            <IdleTimerPlaceholder
              onStartUnassigned={handleStartUnassigned}
              hasTasks={pendingTasks.length > 0}
            />
          )
        )}
        <StreakCalendar
          dailySessions={dashboardStats?.daily_sessions || []}
          recommendedDaily={activeGoal?.recommended_sessions_per_day}
          focusDurationSec={user?.settings?.focus_duration ?? 25 * 60}
          journalDates={journalDates}
          onDayClick={(date) => setJournalModalDate(date)}
        />
      </div>

      {/* Main column */}
      <div className="lg:col-span-5 space-y-4">
        {/* Date nav + view controls — consolidated into two rows total:
              Row 1: date navigation on the left, List/Schedule view toggle
                     + manual-log button on the right. The view toggle is a
                     navigation-level concern (which lens are you looking
                     through?), so it sits with the date chevrons, not with
                     the planning actions below.
              Row 2: progress bar with a single slim caption beneath it that
                     merges "done/total" and "total work planned" into one
                     line.
              Row 3: planning actions (Plan My Day with AI, Plan Tomorrow).
            Previously this was seven vertical rows tall. Now it's three. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
        >
          {/* Row 1: date nav + view toggle + log */}
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
              {/* List / Schedule layout toggle. Persisted per-device via
                  localStorage so the preference survives reloads. */}
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <button
                  onClick={() => setDailyGrindLayout('list')}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-all ${
                    dailyGrindLayout === 'list'
                      ? 'bg-white/[0.08] text-white/80'
                      : 'text-white/30 hover:text-white/60'
                  }`}
                  title="List view"
                  aria-pressed={dailyGrindLayout === 'list'}
                >
                  <List className="w-3 h-3" />
                  List
                </button>
                <button
                  onClick={() => setDailyGrindLayout('schedule')}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-all ${
                    dailyGrindLayout === 'schedule'
                      ? 'bg-white/[0.08] text-white/80'
                      : 'text-white/30 hover:text-white/60'
                  }`}
                  title="Schedule view — drag tasks between morning / afternoon / evening"
                  aria-pressed={dailyGrindLayout === 'schedule'}
                >
                  <LayoutGrid className="w-3 h-3" />
                  Schedule
                </button>
              </div>
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
              {/* Other To-Dos drawer trigger. Sits intentionally last in the
                  control row — secondary surface for the side list of
                  errands. The red dot is the only thing that draws the eye
                  when there's something there. */}
              <button
                onClick={() => setShowOtherTodos(true)}
                className="relative text-[10px] px-2 py-1 rounded-lg bg-white/5 text-white/30 hover:text-amber-300/80 hover:bg-amber-500/10 transition-all flex items-center gap-1"
                title="Other To-Dos — errands & quick tasks"
                aria-label={`Open other to-dos${openOtherTodoCount > 0 ? ` (${openOtherTodoCount} open)` : ''}`}
              >
                <ListTodo className="w-3 h-3" />
                Other
                {openOtherTodoCount > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400"
                    aria-hidden="true"
                  />
                )}
              </button>
            </div>
          </div>

          {/* Row 2: progress bar + merged caption. Caption collapses the two
              previously-separate summary lines ("X of Y pomodoros done" and
              "Hm total work planned") into one subtle right-aligned string. */}
          {totalPomodoros > 0 && (
            <>
              <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden mb-1.5">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: 'var(--accent, #22d3ee)' }}
                  animate={{ width: `${(donePomodoros / totalPomodoros) * 100}%` }}
                  transition={{ duration: 0.5, ease }}
                />
              </div>
              <p className="text-[11px] text-white/30 tabular-nums">
                {donePomodoros}/{totalPomodoros} pomodoros
                <span className="text-white/15 mx-1.5">·</span>
                {totalEstHours > 0 ? `${totalEstHours}h ` : ''}{totalEstMins}m planned
              </p>
            </>
          )}

          {/* Row 3: planning actions. Plan Tomorrow sits as a quiet text link
              next to the primary AI planning button. */}
          <div className="mt-3 flex items-center gap-4">
            <button
              onClick={() => setShowAIPlanWizard(true)}
              disabled={coachPlanLoading}
              className="relative flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 hover:border-cyan-500/40 text-cyan-400 text-sm font-medium transition-all hover:shadow-[0_0_20px_rgba(34,211,238,0.15)] disabled:opacity-40"
            >
              <Sparkles className="w-4 h-4" />
              {coachPlanLoading ? 'Planning...' : 'Plan My Day with AI'}
            </button>

            {isToday && (
              <button
                onClick={() => useStore.getState().setShowPlanTomorrow(true)}
                className="flex items-center gap-1.5 text-xs text-white/20 hover:text-purple-300/60 transition-colors"
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

        {/* The active timer cockpit used to render here in the middle
            column. It now lives in the left rail (next to the streak
            calendar) so the task list isn't pushed down by the ring when
            a session starts. */}

        {/* Hint for first-time Daily Grind users */}
        <HintBanner id="daily-grind-intro">
          Add tasks and assign pomodoros for your day. Use <strong className="text-cyan-400/70">Plan My Day with AI</strong> to let AI build your schedule automatically.
        </HintBanner>

        {/* Task list — framed panel so the day's plan reads as a distinct block.
            The `list` layout uses the classic ordered pending list. The
            `schedule` layout hands rendering off to <TimeBoxView/>, which
            splits tasks by time_block into drag-and-drop columns. We pass
            the full visibleTasks (not just pendingTasks) to TimeBoxView so
            completed tasks stay visible in their original column — that way
            the schedule reads as a record of the day, not just a plan. */}
        {dailyGrindLayout === 'schedule' ? (
          visibleTasks.length > 0 && (
            <TimeBoxView
              tasks={visibleTasks}
              activeTaskId={activeDailyTaskId}
              isTimerActive={isTimerActive}
              isToday={isToday}
              canRollForward={canRollForward}
              goals={goals}
              onUpdateTask={(taskId, updates) => updateDailyTaskDetails(taskId, updates)}
              onToggleComplete={(taskId) => toggleTaskComplete(taskId)}
              onDelete={(taskId) => deleteDailyTask(taskId)}
              onStart={(taskId) => handleStartPomodoro(taskId)}
              onExtend={(taskId) => {
                const t = visibleTasks.find(x => x.id === taskId);
                if (!t) return;
                updateDailyTaskDetails(taskId, { pomodoros_target: t.pomodoros_target + 1 });
              }}
              onRollToTomorrow={(task) => handleRollToTomorrow(task)}
            />
          )
        ) : (
          pendingTasks.length > 0 && (
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
          )
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

        {/* Errand mini card — surfaces the top of the side list inline so
            the user sees what's pending without having to open the drawer.
            Click "View all" to open the full drawer (still the canonical
            place for editing / completing / reordering errands). When the
            list is empty we show a subtle "No errands" empty state plus an
            "+ Add errand" link that also opens the drawer in add-mode. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease }}
          className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-[10px] text-amber-300/70 uppercase tracking-widest font-medium">
                Errands
              </h3>
              {openOtherTodoCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300/90 text-[10px] font-semibold tabular-nums">
                  {openOtherTodoCount}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowOtherTodos(true)}
              className="text-[10px] text-white/35 hover:text-white/70 transition-colors flex items-center gap-0.5"
              aria-label="Open errand drawer"
            >
              View all
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {topErrands.length > 0 ? (
            <div className="space-y-1.5">
              {topErrands.map(e => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 px-1 py-0.5"
                >
                  <Circle className="w-2.5 h-2.5 text-white/25 flex-shrink-0" />
                  <p className="flex-1 min-w-0 text-xs text-white/70 truncate">{e.title}</p>
                  {e.estimated_minutes && (
                    <span className="text-[10px] text-white/30 tabular-nums flex-shrink-0">
                      {e.estimated_minutes}m
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-white/30 italic px-1">No open errands.</p>
          )}

          <button
            onClick={() => setShowOtherTodos(true)}
            className="mt-2.5 w-full text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.02] py-1.5 rounded-md border border-dashed border-white/[0.06] hover:border-white/[0.10] transition-all"
          >
            + Add errand
          </button>
        </motion.div>
        {/* Today at a glance — the old "Today's Charter" and "Today's Focus"
            cards said nearly the same thing with different framings. Both are
            now folded into a single compact card: four stats in a 2x2 grid
            with a single thin progress bar. Previously the user saw the
            same pomodoro count in four places (header, task-list header,
            Charter, Focus). Now it lives once on the right and once in the
            main column's progress bar. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.4, ease }}
          className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] text-white/25 uppercase tracking-widest">
              {isToday ? 'Today at a glance' : formatDateLabel(dailyViewDate)}
            </h3>
            {totalPomodoros > 0 && (
              <span className="text-[10px] text-white/30 tabular-nums">
                {Math.round((donePomodoros / totalPomodoros) * 100)}%
              </span>
            )}
          </div>

          {/* Thin day-progress bar — carries what the Charter card used to
              show, without a second title or second numeric readout. */}
          {totalPomodoros > 0 && (
            <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden mb-4">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: 'var(--accent, #22d3ee)' }}
                animate={{ width: `${(donePomodoros / totalPomodoros) * 100}%` }}
                transition={{ duration: 0.5, ease }}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
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
                <Flame className="w-3 h-3 text-orange-400/70" />
                <span className="text-[10px] text-white/30 uppercase">Streak</span>
              </div>
              <p className="text-lg font-bold text-white">
                {dashboardStats?.current_streak ?? 0}
                <span className="text-sm text-white/25 font-normal"> day{(dashboardStats?.current_streak ?? 0) === 1 ? '' : 's'}</span>
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

      {/* Other To-Dos drawer — slides in from the right. Mounted here at the
          root so its fixed-position overlay can cover the whole viewport
          regardless of where in the DailyGrind tree the trigger lives. */}
      <OtherTodosDrawer
        open={showOtherTodos}
        onClose={() => setShowOtherTodos(false)}
        onOpenCountChange={handleErrandCountChange}
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
      className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
        isActive && !completed
          ? 'bg-[var(--accent,#22d3ee)]/[0.10] border border-[var(--accent,#22d3ee)]/50 shadow-[0_0_24px_rgba(34,211,238,0.18)]'
          : completed
            ? 'bg-white/[0.015] border border-white/[0.04] opacity-50'
            : 'bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.08] hover:border-white/[0.14]'
      } ${task.goal_id ? 'border-l-2 border-l-violet-500/60' : ''}`}
    >
      {/* "Now" indicator — pulsing dot in the top-right of the active row.
          Strengthens the active highlight for users who couldn't tell
          which task was being timed at a glance. Only shown for the
          one task whose timer is actively running. */}
      {isActive && !completed && (
        <span className="absolute -top-1.5 -right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--accent,#22d3ee)] text-[8px] font-semibold text-[#0B0F14] uppercase tracking-wider shadow-[0_0_10px_rgba(34,211,238,0.4)]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
          </span>
          Now
        </span>
      )}
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
