'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Volume2, VolumeX, CloudRain, Coffee, Flame, Waves, Wind,
  Trees, CloudLightning, Keyboard, Music2, Piano, Disc3,
} from 'lucide-react';

/**
 * Ambient sound picker for Focus Mode.
 *
 * Three categories, browsed in one popover:
 *
 *   Music      — lofi / piano / jazz          (file-based)
 *   Ambience   — rain / cafe / fireplace /    (hybrid: file with synth
 *                forest / ocean / thunder /     fallback for rain/cafe/
 *                keyboard                       fireplace, file-only rest)
 *   Noise      — white / pink / brown         (synth, always available)
 *
 * Playback pipeline:
 *   Synth : AudioBufferSourceNode   ──┐
 *                                     ├──▶ master GainNode ──▶ destination
 *   File  : <audio> ▶ MediaElement ──┘
 *
 * Everything goes through a single master gain so the volume slider
 * affects whatever is playing without restarting it.
 *
 * Asset sourcing: see /public/sounds/README.md — any file you drop in
 * there is auto-detected (HEAD probe on first play) and preferred over
 * synth. Until files are present, the synthesized ambiences are used
 * and the file-only options render as "needs file".
 */

type SoundCategory = 'music' | 'ambience' | 'noise';

type SoundKind =
  | 'none'
  // Noise (synth, always available)
  | 'white' | 'pink' | 'brown'
  // Ambience (hybrid file + synth fallback for first three)
  | 'rain' | 'cafe' | 'fireplace'
  // Ambience (file only)
  | 'forest' | 'ocean' | 'thunderstorm' | 'keyboard'
  // Music (file only)
  | 'lofi' | 'piano' | 'jazz';

interface SoundOption {
  id: SoundKind;
  label: string;
  category: SoundCategory;
  icon: React.ReactNode;
  /** Relative URL under /public. If omitted the sound is synth-only. */
  file?: string;
  /** Whether we have a synth generator if the file isn't present. */
  synthFallback?: boolean;
  /** True for the 'none' placeholder — no audio, never plays. */
  silent?: boolean;
}

// Every option is synthesised via Web Audio when possible so the focus
// mode keeps working offline and without the audio assets bundled. Files
// in /public/sounds are detected at play-time and preferred when present.
const SOUND_OPTIONS: SoundOption[] = [
  { id: 'none', label: 'None', category: 'noise', icon: <VolumeX className="w-5 h-5" />, silent: true },

  // Music (no synth — requires a file)
  { id: 'lofi',  label: 'Lo-fi beats', category: 'music', icon: <Music2 className="w-5 h-5" />, file: '/sounds/lofi.mp3' },
  { id: 'piano', label: 'Soft piano',  category: 'music', icon: <Piano className="w-5 h-5" />,  file: '/sounds/piano.mp3' },
  { id: 'jazz',  label: 'Smooth jazz', category: 'music', icon: <Disc3 className="w-5 h-5" />,  file: '/sounds/jazz.mp3' },

  // Ambience — hybrid for the first three (fall back to synth if file missing)
  { id: 'rain',         label: 'Rain',         category: 'ambience', icon: <CloudRain className="w-5 h-5" />,      file: '/sounds/rain.mp3',         synthFallback: true },
  { id: 'cafe',         label: 'Café',         category: 'ambience', icon: <Coffee className="w-5 h-5" />,         file: '/sounds/cafe.mp3',         synthFallback: true },
  { id: 'fireplace',    label: 'Fireplace',    category: 'ambience', icon: <Flame className="w-5 h-5" />,          file: '/sounds/fireplace.mp3',    synthFallback: true },
  { id: 'forest',       label: 'Forest',       category: 'ambience', icon: <Trees className="w-5 h-5" />,          file: '/sounds/forest.mp3' },
  { id: 'ocean',        label: 'Ocean waves',  category: 'ambience', icon: <Waves className="w-5 h-5" />,          file: '/sounds/ocean.mp3' },
  { id: 'thunderstorm', label: 'Thunderstorm', category: 'ambience', icon: <CloudLightning className="w-5 h-5" />, file: '/sounds/thunderstorm.mp3' },
  { id: 'keyboard',     label: 'Keyboard',     category: 'ambience', icon: <Keyboard className="w-5 h-5" />,       file: '/sounds/keyboard.mp3' },

  // Noise (synth, always available)
  { id: 'brown', label: 'Brown noise', category: 'noise', icon: <Waves className="w-5 h-5" /> },
  { id: 'pink',  label: 'Pink noise',  category: 'noise', icon: <Wind className="w-5 h-5" /> },
  { id: 'white', label: 'White noise', category: 'noise', icon: <Wind className="w-5 h-5" /> },
];

const CATEGORY_LABELS: Record<SoundCategory, string> = {
  music: 'Music',
  ambience: 'Ambience',
  noise: 'Noise',
};

const STORAGE_KEY = 'effortos_ambient_sound';

// Cache HEAD probes so we don't re-check a missing file every time the
// user toggles a sound. Module-level cache survives mount/unmount.
const fileAvailCache = new Map<string, boolean>();

