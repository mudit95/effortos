'use client';

import React, { useMemo } from 'react';
import {
  resolveFocusBackground,
  type FocusBackground,
} from '@/lib/focus-backgrounds';

/**
 * Layered render of the focus-mode background — sits at z-0 inside
 * FocusMode, with everything else (timer, controls, ambient toggle)
 * above it. The dim scrim is a sibling, NOT a parent, so the user
 * picker's dim slider can ramp it from 0 (full background) to ~70%
 * (mostly black) without disturbing the background itself.
 *
 * Three visual paths in priority order:
 *   1. Gradient — pure CSS `background:` set on the layer div. Zero
 *      network, instant render. Default fallback for an unknown id.
 *   2. Image    — `<img>` with `object-fit: cover` so it always fills
 *      the viewport regardless of aspect ratio. Lazy-loaded so the
 *      focus mode opens fast and the background fades in once the
 *      browser has the bytes.
 *   3. Video    — `<video autoplay loop muted playsInline>`. Loops
 *      silently in the background. Falls back to the entry's
 *      `posterUrl` (rendered as a static `<img>`) when the user has
 *      `prefers-reduced-motion: reduce` set — that's a real
 *      accessibility need, not an optional polish.
 *
 * Reduced-motion gate: read once at mount via matchMedia. We don't
 * subscribe to changes because the focus-mode session is short
 * enough (25 min default) that flipping the OS preference mid-session
 * isn't a realistic case.
 */
export function FocusBackgroundLayer({
  backgroundId,
  dimPercent,
  customResolver,
}: {
  /** profiles.focus_background_id — null/undefined renders nothing
   *  (the default solid dark gradient on the FocusMode container
   *  shows through). */
  backgroundId: string | null | undefined;
  /** profiles.focus_background_dim — 0-100, defaults to 35 if missing. */
  dimPercent?: number;
  /** Resolves 'custom:<storage-key>' ids to their signed URL + MIME.
   *  Provided by the dashboard's user-context wrapper; not required
   *  if the user only ever picks bundled defaults. */
  customResolver?: (
    storageKey: string,
  ) => { url: string; mime: string } | null;
}) {
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const bg: FocusBackground | null = useMemo(
    () => resolveFocusBackground(backgroundId, customResolver),
    [backgroundId, customResolver],
  );

  if (!bg) return null;

  const dim = Math.max(0, Math.min(100, dimPercent ?? 35)) / 100;

  return (
    <>
      {/* Visual layer — gradient / image / video. Absolute fill,
          z-0, pointer-events-none so it never eats clicks meant for
          the timer or the exit button. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 pointer-events-none overflow-hidden"
      >
        {bg.type === 'gradient' && bg.gradientCss && (
          <div
            className="absolute inset-0"
            style={{ background: bg.gradientCss }}
          />
        )}

        {bg.type === 'image' && bg.url && (
          /* Plain <img>, not next/image — focus-backgrounds catalog
             URLs come from Pexels/Pixabay CDNs that aren't in
             next/image's remotePatterns config. The image is bounded
             by inset-0 + object-cover so the LCP / bandwidth concerns
             next/image guards against don't really apply.
             eslint-disable-next-line is the same pattern used in
             JournalModal for Supabase signed URLs. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bg.url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        )}

        {bg.type === 'video' && bg.url && !reducedMotion && (
          <video
            src={bg.url}
            poster={bg.posterUrl}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {bg.type === 'video' && bg.posterUrl && reducedMotion && (
          // Reduced-motion fallback: render the poster as a still.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bg.posterUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </div>

      {/* Dim scrim — sits between the visual and the content. Pure
          black with adjustable alpha so colour-balance never shifts
          weirdly the way a coloured tint would. pointer-events-none
          so clicks fall through. */}
      {dim > 0 && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{ backgroundColor: `rgba(0, 0, 0, ${dim})` }}
        />
      )}

      {/* Tiny credit footer when the entry has attribution metadata.
          z-1 same as the scrim, but positioned at the bottom corner
          where it doesn't compete with the timer. Renders even on
          videos because the photographer / source still wants credit
          regardless of medium. */}
      {bg.attribution && (
        <p
          className="absolute bottom-2 right-3 z-[1] text-[10px] text-white/30 select-none pointer-events-none"
          style={{ textShadow: '0 0 4px rgba(0,0,0,0.6)' }}
        >
          Background by {bg.attribution.by} · {bg.attribution.provider}
        </p>
      )}
    </>
  );
}
