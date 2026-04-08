'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { HintBanner } from '@/components/ui/HintBanner';
import { useTimer } from '@/hooks/useTimer';
import { useStore } from '@/store/useStore';
import { formatDuration } from '@/lib/utils';
import { X, Play, Pause, RotateCcw, SkipForward, Keyboard } from 'lucide-react';
import { PiPButton } from './PiPButton';

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

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [hasSeenShortcuts, setHasSeenShortcuts] = useState(false);

  // Show shortcuts tooltip on first visit
  useEffect(() => {
    if (!hasSeenShortcuts) {
      setShowShortcuts(true);
      const timeout = setTimeout(() => {
        setShowShortcuts(false);
        setHasSeenShortcuts(true);
      }, 4000);
      return () => clearTimeout(timeout);
    }
  }, [hasSeenShortcuts]);

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
      if (showExitConfirm) return; // Don't handle while confirm is showing
      if (e.key === 'Escape') handleExit();
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (timerState === 'idle') startTimer();
        else if (timerState === 'running') pauseTimer();
        else if (timerState === 'paused') resumeTimer();
      }
      if (e.key === '?') {
        setShowShortcuts(s => !s);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [timerState, showExitConfirm]);

  const focusDuration = user?.settings?.focus_duration || 25 * 60;
  const breakDuration = user?.settings?.break_duration || 5 * 60;

  const progress = isBreak
    ? 1 - (timeRemaining / breakDuration)
    : 1 - (timeRemaining / focusDuration);

  const ringSize = 300;
  const ringRadius = 130;
  const circumference = 2 * Math.PI * ringRadius;
  const offset = circumference * (1 - progress);
  const timerColor = isBreak ? '#22c55e' : '#22d3ee';

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
        className="absolute top-4 right-4 sm:top-6 sm:right-6 text-white/20 hover:text-white/50 transition-colors p-2"
        aria-label="Exit focus mode"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Shortcuts help */}
      <button
        onClick={() => setShowShortcuts(s => !s)}
        className="absolute top-4 left-4 sm:top-6 sm:left-6 text-white/15 hover:text-white/40 transition-colors p-2"
        aria-label="Keyboard shortcuts"
      >
        <Keyboard className="w-4 h-4" />
      </button>

      {/* Shortcuts tooltip */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-14 left-4 sm:top-16 sm:left-6 bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-3 shadow-xl text-xs space-y-1.5"
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

      {/* Goal title */}
      <motion.p
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-sm text-white/20 mb-8 sm:mb-12 max-w-xs text-center truncate"
      >
        {activeGoal.title}
      </motion.p>

      {/* Hint for focus mode */}
      <div className="absolute top-20 left-1/2 transform -translate-x-1/2 w-full max-w-xs px-4">
        <HintBanner id="focus-mode-intro">
          Press <strong className="text-cyan-400/70">Space</strong> to pause/resume. Press <strong className="text-cyan-400/70">Escape</strong> to exit. Stay focused!
        </HintBanner>
      </div>

      {/* Giant timer ring — responsive */}
      <div className="relative w-64 h-64 sm:w-80 sm:h-80">
        <svg width="100%" height="100%" viewBox={`0 0 ${ringSize} ${ringSize}`} className="transform -rotate-90">
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
            style={{ filter: `drop-shadow(0 0 12px ${timerColor}30)` }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-white/20 uppercase tracking-[0.3em] mb-2">
            {isBreak ? 'Break' : 'Focus'}
          </span>
          <span className="text-5xl sm:text-7xl font-mono font-light text-white tracking-tight">
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
            <Button variant="secondary" size="icon" onClick={resetTimer} className="w-11 h-11 sm:w-12 sm:h-12">
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
            <Button variant="secondary" size="icon" onClick={resetTimer} className="w-11 h-11 sm:w-12 sm:h-12">
              <RotateCcw className="w-5 h-5" />
            </Button>
            <Button
              variant="glow"
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

      {/* Session counter + PiP */}
      <div className="mt-6 sm:mt-8 text-center">
        <p className="text-xs text-white/20">
          Session {activeGoal.sessions_completed + 1} of {activeGoal.estimated_sessions_current}
          {dashboardStats && dashboardStats.completion_percentage >= 50 && dashboardStats.completion_percentage < 100
            ? ' — past the halfway mark!'
            : dashboardStats && dashboardStats.completion_percentage >= 90
            ? ' — almost there!'
            : ''
          }
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
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-[#131820] border border-white/10 rounded-2xl p-6 max-w-xs mx-4 text-center shadow-2xl"
            >
              <h3 className="text-base font-semibold text-white mb-2">Step away?</h3>
              <p className="text-sm text-white/40 mb-6">
                You have {formatDuration(timeRemaining)} left in this session. Leaving will discard this session&apos;s progress — consider pausing instead if you plan to come back.
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
