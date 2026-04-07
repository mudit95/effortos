'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '@/store/useStore';
import { playSound } from '@/lib/sounds';

export function useTimer() {
  const workerRef = useRef<Worker | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const timerState = useStore(s => s.timerState);
  const timeRemaining = useStore(s => s.timeRemaining);
  const isBreak = useStore(s => s.isBreak);
  const startTimer = useStore(s => s.startTimer);
  const pauseTimer = useStore(s => s.pauseTimer);
  const resumeTimer = useStore(s => s.resumeTimer);
  const tickTimer = useStore(s => s.tickTimer);
  const completeTimerSession = useStore(s => s.completeTimerSession);
  const skipBreak = useStore(s => s.skipBreak);
  const resetTimer = useStore(s => s.resetTimer);

  // Initialize Web Worker
  useEffect(() => {
    try {
      workerRef.current = new Worker('/timer-worker.js');
      workerRef.current.onmessage = (e) => {
        const { type, remaining } = e.data;
        if (type === 'TICK') {
          // Update store with worker time
          useStore.setState({ timeRemaining: remaining });
        } else if (type === 'COMPLETE') {
          // Session or break complete
          const state = useStore.getState();
          if (state.isBreak) {
            // Play break complete sound
            if (state.user?.settings?.sound_enabled !== false) {
              playSound('break_complete');
            }
            useStore.setState({
              timerState: 'idle',
              timeRemaining: 25 * 60,
              isBreak: false,
            });
          } else {
            state.completeTimerSession();
          }
        }
      };
    } catch {
      // Web Worker not available, use fallback
      console.warn('Web Worker not available, using fallback timer');
    }

    return () => {
      workerRef.current?.terminate();
      if (fallbackRef.current) clearInterval(fallbackRef.current);
    };
  }, []);

  // Sync timer state with worker
  useEffect(() => {
    if (workerRef.current) {
      if (timerState === 'running') {
        workerRef.current.postMessage({
          type: 'START',
          payload: { duration: timeRemaining },
        });
      } else if (timerState === 'paused') {
        workerRef.current.postMessage({ type: 'PAUSE' });
      } else if (timerState === 'idle') {
        workerRef.current.postMessage({ type: 'STOP' });
      } else if (timerState === 'break') {
        // Auto-start break countdown
        workerRef.current.postMessage({
          type: 'START',
          payload: { duration: timeRemaining },
        });
      }
    } else {
      // Fallback: use setInterval
      if (fallbackRef.current) clearInterval(fallbackRef.current);

      if (timerState === 'running' || timerState === 'break') {
        fallbackRef.current = setInterval(() => {
          tickTimer();
        }, 1000);
      }
    }
  }, [timerState]);

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
