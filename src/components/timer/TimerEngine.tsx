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
  // Timestamp at which the current run should hit zero. Captured at START /
  // RESUME, used by the fallback loop to recompute `remaining` from
  // `Date.now()`. This is the timestamp-based pattern the Web Worker uses,
  // re-implemented for the no-worker fallback path so background-tab
  // throttling can't drift the countdown — the next un-throttled tick just
  // re-derives the right value from wall clock.
  const fallbackEndsAtRef = useRef<number | null>(null);
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
          // Stale-tick guard: if the user reset the timer or skipped
          // the break in the gap between the worker computing this
          // TICK and the message reaching us, don't overwrite
          // timeRemaining with a stale countdown. Only honour TICKs
          // when the store is in a state where the worker should be
          // counting (running OR break).
          const s = useStore.getState();
          if (s.timerState !== 'running' && s.timerState !== 'break') return;
          useStore.setState({ timeRemaining: remaining });
        } else if (type === 'COMPLETE') {
          const state = useStore.getState();
          // Stale-COMPLETE guard. The worker emits COMPLETE
          // asynchronously; in the gap between the worker stopping
          // and the message arriving, the user could have reset
          // the timer (timerState='idle') or paused it. If we acted
          // on a stale COMPLETE we'd either fire completeTimerSession
          // for a session the user already cancelled, or transition
          // an idle timer into break for no reason. Only act when
          // the store still believes a countdown is active.
          if (state.timerState !== 'running' && state.timerState !== 'break') return;
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
            // The store-side completeTimerSession also has its own
            // double-fire / wrong-state guards, so this call is safe
            // even on the rare double-COMPLETE from a re-mounted
            // worker.
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
        if (prev === 'break') {
          // Store flips break→running 500ms after completeTimerSession.
          // The worker started counting at the 'break' transition already;
          // re-issuing START would reset the break countdown. No-op.
          // (See: useStore.completeTimerSession's setTimeout.)
        } else {
          // BOTH idle→running (fresh start) AND paused→running (resume)
          // get a fresh START with the store's current timeRemaining.
          //
          // We deliberately do NOT use the worker's RESUME message any
          // more. RESUME relied on the worker's internal `pausedRemaining`
          // captured at the previous PAUSE — but on app boot from a
          // saved-running state, the rehydrated store has timerState
          // 'paused' yet the worker is brand new and `pausedRemaining`
          // is 0. RESUME would no-op silently and the timer would
          // appear stuck after refresh. Always re-deriving the duration
          // from the store works in every case because the store's
          // timeRemaining is the source of truth (TICKs are written
          // through).
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
      // ── Fallback loop (no Web Worker) ──────────────────────────────
      // Earlier this called `tickTimer()` once per second, which (a) was
      // throttled along with the rest of the tab when backgrounded, and
      // (b) early-returned during 'break' state — so the break countdown
      // never advanced in the fallback path.
      //
      // We now mirror the worker's timestamp model: capture an `endsAt`
      // wall-clock at START / RESUME, and on every tick recompute
      // `remaining = ceil((endsAt - Date.now()) / 1000)`. Background
      // throttling can't drift the value because each tick re-reads
      // Date.now(); when the tab un-throttles, the next tick simply jumps
      // to the correct truth.
      if (fallbackRef.current) {
        clearInterval(fallbackRef.current);
        fallbackRef.current = null;
      }

      if (timerState === 'running' && prev === 'paused') {
        // Resume — re-anchor endsAt from the (paused) remaining.
        fallbackEndsAtRef.current = Date.now() + useStore.getState().timeRemaining * 1000;
      } else if (timerState === 'running' || timerState === 'break') {
        // Fresh start (idle→running) OR entering break: anchor from the
        // current remaining.
        fallbackEndsAtRef.current = Date.now() + useStore.getState().timeRemaining * 1000;
      } else {
        fallbackEndsAtRef.current = null;
      }

      if (timerState === 'running' || timerState === 'break') {
        fallbackRef.current = setInterval(() => {
          const endsAt = fallbackEndsAtRef.current;
          if (endsAt == null) return;
          const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
          // Only write to the store when the integer value actually changes
          // — without this we'd cause re-renders 4× per second with the
          // 250 ms tick interval below.
          if (useStore.getState().timeRemaining !== remaining) {
            useStore.setState({ timeRemaining: remaining });
          }
          if (remaining === 0) {
            // Match the worker COMPLETE branch exactly so behaviour is
            // identical regardless of which path drove the countdown.
            // Same stale-state guard as the worker path: if the user
            // reset/paused between this tick scheduling and execution,
            // bail without firing completion side effects.
            const state = useStore.getState();
            if (state.timerState !== 'running' && state.timerState !== 'break') return;
            if (state.isBreak) {
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
              state.completeTimerSession();
            }
            // The state transition above will re-trigger this effect and
            // tear down the interval.
          }
        }, 250);
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
