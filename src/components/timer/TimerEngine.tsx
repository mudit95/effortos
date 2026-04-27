'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { playSound } from '@/lib/sounds';

/**
 * Singleton timer engine. Mounted exactly ONCE at AppShell level.
 *
 * Why a singleton?
 *   useTimer() used to construct a Web Worker on every call. Four components
 *   call it (FocusMode, TimerDisplay, PiPTimerOverlay, DailyGrind) — meaning
 *   four workers ran in parallel, each posting TICKs into the same store and
 *   racing on writes. That's the proximate cause of:
 *     - "timer suddenly pauses" (one worker throttles, another doesn't)
 *     - "counter changes in bursts" (un-throttled worker catches up)
 *     - "sometimes stops sometimes doesn't" (only one worker received STOP)
 *
 *   This component owns the single worker. useTimer() is now a pure store
 *   reader — its consumers don't accidentally spawn anything.
 *
 * Owns:
 *   - The Web Worker (or setInterval fallback if Workers unavailable)
 *   - timerState → worker message routing
 *   - TICK / COMPLETE handling (writes timeRemaining, transitions on done)
 *   - Ambient audio pause/resume on break entry/exit
 *   - Live document.title showing the countdown
 *
 * Renders nothing.
 */

/** Pause/resume ambient audio during break/focus transitions. */
function dispatchAmbientEvent(type: 'pause' | 'resume') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(`ambient-sound-${type}`));
  }
}

function formatTitleTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function TimerEngine() {
  const workerRef = useRef<Worker | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks the previous timerState so we can distinguish 'paused→running'
  // (a RESUME, worker should keep its remaining) from 'idle→running' (a
  // fresh START). Without this, RESUME would restart the worker from
  // whatever stale `timeRemaining` is in the store.
  const prevTimerStateRef = useRef<string>('idle');

  const timerState = useStore(s => s.timerState);
  const timeRemaining = useStore(s => s.timeRemaining);
  const isBreak = useStore(s => s.isBreak);

  // ── Worker lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker('/timer-worker.js');
      worker.onmessage = (e) => {
        const { type, remaining } = e.data;
        if (type === 'TICK') {
          useStore.setState({ timeRemaining: remaining });
        } else if (type === 'COMPLETE') {
          const state = useStore.getState();
          if (state.isBreak) {
            // Break finished — back to idle, ready for next focus session.
            if (state.user?.settings?.sound_enabled !== false) {
              playSound('break_complete');
            }
            dispatchAmbientEvent('resume');
            const focusDuration = state.user?.settings?.focus_duration || 25 * 60;
            useStore.setState({
              timerState: 'idle',
              timeRemaining: focusDuration,
              isBreak: false,
            });
          } else {
            // Focus session finished — store handles persistence + break transition.
            state.completeTimerSession();
          }
        }
      };
      workerRef.current = worker;
    } catch {
      console.warn('Web Worker not available; falling back to setInterval ticking');
    }

    return () => {
      worker?.terminate();
      workerRef.current = null;
      if (fallbackRef.current) clearInterval(fallbackRef.current);
    };
  }, []);

  // ── Ambient audio: pause on break entry, resume on break exit ────
  const prevBreakRef = useRef(false);
  useEffect(() => {
    if (isBreak && !prevBreakRef.current) {
      dispatchAmbientEvent('pause');
    } else if (!isBreak && prevBreakRef.current) {
      dispatchAmbientEvent('resume');
    }
    prevBreakRef.current = isBreak;
  }, [isBreak]);

  // ── timerState → worker message routing ──────────────────────────
  // We only re-fire on timerState changes (NOT timeRemaining) because the
  // worker is the source of truth for remaining once started. Reading
  // `timeRemaining` via useStore.getState() at the moment of START avoids
  // the missing-dep warning while still picking up the freshly-set value.
  useEffect(() => {
    const prev = prevTimerStateRef.current;
    prevTimerStateRef.current = timerState;

    const worker = workerRef.current;
    if (worker) {
      if (timerState === 'running') {
        if (prev === 'paused') {
          // Resume: keep worker's pausedRemaining, don't restart.
          worker.postMessage({ type: 'RESUME' });
        } else if (prev === 'break') {
          // Store flips break→running 500ms after completeTimerSession.
          // The worker started counting at the 'break' transition already;
          // re-issuing START would reset the break countdown. No-op.
          // (See: useStore.completeTimerSession's setTimeout.)
        } else {
          // idle→running: fresh focus session.
          worker.postMessage({
            type: 'START',
            payload: { duration: useStore.getState().timeRemaining },
          });
        }
      } else if (timerState === 'paused') {
        worker.postMessage({ type: 'PAUSE' });
      } else if (timerState === 'idle') {
        worker.postMessage({ type: 'STOP' });
      } else if (timerState === 'break') {
        // Entering break — start break countdown.
        worker.postMessage({
          type: 'START',
          payload: { duration: useStore.getState().timeRemaining },
        });
      }
    } else {
      // Fallback: setInterval ticking via the store's tickTimer action.
      if (fallbackRef.current) clearInterval(fallbackRef.current);
      if (timerState === 'running' || timerState === 'break') {
        fallbackRef.current = setInterval(() => {
          useStore.getState().tickTimer();
        }, 1000);
      }
    }
  }, [timerState]);

  // ── Live tab title ───────────────────────────────────────────────
  // While a session is active, the browser tab shows the live countdown:
  //   23:42 · Focus · EffortOS
  //   4:12  · Break · EffortOS
  //   Paused · EffortOS
  // When idle, AppShell's view-based title takes over (its effect now
  // includes timerState in its dep array so it re-runs on transition).
  useEffect(() => {
    if (timerState === 'idle') return; // AppShell owns idle titles.
    let label: string;
    if (timerState === 'paused') {
      label = `${formatTitleTime(timeRemaining)} · Paused`;
    } else if (isBreak) {
      label = `${formatTitleTime(timeRemaining)} · Break`;
    } else {
      label = `${formatTitleTime(timeRemaining)} · Focus`;
    }
    document.title = `${label} · EffortOS`;
  }, [timeRemaining, timerState, isBreak]);

  return null;
}
