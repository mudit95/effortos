'use client';

import { useStore } from '@/store/useStore';

/**
 * Pure store reader for timer state and actions.
 *
 * IMPORTANT: this hook does NOT spawn a Web Worker or run timing effects.
 * The single source of timing is `<TimerEngine />`, mounted once at AppShell
 * level. Every component that calls `useTimer()` shares that one engine.
 *
 * The hook used to construct its own worker, which meant FocusMode,
 * TimerDisplay, PiPTimerOverlay, and DailyGrind each ran a parallel worker
 * — they raced on store writes and showed bursts/freezes inconsistently.
 * Centralising the worker into TimerEngine fixes that.
 */
export function useTimer() {
  const timerState = useStore(s => s.timerState);
  const timeRemaining = useStore(s => s.timeRemaining);
  const isBreak = useStore(s => s.isBreak);
  const startTimer = useStore(s => s.startTimer);
  const pauseTimer = useStore(s => s.pauseTimer);
  const resumeTimer = useStore(s => s.resumeTimer);
  const skipBreak = useStore(s => s.skipBreak);
  const resetTimer = useStore(s => s.resetTimer);

  return {
    timerState,
    timeRemaining,
    isBreak,
    startTimer,
    pauseTimer,
    resumeTimer,
    skipBreak,
    resetTimer,
  };
}
