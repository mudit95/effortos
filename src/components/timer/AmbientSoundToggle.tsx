'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, VolumeX, CloudRain, Coffee, Flame, Waves, Wind } from 'lucide-react';

type SoundKind = 'none' | 'brown' | 'pink' | 'white' | 'rain' | 'cafe' | 'fireplace';

interface SoundOption {
  id: SoundKind;
  label: string;
  icon: React.ReactNode;
  kind: 'silent' | 'procedural' | 'file';
  src?: string;
}

// File-based sounds expect looping audio assets in /public/sounds/.
// If the files are missing, the option gracefully marks itself unavailable
// the first time it's selected — the UI doesn't crash.
const SOUND_OPTIONS: SoundOption[] = [
  { id: 'none', label: 'None', icon: <VolumeX className="w-4 h-4" />, kind: 'silent' },
  { id: 'brown', label: 'Brown noise', icon: <Waves className="w-4 h-4" />, kind: 'procedural' },
  { id: 'pink', label: 'Pink noise', icon: <Wind className="w-4 h-4" />, kind: 'procedural' },
  { id: 'white', label: 'White noise', icon: <Wind className="w-4 h-4" />, kind: 'procedural' },
  { id: 'rain', label: 'Rain', icon: <CloudRain className="w-4 h-4" />, kind: 'file', src: '/sounds/rain.mp3' },
  { id: 'cafe', label: 'Café', icon: <Coffee className="w-4 h-4" />, kind: 'file', src: '/sounds/cafe.mp3' },
  { id: 'fireplace', label: 'Fireplace', icon: <Flame className="w-4 h-4" />, kind: 'file', src: '/sounds/fireplace.mp3' },
];

const STORAGE_KEY = 'effortos_ambient_sound';

/**
 * Generates a looping noise buffer for the given colour (brown/pink/white).
 *
 * - Brown: integrated white noise (1/f²) — deep, calming rumble
 * - Pink: Paul Kellett's filter (1/f) — balanced, most natural for masking
 * - White: raw uniform noise — sharp, hiss-y
 *
 * 2s buffer is long enough to avoid audible seam when looped.
 */
function generateNoiseBuffer(
  ctx: AudioContext,
  kind: 'brown' | 'pink' | 'white'
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const bufferSize = sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === 'white') {
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.4;
    }
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  } else {
    // Pink — Paul Kellett's economy IIR filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  return buffer;
}

export function AmbientSoundToggle() {
  const [selected, setSelected] = useState<SoundKind>('none');
  const [volume, setVolume] = useState(0.4);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<Set<SoundKind>>(new Set());

  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Restore last choice on mount (client-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { sound?: SoundKind; volume?: number };
      if (saved.sound && SOUND_OPTIONS.some(o => o.id === saved.sound)) {
        setSelected(saved.sound);
      }
      if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) {
        setVolume(saved.volume);
      }
    } catch {}
  }, []);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sound: selected, volume }));
    } catch {}
  }, [selected, volume]);

  const stopAll = useCallback(() => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
      try { gainRef.current?.disconnect(); } catch {}
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        ctxRef.current.close().catch(() => {});
      }
      ctxRef.current = null;
      gainRef.current = null;
    };
  }, [stopAll]);

  // Start / stop audio when selection changes
  useEffect(() => {
    stopAll();
    if (selected === 'none') return;

    const option = SOUND_OPTIONS.find(o => o.id === selected);
    if (!option || option.kind === 'silent') return;

    // Lazily create a single AudioContext + master gain
    if (!ctxRef.current) {
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) throw new Error('AudioContext unsupported');
        ctxRef.current = new Ctx();
        gainRef.current = ctxRef.current.createGain();
        gainRef.current.gain.value = volume;
        gainRef.current.connect(ctxRef.current.destination);
      } catch {
        setUnavailable(s => {
          const next = new Set(s);
          next.add(selected);
          return next;
        });
        setSelected('none');
        return;
      }
    }

    const ctx = ctxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain) return;

    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    if (option.kind === 'procedural') {
      try {
        const buffer = generateNoiseBuffer(ctx, option.id as 'brown' | 'pink' | 'white');
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gain);
        src.start();
        sourceRef.current = src;
      } catch {
        setUnavailable(s => {
          const next = new Set(s);
          next.add(selected);
          return next;
        });
        setSelected('none');
      }
    } else if (option.kind === 'file' && option.src) {
      const audio = new Audio();
      audio.loop = true;
      audio.volume = volume;
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      const onError = () => {
        setUnavailable(s => {
          const next = new Set(s);
          next.add(selected);
          return next;
        });
        // Silently fall back — don't throw.
        if (audioRef.current === audio) setSelected('none');
      };
      audio.addEventListener('error', onError);
      audio.src = option.src;
      audio.play().catch(() => {
        // Autoplay may be blocked until user interacts; user click already
        // happened (they picked the sound), so this rarely fires — but we
        // swallow it rather than crash.
      });
      audioRef.current = audio;
    }
    // We intentionally omit volume here — a separate effect mirrors volume
    // into the live gain/audio nodes without restarting playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Mirror volume into whatever is playing
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Close popover on outside click / Escape
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

  const active = selected !== 'none';
  const activeLabel = SOUND_OPTIONS.find(o => o.id === selected)?.label ?? 'None';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        className={`transition-colors p-2 ${active ? 'text-cyan-400/60 hover:text-cyan-300' : 'text-white/15 hover:text-white/40'}`}
        aria-label={`Ambient sound (${activeLabel})`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {active ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute top-12 right-0 bg-[#1a1f2e] border border-white/10 rounded-xl p-3 shadow-2xl w-56 z-20"
            role="menu"
          >
            <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2 px-1">
              Ambient sound
            </p>
            <div className="space-y-0.5">
              {SOUND_OPTIONS.map(o => {
                const isUnavailable = unavailable.has(o.id);
                const isSelected = selected === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => {
                      if (isUnavailable) return;
                      setSelected(o.id);
                    }}
                    disabled={isUnavailable}
                    role="menuitemradio"
                    aria-checked={isSelected}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-xs transition-colors text-left ${
                      isSelected
                        ? 'bg-cyan-500/15 text-cyan-300'
                        : isUnavailable
                          ? 'text-white/20 cursor-not-allowed'
                          : 'text-white/60 hover:bg-white/5'
                    }`}
                  >
                    <span className="shrink-0">{o.icon}</span>
                    <span className="flex-1">{o.label}</span>
                    {isUnavailable && (
                      <span className="text-[9px] text-white/30">unavailable</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-white/5">
              <label
                htmlFor="ambient-volume"
                className="block text-[10px] uppercase tracking-wider text-white/40 mb-1.5 px-1"
              >
                Volume
              </label>
              <input
                id="ambient-volume"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={e => setVolume(parseFloat(e.target.value))}
                className="w-full accent-cyan-400"
                aria-label="Ambient sound volume"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
