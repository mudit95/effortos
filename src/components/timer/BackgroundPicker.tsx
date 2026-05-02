'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image as ImageIcon, Shuffle, Sparkles } from 'lucide-react';
import { useStore } from '@/store/useStore';
import {
  BUNDLED_BACKGROUNDS,
  type FocusBackground,
  type FocusBackgroundType,
} from '@/lib/focus-backgrounds';

/**
 * Focus-mode background picker (mig 036).
 *
 * Sits next to the AmbientSoundToggle in FocusMode. Single button →
 * popover with three rows (Gradients / Images / Videos), a shuffle
 * button, and a dim slider. The popover layout mirrors
 * AmbientSoundToggle's shape so users feel at home.
 *
 * Selection persists via the `setFocusBackground` store action, which
 * updates user.focus_background_id locally and via cloudSync to the
 * profiles row. The same is true for dim — debounced so the slider
 * doesn't fire 60 writes/second while the user drags.
 */
export function BackgroundPicker() {
  const user = useStore((s) => s.user);
  const setFocusBackground = useStore((s) => s.setFocusBackground);

  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const selectedId = user?.focus_background_id ?? null;
  const dim = typeof user?.focus_background_dim === 'number'
    ? user.focus_background_dim
    : 35;

  // Local dim state — committed to the store on slider release so the
  // network write doesn't spam during the drag.
  const [draftDim, setDraftDim] = useState<number>(dim);
  useEffect(() => { setDraftDim(dim); }, [dim]);

  // Group the catalog by type. Memoised so a nudge-driven re-render
  // doesn't re-walk the array.
  const grouped = useMemo<Record<FocusBackgroundType, FocusBackground[]>>(() => ({
    gradient: BUNDLED_BACKGROUNDS.filter((b) => b.type === 'gradient'),
    image: BUNDLED_BACKGROUNDS.filter((b) => b.type === 'image'),
    video: BUNDLED_BACKGROUNDS.filter((b) => b.type === 'video'),
  }), []);

  const handlePick = useCallback(
    (id: string | null) => {
      setFocusBackground({ id });
    },
    [setFocusBackground],
  );

  // Shuffle: pick a random bundled background that's NOT the current
  // selection. Falls back gracefully when fewer than 2 backgrounds
  // exist (early days when the seed script hasn't run — only
  // gradients are present).
  const handleShuffle = useCallback(() => {
    const others = BUNDLED_BACKGROUNDS.filter((b) => b.id !== selectedId);
    if (others.length === 0) return;
    const next = others[Math.floor(Math.random() * others.length)];
    setFocusBackground({ id: next.id });
  }, [selectedId, setFocusBackground]);

  const commitDim = useCallback(
    (value: number) => {
      setFocusBackground({ dim: value });
    },
    [setFocusBackground],
  );

  // Outside-click + Escape close — same shape as AmbientSoundToggle.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(t) &&
        buttonRef.current && !buttonRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isActive = selectedId != null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className={`relative transition-all p-4 rounded-xl ring-1 ${
          isActive
            ? 'text-cyan-300 bg-cyan-400/10 ring-cyan-400/30 hover:bg-cyan-400/15 shadow-lg shadow-cyan-500/10'
            : 'text-white/40 ring-white/10 hover:text-white/70 hover:bg-white/5 hover:ring-white/20'
        }`}
        aria-label="Focus background"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <ImageIcon className="w-8 h-8" />
        {isActive && (
          <span
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-cyan-300"
            aria-hidden="true"
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute top-[4.5rem] right-0 bg-[#1a1f2e] border border-white/10 rounded-xl p-3 shadow-2xl w-80 z-20 max-h-[70vh] overflow-y-auto"
            role="menu"
          >
            {/* Header row: None button + Shuffle. */}
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => handlePick(null)}
                role="menuitemradio"
                aria-checked={selectedId === null}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs transition-colors ${
                  selectedId === null
                    ? 'bg-white/10 text-white/90'
                    : 'text-white/50 hover:bg-white/5'
                }`}
              >
                Default
              </button>
              <button
                onClick={handleShuffle}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                aria-label="Shuffle to a random background"
                disabled={BUNDLED_BACKGROUNDS.length < 2}
              >
                <Shuffle className="w-3 h-3" />
                Shuffle
              </button>
            </div>

            {(['gradient', 'image', 'video'] as FocusBackgroundType[]).map((cat) => {
              const items = grouped[cat];
              if (items.length === 0) {
                // Skip empty categories — when the seed script hasn't
                // run yet, the picker just shows gradients.
                return null;
              }
              return (
                <div key={cat} className="mb-3 last:mb-0">
                  <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 px-1 flex items-center gap-1">
                    {cat === 'gradient' && 'Gradients'}
                    {cat === 'image' && 'Photos'}
                    {cat === 'video' && (
                      <>
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>Live wallpapers</span>
                      </>
                    )}
                  </p>
                  {/* Tile grid — 2 columns of small thumbnails. We don't
                      preload remote thumbs because it'd hammer the
                      Pexels CDN every time the picker opens. Browser
                      lazy-loading handles the staging. */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map((bg) => {
                      const selected = selectedId === bg.id;
                      return (
                        <button
                          key={bg.id}
                          onClick={() => handlePick(bg.id)}
                          role="menuitemradio"
                          aria-checked={selected}
                          className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all ${
                            selected
                              ? 'border-cyan-400/60 shadow-md shadow-cyan-500/20'
                              : 'border-white/[0.05] hover:border-white/20'
                          }`}
                          title={bg.label}
                        >
                          {bg.type === 'gradient' && bg.gradientCss && (
                            <div
                              className="absolute inset-0"
                              style={{ background: bg.gradientCss }}
                            />
                          )}
                          {(bg.type === 'image' || bg.type === 'video') && bg.posterUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={bg.posterUrl}
                              alt={bg.label}
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="lazy"
                            />
                          )}
                          {bg.type === 'image' && bg.url && !bg.posterUrl && (
                            // No separate poster — fetch the full image.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={bg.url}
                              alt={bg.label}
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="lazy"
                            />
                          )}
                          <span
                            className={`absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[10px] font-medium text-white text-left ${
                              selected ? 'bg-black/60' : 'bg-black/40'
                            }`}
                          >
                            {bg.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Dim slider — global, applies on top of whatever's
                selected. Visual range 0-70 because anything past 70%
                makes most images near-black, which defeats the point
                of having an image at all. */}
            <div className="mt-3 pt-3 border-t border-white/5">
              <label
                htmlFor="focus-bg-dim"
                className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5 px-1"
              >
                Dim · {draftDim}%
              </label>
              <input
                id="focus-bg-dim"
                type="range"
                min={0}
                max={70}
                step={1}
                value={draftDim}
                onChange={(e) => setDraftDim(parseInt(e.target.value, 10))}
                onMouseUp={() => commitDim(draftDim)}
                onTouchEnd={() => commitDim(draftDim)}
                onKeyUp={() => commitDim(draftDim)}
                className="w-full accent-cyan-400"
                aria-label="Background dim"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