async function probeFile(url: string): Promise<boolean> {
  const cached = fileAvailCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const ok = res.ok;
    fileAvailCache.set(url, ok);
    return ok;
  } catch {
    fileAvailCache.set(url, false);
    return false;
  }
}

/**
 * Generates a looping buffer for a given synth-capable sound kind.
 *
 * Noise colours:
 *   - white: raw uniform noise, sharp & hiss-y
 *   - brown: integrated white (1/f²), deep rumble
 *   - pink:  Paul Kellett IIR filter (1/f), balanced for masking
 *
 * Synthesised ambiences — approximations, not recordings:
 *   - rain:      high-pass pink noise + slow amplitude modulation
 *   - cafe:      heavily low-passed brown noise + faint voice-band bursts
 *   - fireplace: low-passed brown noise (the roar) + transient crackle pops
 */
type SynthKind = 'white' | 'pink' | 'brown' | 'rain' | 'cafe' | 'fireplace';

function generateNoiseBuffer(ctx: AudioContext, kind: SynthKind): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const isAmbience = kind === 'rain' || kind === 'cafe' || kind === 'fireplace';
  const seconds = isAmbience ? 10 : 2;
  const bufferSize = sampleRate * seconds;
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  if (kind === 'white') {
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.4;
    }
    return buffer;
  }

  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buffer;
  }

  if (kind === 'pink') {
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
    return buffer;
  }

  if (kind === 'rain') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let prev = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      const hp = pink - prev * 0.85;
      prev = pink;
      const t = i / sampleRate;
      const am = 0.75 + 0.18 * Math.sin(2 * Math.PI * 0.08 * t) + 0.07 * Math.cos(2 * Math.PI * 0.25 * t);
      data[i] = hp * am * 0.9;
    }
    return buffer;
  }

  if (kind === 'cafe') {
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 2.0;
    }
    let lp = 0;
    for (let i = 0; i < bufferSize; i++) {
      lp = lp * 0.88 + data[i] * 0.12;
      data[i] = lp * 1.3;
    }
    const burstCount = 45;
    for (let b = 0; b < burstCount; b++) {
      const start = Math.floor(Math.random() * (bufferSize - sampleRate / 2));
      const duration = Math.floor(sampleRate * (0.04 + Math.random() * 0.18));
      const freq = 180 + Math.random() * 340;
      const amp = 0.015 + Math.random() * 0.02;
      for (let i = 0; i < duration; i++) {
        const tt = i / sampleRate;
        const env = Math.exp(-tt * 9);
        const tone = Math.sin(2 * Math.PI * freq * tt) * amp * env;
        if (start + i < bufferSize) data[start + i] += tone;
      }
    }
    return buffer;
  }

  if (kind === 'fireplace') {
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.0;
    }
    let lp = 0;
    for (let i = 0; i < bufferSize; i++) {
      lp = lp * 0.93 + data[i] * 0.07;
      data[i] = lp * 2.4;
    }
    const crackleCount = 90;
    for (let c = 0; c < crackleCount; c++) {
      const start = Math.floor(Math.random() * (bufferSize - sampleRate / 4));
      const duration = Math.floor(sampleRate * (0.015 + Math.random() * 0.07));
      const amp = 0.2 + Math.random() * 0.25;
      for (let i = 0; i < duration; i++) {
        const tt = i / sampleRate;
        const env = Math.exp(-tt * 55);
        const noise = (Math.random() * 2 - 1) * amp * env;
        if (start + i < bufferSize) data[start + i] += noise;
      }
    }
    return buffer;
  }

  return buffer;
}

/**
 * Active playback handle — either a buffer source (synth / decoded file)
 * or a streaming <audio> element. We union them so the stop/cleanup path
 * can handle either without caring which it was.
 */
type Playing =
  | { kind: 'buffer'; src: AudioBufferSourceNode }
  | { kind: 'media'; audio: HTMLAudioElement; src: MediaElementAudioSourceNode };

