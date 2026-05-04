'use client';

import { useEffect, useState } from 'react';

/**
 * Subscribe to the `prefers-reduced-motion` media query.
 *
 * Returns true when the user has requested reduced motion in their
 * OS settings. Components should respect this by:
 *   - Disabling auto-play loops (focus background videos already do)
 *   - Reducing animation duration to 0 (or near-0)
 *   - Skipping decorative transitions
 *
 * The whole site uses framer-motion which honours
 * `prefers-reduced-motion` automatically for layout transitions but
 * NOT for explicit `animate` props. This hook lets components
 * conditionally tweak their animation specs.
 *
 * Lazy initialiser reads the value at mount time so the first paint
 * doesn't flicker; the listener handles user mid-session preference
 * changes (e.g., turning on reduced motion in System Settings).
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Modern browsers expose addEventListener; older Safari only
    // had addListener.
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, []);

  return reduced;
}
