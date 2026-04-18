'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, VolumeX, CloudRain, Coffee, Flame, Waves, Wind } from 'lucide-react';

type SoundKind =
  | 'none'
  | 'brown'
  | 'pink'
  | 'white'
  | 'rain'
  | 'cafe'
  | 'fireplace';

interface SoundOption {
  id: SoundKind;
  label: string;
  icon: React.ReactNode;
  silent?: boolean;
}

// Every option is synthesized via Web Audio (no external files). That
// sidesteps the "sound is unavailable" failure mode the file-based
// approach suffered from whenever /public/sounds/*.mp3 wasn't present.
const SOUND_OPTIONS: SoundOption[] = [
  { id: 'none', label: 'None', icon: <VolumeX className="w-5 h-5" />, silent: true },
  { id: 'brown', label: 'Brown noise', icon: <Waves className="w-5 h-5" /> },
  { id: 'pink', label: 'Pink noise', icon: <Wind className="w-5 h-5" /> },
  { id: 'white', label: 'White noise', icon: <Wind className="w-5 h-5" /> },
  { id: 'rain', label: 'Rain', icon: <CloudRain className="w-5 h-5" /> },
  { id: 'cafe', label: 'Café', icon: <Coffee className="w-5 h-5" /> },
  { id: 'fireplace', label: 'Fireplace', icon: <Flame className="w-5 h-5" /> },
];

const STORAGE_KEY = 'effortos_ambient_sound';

/**
 * Generates a looping buffer for a given sound kind.
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
 *
 * We use 2s buffers for pure noise and 10s for the ambiences so the
 * synthesised bursts/crackles don't repeat obviously.
 */
function generateNoiseBuffer(ctx: AudioContext, kind: Exclude<SoundKind, 'none'>): AudioBuffer {
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
    // Start with pink noise then differentiate to emphasise highs.
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
      // Simple high-pass: pink - prev*0.85 boosts hiss
      const hp = pink - prev * 0.85;
      prev = pink;
      // Slow amplitude modulation — 0.08 Hz sin mixed with 0.25 Hz cos,
      // so rainfall intensity breathes over the 10s loop without a
      // perfectly periodic swell.
      const t = i / sampleRate;
      const am = 0.75 + 0.18 * Math.sin(2 * Math.PI * 0.08 * t) + 0.07 * Math.cos(2 * Math.PI * 0.25 * t);
      data[i] = hp * am * 0.9;
    }
    return buffer;
  }

  if (kind === 'cafe') {
    // Room tone: brown noise heavily low-passed = distant, warm base
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 2.0;
    }
    // One-pole LP (~heavy) to kill hiss
    let lp = 0;
    for (let i = 0; i < bufferSize; i++) {
      lp = lp * 0.88 + data[i] * 0.12;
      data[i] = lp * 1.3;
    }
    // Voice-band bursts: short enveloped tones in 180–520 Hz range,
    // clustered like distant chatter. Intentionally very quiet — we're
    // suggesting a busy room, not reproducing one.
    const burstCount = 45; // ~4.5 per second over 10s
    for (let b = 0; b < burstCount; b++) {
      const start = Math.floor(Math.random() * (bufferSize - sampleRate / 2));
      const duration = Math.floor(sampleRate * (0.04 + Math.random() * 0.18));
      const freq = 180 + Math.random() * 340;
      const amp = 0.015 + Math.random() * 0.02;
      for (let i = 0; i < duration; i++) {
        const tt = i / sampleRate;
        const env = Math.exp(-tt * 9);
        const tone = Math.sin(2 * Math.PI * freq * tt) * amp * env;
        // Write-guard: don't index past buffer
        if (start + i < bufferSize) data[start + i] += tone;
      }
    }
    return buffer;
  }

  if (kind === 'fireplace') {
    // Fire roar: brown noise, low-passed harder than café for warmth
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
    // Crackle pops: short enveloped noise bursts sprinkled across the loop
    const crackleCount = 90; // ~9 per second
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

export function AmbientSoundToggle() {
  const [selected, setSelected] = useState<SoundKind>('none');
  const [volume, setVolume] = useState(0.4);
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<Set<SoundKind>>(new Set());

  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
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

    try {
      const buffer = generateNoiseBuffer(ctx, selected as Exclude<SoundKind, 'none'>);
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
    // We intentionally omit volume — a separate effect mirrors it into the
    // gain node without restarting playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

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
  const activeLabel = SOUND_OPTIONS.find(o => o.id === selected)?.label ?? 'None';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        className={`transition-colors p-3 rounded-lg ${
          active
            ? 'text-cyan-400/70 hover:text-cyan-300 hover:bg-cyan-400/5'
            : 'text-white/25 hover:text-white/60 hover:bg-white/5'
        }`}
        aria-label={`Ambient sound (${activeLabel})`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {active ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute top-14 right-0 bg-[#1a1f2e] border border-white/10 rounded-xl p-3 shadow-2xl w-60 z-20"
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
