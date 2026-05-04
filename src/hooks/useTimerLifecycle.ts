'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { openPiP, closePiP, usePiPStore } from '@/hooks/usePiP';

/**
 * Cross-device timer-lifecycle handler.
 *
 * Mounted once at AppShell level, alongside `<TimerEngine />`. Listens
 * for `visibilitychange` and orchestrates two device-specific behaviours:
 *
 *   - **Desktop (pointer:fine + PiP supported):** when the user
 *     navigates away with a session running and they're in focus mode,
 *     auto-open the Picture-in-Picture window so the timer follows
 *     them. Auto-close PiP when they return to the tab.
 *
 *   - **Mobile (pointer:coarse OR no PiP):** when the user navigates
 *     away with a session running, auto-PAUSE the timer. When they
 *     come back to focus mode, auto-RESUME. The previous behaviour
 *     was that the worker's timestamp-based math kept the countdown
 *     "running" mathematically while the tab was suspended — so users
 *     would come back to find their session almost over even though
 *     they hadn't been working. Pausing on blur matches mobile-user
 *     expectation: "I left, the timer paused; I'm back, it's resuming."
 *
 *   - **Audio:** any tab that becomes visible again after being
 *     hidden has its AudioContext resumed (mobile browsers suspend
 *     it on background). Without this, the next session-end chime
 *     silently fails.
 *
 * Discrimination: we ALWAYS use `(pointer: coarse)` to detect mobile.
 * UA sniffing is unreliable; pointer media query is what every CSS
 * we already ship gates on. Tablets with a stylus → coarse → pause-on-blur,
 * which is the right behaviour for a tablet anyway.
 *
 * Auto-pause vs user-pause distinction: we mark a `timer.was_auto_paused`
 * flag in localStorage when we initiate the auto-pause. Auto-resume on
 * return only fires if the flag is set; if the user manually paused
 * before backgrounding, the flag stays unset and we leave their pause
 * alone.
 */

const AUTO_PAUSED_KEY = 'effortos:timer_auto_paused';

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

function isPiPSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

function getAutoPausedFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AUTO_PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}

function setAutoPausedFlag(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(AUTO_PAUSED_KEY, '1');
    else window.localStorage.removeItem(AUTO_PAUSED_KEY);
  } catch { /* ignore */ }
}

/**
 * Resume the global AudioContext if it's suspended.
 *
 * Mobile browsers suspend AudioContext when a tab is hidden. The
 * `playSound` helper has its own resume call but it only fires once
 * the user actively triggers a sound — a session that completes WHILE
 * the tab is hidden never gets a chance, so the chime is silent until
 * the next manual play. Resuming on visibility-restore guarantees the
 * context is awake by the time any subsequent sound is requested.
 */
async function resumeAudioContextIfSuspended(): Promise<void> {
  // Lazy-load sounds to avoid pulling the AudioContext into pages
  // that don't need it.
  try {
    const sounds = await import('@/lib/sounds');
    if (typeof sounds.resumeAudioContext === 'function') {
      await sounds.resumeAudioContext();
    }
  } catch {
    /* ignore */
  }
}

export function useTimerLifecycle() {
  // Track whether THIS mount initiated the auto-PiP, so we only
  // auto-close PiP we ourselves opened (don't slam shut a PiP the
  // user opened manually before backgrounding).
  const autoPiPRef = useRef(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const state = useStore.getState();
      const isHidden = document.visibilityState === 'hidden';
      const isRunning = state.timerState === 'running';
      const isFocusView = state.currentView === 'focus';

      if (isHidden) {
        if (!isRunning) return; // nothing to do for paused/idle/break

        // Desktop with PiP support → auto-open PiP. Only when user is
        // in focus mode (otherwise PiP would yank them back into a
        // timer they'd intentionally moved away from).
        if (!isCoarsePointer() && isPiPSupported() && isFocusView) {
          const pipAlreadyOpen = usePiPStore.getState().isPiPActive;
          if (!pipAlreadyOpen) {
            // Fire-and-forget; PiP requestWindow returns a Promise but
            // we don't await — the visibilitychange handler must
            // return synchronously.
            void openPiP();
            autoPiPRef.current = true;
          }
        } else {
          // Mobile (or desktop without PiP) → auto-pause. Mark the
          // flag so auto-resume fires when the user returns.
          // Only pause if we're actually running; the guard at the
          // top of pauseTimer also enforces this.
          setAutoPausedFlag(true);
          state.pauseTimer();
        }
      } else {
        // Tab became visible.
        // Resume audio context regardless of platform.
        void resumeAudioContextIfSuspended();

        // Desktop: close auto-opened PiP. We only close PiPs we
        // opened ourselves; user-opened PiPs stay alive.
        if (autoPiPRef.current) {
          closePiP();
          autoPiPRef.current = false;
        }

        // Mobile: auto-resume if we auto-paused AND the user is back
        // in focus mode (they might have backgrounded then nav'd to a
        // different page; only resume if they're actually looking at
        // the timer).
        if (getAutoPausedFlag()) {
          setAutoPausedFlag(false);
          const after = useStore.getState();
          if (after.timerState === 'paused' && after.currentView === 'focus') {
            after.resumeTimer();
          }
          // If they navigated to dashboard/etc. instead of focus, we
          // leave the timer paused — they can resume manually from
          // the dashboard's "running session" banner. Better than
          // resuming a session the user implicitly walked away from.
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also handle pageshow with persisted=true (back-forward cache
    // restore on iOS Safari). bfcache restore reuses the in-memory
    // state but visibilitychange may not fire reliably.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) handleVisibilityChange();
    };
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);
}
