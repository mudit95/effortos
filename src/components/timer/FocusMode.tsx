'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useTimer } from '@/hooks/useTimer';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useStore } from '@/store/useStore';
import { formatDuration } from '@/lib/utils';
import { X, Play, Pause, RotateCcw, SkipForward, Keyboard, Wind } from 'lucide-react';
import { PiPButton } from './PiPButton';
import { usePiP } from '@/hooks/usePiP';
import { AmbientSoundToggle } from './AmbientSoundToggle';
import { BreathingGuide } from './BreathingGuide';
import { warmUpAudio } from '@/lib/sounds';
import { QuickPomodoroPrompt } from './QuickPomodoroPrompt';

// How long the keyboard-shortcuts panel stays visible on first mount.
// The user gets a brief glance at the available shortcuts, then it
// auto-collapses so it doesn't compete with the timer for attention.
const SHORTCUTS_INITIAL_MS = 4000;

export function FocusMode() {
  const {
    timerState,
    timeRemaining,
    isBreak,
    startTimer,
    pauseTimer,
    resumeTimer,
    skipBreak,
    resetTimer,
  } = useTimer();

  const activeGoal = useStore(s => s.activeGoal);
  const setView = useStore(s => s.setView);
  const dashboardStats = useStore(s => s.dashboardStats);
  const user = useStore(s => s.user);
  const dashboardMode = useStore(s => s.dashboardMode);
  const activeDailyTaskId = useStore(s => s.activeDailyTaskId);
  const dailyTasks = useStore(s => s.dailyTasks);

  // The task currently focused in Daily mode — if any. When present we
  // elevate it to be the headline of the view; otherwise the goal title
  // stays as the anchor.
  const activeDailyTask = useMemo(
    () =>
      dashboardMode === 'daily' && activeDailyTaskId
        ? dailyTasks.find(t => t.id === activeDailyTaskId)
        : undefined,
    [dashboardMode, dailyTasks, activeDailyTaskId]
  );

  // Find the next task in the queue (for break screen)
  const nextDailyTask = useMemo(() => {
    if (dashboardMode !== 'daily' || !activeDailyTaskId) return undefined;
    const incomplete = dailyTasks.filter(t => !t.completed && t.id !== activeDailyTaskId);
    return incomplete[0];
  }, [dashboardMode, dailyTasks, activeDailyTaskId]);

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [meditating, setMeditating] = useState(false);

  // PiP toggle — exposed both via the in-view button and the 'P' shortcut.
  const { isPiPSupported, isPiPActive, openPiP, closePiP } = usePiP();

  // Keep screen awake whenever we're in focus mode and the timer is
  // actively running or on a break (not idle/paused).
  const keepAwake = timerState === 'running' || timerState === 'break';
  useWakeLock(keepAwake);

  // Reset meditation mode when break ends
  useEffect(() => {
    if (!isBreak) setMeditating(false);
  }, [isBreak]);

  // Warm up the Web Audio API on mount. The user clicked into focus mode,
  // so we have a user-gesture context to unlock AudioContext.
  useEffect(() => { warmUpAudio(); }, []);

  // Show the shortcuts panel briefly on first mount.
  useEffect(() => {
    setShowShortcuts(true);
    const t = setTimeout(() => setShowShortcuts(false), SHORTCUTS_INITIAL_MS);
    return () => clearTimeout(t);
  }, []);

  // Closing focus mode is now pure navigation — the timer keeps running
  // in the background (TimerEngine owns the worker at AppShell level).
  // Users can pop back into focus mode any time, or stop the session
  // with the explicit Reset/Pause buttons. Previously this fired a
  // confirm dialog that called resetTimer() on confirm, which silently
  // killed the session — and on idle/break it skipped the dialog and
  // just navigated, leaving the worker ticking. Now the behaviour is
  // consistent: closing focus mode never touches the timer.
  const handleExit = () => {
    setView('dashboard');
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs (e.g., the volume slider or any
      // future text field inside the focus view).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        if (e.key === 'Escape') handleExit();
        return;
      }

      // Spacebar inside a focused button — most commonly a sound option in
      // the ambient-sound popover — shouldn't both pause the timer AND
      // activate the button. Browsers natively translate Space-on-button
      // into a click, so just bail and let that happen. We still honour
      // Escape so the popover can be dismissed via the parent handler.
      if (tag === 'BUTTON' && (e.key === ' ' || e.code === 'Space')) {
        if (e.key === 'Escape') handleExit();
        return;
      }

      if (e.key === 'Escape') handleExit();
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (timerState === 'idle') startTimer();
        else if (timerState === 'running') pauseTimer();
        else if (timerState === 'paused') resumeTimer();
        else if (timerState === 'break') skipBreak();
      }
      if (e.key === '?') setShowShortcuts(s => !s);
      // 'P' toggles the floating Picture-in-Picture timer. The keypress
      // counts as a user gesture, which the Document PiP API requires
      // for window.documentPictureInPicture.requestWindow(). Use it
      // before Cmd-Tab'ing away to keep the timer floating on top.
      if ((e.key === 'p' || e.key === 'P') && isPiPSupported) {
        e.preventDefault();
        if (isPiPActive) {
          closePiP();
        } else {
          openPiP();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState, isPiPActive, isPiPSupported]);

  const focusDuration = user?.settings?.focus_duration || 25 * 60;
  const breakDuration = user?.settings?.break_duration || 5 * 60;

  const progress = isBreak
    ? 1 - timeRemaining / breakDuration
    : 1 - timeRemaining / focusDuration;

  const ringSize = 300;
  const ringRadius = 130;
  const circumference = 2 * Math.PI * ringRadius;
  const offset = circumference * (1 - progress);
  const timerColor = isBreak ? '#22c55e' : '#22d3ee';

  const isPaused = timerState === 'paused';
  const isRunning = timerState === 'running';

  // --- Session counter logic ---
  // In daily mode, show per-task progress (pomodoros done / target) instead
  // of the long-term goal's sessions_completed / estimated_sessions_current
  // which confusingly pulls numbers from multi-month goals.
  const sessionLabel = useMemo(() => {
    if (dashboardMode === 'daily' && activeDailyTask) {
      const done = activeDailyTask.pomodoros_done || 0;
      const target = activeDailyTask.pomodoros_target || 1;
      return `Pomodoro ${done + 1} of ${target}`;
    }
    if (activeGoal) {
      return `Session ${activeGoal.sessions_completed + 1} of ${activeGoal.estimated_sessions_current}`;
    }
    return null;
  }, [dashboardMode, activeDailyTask, activeGoal]);

  // Completion percentage — use task-level for daily mode
  const completionPct = useMemo(() => {
    if (dashboardMode === 'daily' && activeDailyTask) {
      const done = activeDailyTask.pomodoros_done || 0;
      const target = activeDailyTask.pomodoros_target || 1;
      return Math.min(100, Math.round((done / target) * 100));
    }
    return dashboardStats?.completion_percentage ?? null;
  }, [dashboardMode, activeDailyTask, dashboardStats]);

  if (!activeGoal) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[var(--background,#080b10)] flex flex-col items-center justify-center px-4"
    >
      {/* Exit button */}
      <button
        onClick={handleExit}
        className="absolute top-4 right-4 sm:top-6 sm:right-6 text-white/20 hover:text-white/50 transition-colors p-2 z-10"
        aria-label="Exit focus mode"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Ambient sound (sits just left of the exit button). */}
      <div className="absolute top-2 right-16 sm:top-4 sm:right-24 z-10">
        <AmbientSoundToggle />
      </div>

      {/* Shortcuts help trigger */}
      <button
        onClick={() => setShowShortcuts(s => !s)}
        className="absolute top-4 left-4 sm:top-6 sm:left-6 text-white/15 hover:text-white/40 transition-colors p-2 z-10"
        aria-label="Keyboard shortcuts"
      >
        <Keyboard className="w-4 h-4" />
      </button>

      {/* Shortcuts panel */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-14 left-4 sm:top-16 sm:left-6 bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-3 shadow-xl text-xs space-y-1.5 z-10"
          >
            <p className="text-white/60 font-medium mb-2">Keyboard shortcuts</p>
            <div className="flex items-center gap-3 text-white/40">
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 font-mono text-[10px]">Space</kbd>
              <span>{isBreak ? 'Skip break' : 'Play / Pause'}</span>
            </div>
            <div className="flex items-center gap-3 text-white/40">
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 font-mono text-[10px]">Esc</kbd>
              <span>Exit focus mode</span>
            </div>
            {isPiPSupported && (
              <div className="flex items-center gap-3 text-white/40">
                <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 font-mono text-[10px]">P</kbd>
                <span>{isPiPActive ? 'Close floating timer' : 'Pop out floating timer'}</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-white/40">
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 font-mono text-[10px]">?</kbd>
              <span>Toggle this help</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── BREAK SCREEN ── */}
      <AnimatePresence>
        {isBreak && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-0 left-0 right-0 bg-green-500/10 border-b border-green-500/20 py-3 px-4"
          >
            <div className="max-w-xl mx-auto text-center">
              <p className="text-sm text-green-400 font-medium">
                Break time. Stretch, breathe, recharge.
              </p>
              {nextDailyTask && (
                <p className="text-[11px] text-green-400/60 mt-1">
                  Up next: <span className="text-green-300/80 font-medium">{nextDailyTask.title}</span>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Title block */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-xl text-center mb-6 sm:mb-8 px-4"
      >
        {isBreak ? (
          <>
            <h1 className="text-2xl sm:text-3xl font-semibold text-green-400/90 tracking-tight">
              Break
            </h1>
            {activeDailyTask && (
              <p className="mt-2 text-sm text-white/35 truncate">
                {activeDailyTask.title} — paused
              </p>
            )}
          </>
        ) : activeDailyTask ? (
          <>
            <h1 className="text-2xl sm:text-3xl font-semibold text-white/90 tracking-tight leading-tight break-words">
              {activeDailyTask.title}
            </h1>
            <p className="mt-2 text-sm text-white/35 truncate">
              {activeGoal.title}
            </p>
          </>
        ) : (
          <h1 className="text-2xl sm:text-3xl font-semibold text-white/90 tracking-tight leading-tight break-words">
            {activeGoal.title}
          </h1>
        )}
      </motion.div>

      {/* Breathing meditation overlay — wraps around the timer ring */}
      <AnimatePresence>
        {meditating && isBreak && (
          <BreathingGuide />
        )}
      </AnimatePresence>

      {/* Giant timer ring — stays visible even during meditation */}
      <div className="relative w-64 h-64 sm:w-80 sm:h-80">
        <motion.svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${ringSize} ${ringSize}`}
          className="transform -rotate-90"
          animate={
            isRunning
              ? { opacity: [0.92, 1, 0.92] }
              : isPaused
                ? { opacity: 0.75 }
                : { opacity: 1 }
          }
          transition={
            isRunning
              ? { duration: 4, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.35 }
          }
        >
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={ringRadius}
            fill="none"
            stroke="rgba(255,255,255,0.03)"
            strokeWidth="4"
          />
          <motion.circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={ringRadius}
            fill="none"
            stroke={timerColor}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.3, ease: 'linear' }}
            style={{
              filter: isPaused ? 'none' : `drop-shadow(0 0 12px ${timerColor}30)`,
              opacity: isPaused ? 0.35 : 1,
              transition: 'opacity 0.3s ease, filter 0.3s ease',
            }}
          />
        </motion.svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`text-xs uppercase tracking-[0.3em] mb-2 transition-colors ${
              isPaused ? 'text-white/45' : isBreak ? 'text-green-400/60' : 'text-white/20'
            }`}
          >
            {isPaused ? 'Paused' : isBreak ? 'Break' : 'Focus'}
          </span>
          <span className="text-5xl sm:text-7xl font-mono font-light text-white tracking-tight tabular-nums">
            {formatDuration(timeRemaining)}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mt-8 sm:mt-12">
        {timerState === 'idle' && (
          <Button
            variant="glow"
            size="lg"
            onClick={startTimer}
            className="gap-2 px-8 sm:px-10 h-12 sm:h-14 text-base"
          >
            <Play className="w-5 h-5 fill-current" />
            Start
          </Button>
        )}

        {timerState === 'running' && !isBreak && (
          <>
            <Button
              variant="secondary"
              size="icon"
              onClick={resetTimer}
              className="w-11 h-11 sm:w-12 sm:h-12"
              aria-label="Reset timer"
            >
              <RotateCcw className="w-5 h-5" />
            </Button>
            <Button
              variant="glow"
              size="lg"
              onClick={pauseTimer}
              className="gap-2 px-8 sm:px-10 h-12 sm:h-14 text-base"
            >
              <Pause className="w-5 h-5 fill-current" />
              Pause
            </Button>
          </>
        )}

        {timerState === 'paused' && (
          <>
            <Button
              variant="secondary"
              size="icon"
              onClick={resetTimer}
              className="w-11 h-11 sm:w-12 sm:h-12"
              aria-label="Reset timer"
            >
              <RotateCcw className="w-5 h-5" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={resumeTimer}
              className="gap-2 px-8 sm:px-10 h-12 sm:h-14 text-base"
            >
              <Play className="w-5 h-5 fill-current" />
              Resume
            </Button>
          </>
        )}

        {(timerState === 'break' || (timerState === 'running' && isBreak)) && (
          <div className="flex flex-col items-center gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={skipBreak}
              className="gap-2 px-8 sm:px-10 h-12 sm:h-14 text-base border-green-500/20 text-green-300 hover:border-green-400/40 hover:bg-green-500/10"
            >
              <SkipForward className="w-5 h-5" />
              Start Next Session
            </Button>
            {!meditating && (
              <button
                onClick={() => setMeditating(true)}
                className="flex items-center gap-2 text-xs text-white/30 hover:text-green-300/70 transition-colors px-3 py-1.5 rounded-full border border-white/[0.06] hover:border-green-500/20 hover:bg-green-500/[0.05]"
              >
                <Wind className="w-3.5 h-3.5" />
                Use this break to meditate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Session counter + next-phase preview + PiP */}
      <div className="mt-6 sm:mt-8 text-center">
        {sessionLabel && (
          <p className="text-xs text-white/20">
            {sessionLabel}
            {completionPct !== null && completionPct >= 50 && completionPct < 90
              ? ' — past the halfway mark!'
              : completionPct !== null && completionPct >= 90 && completionPct < 100
                ? ' — almost there!'
                : ''}
          </p>
        )}
        <p className="text-[11px] text-white/25 mt-1 tabular-nums">
          {isBreak
            ? `Focus resumes in ${formatDuration(timeRemaining)}`
            : `Short break in ${formatDuration(timeRemaining)}`}
        </p>
        {completionPct !== null && (
          <p className="text-xs text-white/10 mt-1">
            {completionPct}% complete
          </p>
        )}
        {/* Compact PiP button — the prominent card variant overlapped the
            absolute-positioned bottom hint on shorter viewports. We have
            the 'P' keyboard shortcut and the in-view shortcuts panel
            documenting PiP, so the compact button is enough surface. */}
        <div className="flex justify-center mt-3 w-full max-w-xs mx-auto">
          <PiPButton compact />
        </div>
      </div>

      {/* Post-session signup prompt for guest quick pomodoros */}
      <QuickPomodoroPrompt />
    </motion.div>
  );
}
