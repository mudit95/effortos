'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Keeps the screen awake while `active` is true using the Screen Wake Lock API.
 *
 * - Automatically re-acquires the lock when the tab regains visibility
 *   (the browser releases wake locks when the tab is hidden).
 * - Gracefully no-ops on browsers that don't support the API.
 */
export function useWakeLock(active: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const acquire = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    // Don't re-acquire if we already hold one
    if (wakeLockRef.current && !wakeLockRef.current.released) return;

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => {
        wakeLockRef.current = null;
      });
    } catch {
      // Wake lock request can fail (e.g., low battery, permissions).
      // Silently degrade — the timer still works, screen just may sleep.
    }
  }, []);

  const release = useCallback(() => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  // Acquire / release based on active flag
  useEffect(() => {
    if (active) {
      acquire();
    } else {
      release();
    }
    return () => release();
  }, [active, acquire, release]);

  // Re-acquire when tab becomes visible again (browser drops the lock on hide)
  useEffect(() => {
    if (!active) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && active) {
        acquire();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [active, acquire]);
}
