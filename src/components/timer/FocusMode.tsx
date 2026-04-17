'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useTimer } from '@/hooks/useTimer';
import { useStore } from '@/store/useStore';
import { formatDuration } from '@/lib/utils';
import { X, Play, Pause, RotateCcw, SkipForward, Keyboard } from 'lucide-react';
import { PiPButton } from './PiPButton';
import { AmbientSoundToggle } from './AmbientSoundToggle';

// How long the "Press Space / Escape" intro banner stays visible before
// auto-dismissing. Tuned by feel: long enough to read once, short enough
// to vanish before it becomes distracting.
const HINT_DISMISS_MS = 8000;
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

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHint, setShowHint] = useState(true);

  // Auto-dismiss the bottom hint banner — even in focus mode, ephemeral
  // guidance shouldn't linger and fight for attention.
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), HINT_DISMISS_MS);
    return () => clearTimeout(t);
  }, []);

  // Show the shortcuts panel briefly on first mount.
  useEffect(() => {
    setShowShortcuts(true);
    const t = setTimeout(() => setShowShortcuts(false), SHORTCUTS_INITIAL_MS);
    return () => clearTimeout(t);
  }, []);

  const handleExit = () => {
    if (timerState === 'running' || timerState === 'paused') {
      setShowExitConfirm(true);
    } else {
      setView('dashboard');
    }
  };

  const confirmExit = () => {
    resetTimer();
    setShowExitConfirm(false);
    setView('dashboard');
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (showExitConfirm) return;

      // Don't hijack typing in inputs (e.g., the volume slider or any
      // future text field inside the focus view).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        if (e.key === 'Escape') handleExit();
        return;
      }

      if (e.key === 'Escape') handleExit();
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (timerState === 'idle') startTimer();
        else if (timerState === 'running') pauseTimer();
        else if (timerState === 'paused') resumeTimer();
      }
      if (e.key === '?') setShowShortcuts(s => !s);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState, showExitConfirm]);

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

  // "What's next" label. During focus: next up is the short break
  // (counting down this session). During break: next up is focus
  // resuming (counting down the break).
  const nextPhaseLabel = isBreak
    ? `Focus resumes in ${formatDuration(timeRemaining)}`
    : `Short break in ${formatDuration(timeRemaining)}`;

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

      {/* Ambient sound (sits just left of the exit button) */}
      <div className="absolute top-4 right-14 sm:top-6 sm:right-16 z-10">
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
              <span>Play / Pause</span>
            </div>
            <div className="flex items-center gap-3 text-white/40">
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 font-mono text-[10px]">Esc</kbd>
              <span>Exit focus mode</span>
            </div>
            <div className="flex items-center gap-3 text-white/40">
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/60 font-mono text-[10px]">?</kbd>
              <span>Toggle this help</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Break banner */}
      <AnimatePresence>
        {isBreak && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-0 left-0 right-0 bg-green-500/10 border-b border-green-500/20 py-3 text-center"
          >
            <p className="text-sm text-green-400 font-medium">
              You earned this break. Stretch, breathe, recharge.
            </p>
            <p className="text-[10px] text-green-400/50 mt-0.5">
              Next session starts automatically when the timer ends
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auto-dismissing intro hint (only during focus) */}
      <AnimatePresence>
        {showHint && !isBreak && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 w-full max-w-xs px-4"
          >
            <div className="px-3.5 py-2.5 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/10 text-center">
              <p className="text-xs text-white/40 leading-relaxed">
                Press <strong className="text-cyan-400/70">Space</strong> to pause/resume.
                Press <strong className="text-cyan-400/70">Escape</strong> to exit.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Title block — the anchor of the view */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-xl text-center mb-6 sm:mb-8 px-4"
      >
        {activeDailyTask ? (
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

      {/* Giant timer ring */}
      <div className="relative w-64 h-64 sm:w-80 sm:h-80">
        <motion.svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${ringSize} ${ringSize}`}
          className="transform -rotate-90"
          // Subtle breathing: 0.92 → 1 → 0.92 over 4s while actively running.
          // Paused/idle/break use a static opacity.
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
              isPaused ? 'text-white/45' : 'text-white/20'
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

        {timerState === 'running' && (
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
            {/* Resume uses the muted 'secondary' variant to visually signal
                the paused state — no glow, no pulsing colour. */}
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

        {timerState === 'break' && (
          <Button
            variant="outline"
            size="lg"
            onClick={skipBreak}
            className="gap-2 px-8 sm:px-10 h-12 sm:h-14 text-base"
          >
            <SkipForward className="w-5 h-5" />
            Skip Break
          </Button>
        )}
      </div>

      {/* Session counter + next-phase preview + PiP */}
      <div className="mt-6 sm:mt-8 text-center">
        <p className="text-xs text-white/20">
          Session {activeGoal.sessions_completed + 1} of {activeGoal.estimated_sessions_current}
          {dashboardStats &&
          dashboardStats.completion_percentage >= 50 &&
          dashboardStats.completion_percentage < 100
            ? ' — past the halfway mark!'
            : dashboardStats && dashboardStats.completion_percentage >= 90
              ? ' — almost there!'
              : ''}
        </p>
        <p className="text-[11px] text-white/25 mt-1 tabular-nums">
          {nextPhaseLabel}
        </p>
        {dashboardStats && (
          <p className="text-xs text-white/10 mt-1">
            {dashboardStats.completion_percentage}% complete
          </p>
        )}
        <div className="flex justify-center mt-3 w-full max-w-xs mx-auto">
          <PiPButton />
        </div>
      </div>

      {/* Exit confirmation modal */}
      <AnimatePresence>
        {showExitConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-[#131820] border border-white/10 rounded-2xl p-6 max-w-xs mx-4 text-center shadow-2xl"
            >
              <h3 className="text-base font-semibold text-white mb-2">Step away?</h3>
              <p className="text-sm text-white/40 mb-6">
                You have {formatDuration(timeRemaining)} left in this session.
                Leaving will discard this session&apos;s progress — consider pausing
                instead if you plan to come back.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => setShowExitConfirm(false)}
                >
                  Stay
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={confirmExit}
                >
                  Leave
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