export function AmbientSoundToggle() {
  const [selected, setSelected] = useState<SoundKind>('none');
  const [volume, setVolume] = useState(0.4);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<Set<SoundKind>>(new Set());
  const [loadingId, setLoadingId] = useState<SoundKind | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const playingRef = useRef<Playing | null>(null);
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
    const p = playingRef.current;
    if (!p) return;
    if (p.kind === 'buffer') {
      try { p.src.stop(); } catch {}
      try { p.src.disconnect(); } catch {}
    } else {
      try { p.audio.pause(); } catch {}
      try { p.src.disconnect(); } catch {}
      // Clear src so the browser can release the decoded stream.
      try { p.audio.src = ''; p.audio.load(); } catch {}
    }
    playingRef.current = null;
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
    // This effect intentionally does NOT depend on `volume` — a separate
    // effect mirrors the volume into the gain node without restarting
    // playback. Read volumeRef on first attach for the initial value.
    let cancelled = false;

    stopAll();
    if (selected === 'none') return;

    const option = SOUND_OPTIONS.find(o => o.id === selected);
    if (!option || option.silent) return;

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

    (async () => {
      // Try the file first, if the option has one.
      if (option.file) {
        setLoadingId(selected);
        const fileOk = await probeFile(option.file);
        if (cancelled) return;
        if (fileOk) {
          try {
            const audio = new Audio(option.file);
            audio.loop = true;
            audio.crossOrigin = 'anonymous';
            audio.preload = 'auto';
            // Wait for enough data to start playback.
            await new Promise<void>((resolve, reject) => {
              const onReady = () => { audio.removeEventListener('error', onErr); resolve(); };
              const onErr = () => { audio.removeEventListener('canplay', onReady); reject(new Error('audio error')); };
              audio.addEventListener('canplay', onReady, { once: true });
              audio.addEventListener('error', onErr, { once: true });
              audio.load();
            });
            if (cancelled) { try { audio.pause(); } catch {} return; }
            const src = ctx.createMediaElementSource(audio);
            src.connect(gain);
            await audio.play();
            if (cancelled) { try { audio.pause(); } catch {} return; }
            playingRef.current = { kind: 'media', audio, src };
            setLoadingId(null);
            return;
          } catch {
            // Fall through to synth fallback / unavailable.
          }
        }
        setLoadingId(null);

        if (!option.synthFallback) {
          setUnavailable(s => {
            if (s.has(selected)) return s;
            const next = new Set(s);
            next.add(selected);
            return next;
          });
          setSelected('none');
          return;
        }
      }

      // Synth path (noise tier, or file-hybrid fallback).
      const synthKind = selected as SynthKind;
      try {
        const buffer = generateNoiseBuffer(ctx, synthKind);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gain);
        src.start();
        if (cancelled) { try { src.stop(); src.disconnect(); } catch {} return; }
        playingRef.current = { kind: 'buffer', src };
      } catch {
        setUnavailable(s => {
          const next = new Set(s);
          next.add(selected);
          return next;
        });
        setSelected('none');
      }
    })();

    return () => { cancelled = true; };
    // We intentionally omit volume — a separate effect mirrors it into the
    // gain node without restarting playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, stopAll]);

  // Mirror volume into whatever is playing
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
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
  const activeOption = SOUND_OPTIONS.find(o => o.id === selected);
  const activeLabel = activeOption?.label ?? 'None';

  // Group options by category for the popover render.
  const byCategory: Record<SoundCategory, SoundOption[]> = {
    music: SOUND_OPTIONS.filter(o => o.category === 'music'),
    ambience: SOUND_OPTIONS.filter(o => o.category === 'ambience'),
    noise: SOUND_OPTIONS.filter(o => o.category === 'noise' && !o.silent),
  };
  // 'None' sits at the top of Noise for quick mute access.
  const noneOption = SOUND_OPTIONS.find(o => o.silent);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        className={`relative transition-all p-4 rounded-xl ring-1 ${
          active
            ? 'text-cyan-300 bg-cyan-400/10 ring-cyan-400/30 hover:bg-cyan-400/15 shadow-lg shadow-cyan-500/10'
            : 'text-white/40 ring-white/10 hover:text-white/70 hover:bg-white/5 hover:ring-white/20'
        }`}
        aria-label={`Ambient sound (${activeLabel})`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {active ? <Volume2 className="w-8 h-8" /> : <VolumeX className="w-8 h-8" />}
        {active && (
          <span
            className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse"
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
            className="absolute top-[4.5rem] right-0 bg-[#1a1f2e] border border-white/10 rounded-xl p-3 shadow-2xl w-72 z-20 max-h-[70vh] overflow-y-auto"
            role="menu"
          >
            {/* None / mute row */}
            {noneOption && (
              <button
                onClick={() => setSelected('none')}
                role="menuitemradio"
                aria-checked={selected === 'none'}
                className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors text-left mb-2 ${
                  selected === 'none'
                    ? 'bg-white/10 text-white/90'
                    : 'text-white/60 hover:bg-white/5'
                }`}
              >
                <span className="shrink-0">{noneOption.icon}</span>
                <span className="flex-1">{noneOption.label}</span>
              </button>
            )}

            {(['music', 'ambience', 'noise'] as SoundCategory[]).map(cat => (
              <div key={cat} className="mb-2 last:mb-0">
                <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1 px-1">
                  {CATEGORY_LABELS[cat]}
                </p>
                <div className="space-y-0.5">
                  {byCategory[cat].map(o => {
                    const isUnavailable = unavailable.has(o.id);
                    const isSelected = selected === o.id;
                    const isLoading = loadingId === o.id;
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
                        className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors text-left ${
                          isSelected
                            ? 'bg-cyan-500/15 text-cyan-300'
                            : isUnavailable
                              ? 'text-white/20 cursor-not-allowed'
                              : 'text-white/60 hover:bg-white/5'
                        }`}
                      >
                        <span className="shrink-0">{o.icon}</span>
                        <span className="flex-1">{o.label}</span>
                        {isLoading && (
                          <span className="text-[9px] text-cyan-300/70">loading…</span>
                        )}
                        {!isLoading && isUnavailable && (
                          <span className="text-[9px] text-white/30">needs file</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

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
