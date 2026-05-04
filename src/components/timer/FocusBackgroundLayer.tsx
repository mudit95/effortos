'use client';

import React, { useEffect, useMemo, useRef } from 'react';
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

  // Mobile autoplay: even with autoPlay+muted+playsInline, iOS Safari
  // will sometimes refuse to start a video unless we call play()
  // explicitly inside a user-gesture callback. The user opening focus
  // mode IS a user gesture, but the gesture's "live trust" only
  // extends through one synchronous tick. We attach a play() retry
  // on visibilitychange-to-visible AND on first user click anywhere
  // in the focus view, which together cover every realistic scenario:
  //   - Initial mount inside a click → autoplay works
  //   - Backgrounded then foregrounded → visibility handler retries
  //   - Autoplay blocked for any other reason → next click retries
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoUrl = bg?.type === 'video' ? bg.url : undefined;
  useEffect(() => {
    if (!videoUrl) return;

    const tryPlay = () => {
      const v = videoRef.current;
      if (!v) return;
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Promise rejection means autoplay was blocked. Browsers
          // throw NotAllowedError here. We swallow it; the next
          // user gesture will fire tryPlay again.
        });
      }
    };

    // Initial attempt — runs after the React commit, so the video
    // element is mounted and `src` is set.
    tryPlay();

    const onVisible = () => {
      if (document.visibilityState === 'visible') tryPlay();
    };
    document.addEventListener('visibilitychange', onVisible);

    // First-tap fallback — bound to the document so any tap inside
    // focus mode (start button, bg picker, ambient toggle) re-attempts.
    document.addEventListener('click', tryPlay, { once: true });
    document.addEventListener('touchstart', tryPlay, { once: true });

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('click', tryPlay);
      document.removeEventListener('touchstart', tryPlay);
    };
    // Keyed on videoUrl so swapping background re-attaches handlers
    // and re-attempts play for the new source.
  }, [videoUrl]);

  if (!bg) return null;

  // Effective dim: explicit prop takes priority (user override),
  // then the background's per-entry recommendedDim (per-content
  // tuning), and finally a 35% default for entries that don't
  // declare one. Clamped so a stale stored value can't force
  // the scrim to negative or > 100%.
  const effectiveDim =
    typeof dimPercent === 'number'
      ? dimPercent
      : (typeof bg.recommendedDim === 'number' ? bg.recommendedDim : 35);
  const dim = Math.max(0, Math.min(100, effectiveDim)) / 100;

  // Vignette behind the timer area. The flat dim scrim alone can't
  // make centered white timer text legible on a bright video — a
  // radial gradient ellipse darkens the middle of the viewport
  // while leaving the edges of the background vivid. Strength is
  // per-content (bright videos get 'strong', dark ones get 'subtle'
  // or 'none').
  const vignetteIntensity =
    bg.vignette ?? (bg.type === 'video' ? 'normal' : 'none');
  const vignetteCss =
    vignetteIntensity === 'subtle'
      ? 'radial-gradient(ellipse 600px 380px at 50% 50%, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0) 75%)'
      : vignetteIntensity === 'normal'
      ? 'radial-gradient(ellipse 700px 440px at 50% 50%, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.22) 45%, rgba(0,0,0,0) 75%)'
      : vignetteIntensity === 'strong'
      ? 'radial-gradient(ellipse 800px 500px at 50% 50%, rgba(0,0,0,0.60) 0%, rgba(0,0,0,0.30) 45%, rgba(0,0,0,0) 80%)'
      : null;

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
            ref={videoRef}
            src={bg.url}
            poster={bg.posterUrl}
            autoPlay
            loop
            muted
            // playsInline is critical on iOS — without it the
            // browser forces fullscreen on play, breaking the focus
            // mode layout.
            playsInline
            // disablePictureInPicture so the video doesn't fight
            // with our timer PiP window when the user opens that.
            disablePictureInPicture
            // disableRemotePlayback so AirPlay/cast targets don't
            // think this is castable content.
            disableRemotePlayback
            // metadata-only preload: "auto" on mobile burns 5-10 MB
            // of cellular data per video; "metadata" pulls just the
            // first frame for the poster, then play() streams the
            // rest. The useEffect above calls play() explicitly so
            // we don't lose the autoplay path.
            preload="metadata"
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

      {/* Timer-area vignette — same z layer as the flat dim scrim
          (z-[1]). Lives ABOVE the visual but BELOW the timer + other
          content (which sit at z-10 via FocusMode's controls).
          Radial dark ellipse centered where the timer renders so
          white digits stay legible regardless of how bright the
          underlying video is. The flat scrim alone would have to go
          to ~70% to be safe on a snowfield, which would also mute
          the rest of the frame; this two-layer approach keeps the
          edges vivid while fixing the centre legibility. Painted
          AFTER the flat scrim in DOM order so it sits on top of it. */}
      {vignetteCss && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{ backgroundImage: vignetteCss }}
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
