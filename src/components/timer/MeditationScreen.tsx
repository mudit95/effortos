'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { X, Play, Pause, RotateCcw } from 'lucide-react';
import { useWakeLock } from '@/hooks/useWakeLock';
import { playSound, warmUpAudio } from '@/lib/sounds';

/**
 * Standalone meditation screen accessible from the dashboard header.
 *
 * Features:
 *   - Custom duration picker (1, 2, 3, 5, 10, 15, 20 min)
 *   - Headspace-style breathing animation (4s inhale / 4s exhale)
 *   - Countdown timer visible through the breathing waves
 *   - Wake lock to prevent screen sleep
 *   - Sound chime when session ends
 */

const DURATION_OPTIONS = [1, 2, 3, 5, 10, 15, 20];
const INHALE_MS = 4000;
const EXHALE_MS = 4000;
const CYCLE_MS = INHALE_MS + EXHALE_MS;

type Phase = 'inhale' | 'exhale';
type MeditationState = 'picking' | 'running' | 'paused' | 'done';

function formatMM_SS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MeditationScreen({ onClose }: { onClose: () => void }) {
  const [duration, setDuration] = useState(5 * 60); // seconds
  const [remaining, setRemaining] = useState(5 * 60);
  const [state, setState] = useState<MeditationState>('picking');
  const [phase, setPhase] = useState<Phase>('inhale');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const breathRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 0 is a sentinel — the breathing effect stamps Date.now() on mount.
  // Calling Date.now() during render violates react-hooks/purity.
  const breathStartRef = useRef(0);

  const isActive = state === 'running';
  useWakeLock(isActive);

  useEffect(() => { warmUpAudio(); }, []);

  // Breathing cycle. We don't reset phase synchronously here because
  // react-hooks/set-state-in-effect forbids it. The interval below
  // recomputes phase from wall-clock within 100ms, so any stale phase
  // value from a prior run self-corrects almost immediately.
  useEffect(() => {
    if (state !== 'running') {
      if (breathRef.current) clearInterval(breathRef.current);
      return;
    }
    breathStartRef.current = Date.now();
    breathRef.current = setInterval(() => {
      const elapsed = (Date.now() - breathStartRef.current) % CYCLE_MS;
      setPhase(elapsed < INHALE_MS ? 'inhale' : 'exhale');
    }, 100);
    return () => { if (breathRef.current) clearInterval(breathRef.current); };
  }, [state]);

  // Countdown
  useEffect(() => {
    if (state !== 'running') {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          setState('done');
          playSound('pomodoro_complete');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state]);

  const start = useCallback((mins: number) => {
    const secs = mins * 60;
    setDuration(secs);
    setRemaining(secs);
    setState('running');
  }, []);

  const pause = () => setState('paused');
  const resume = () => setState('running');
  const reset = () => {
    setRemaining(duration);
    setState('picking');
  };

  const progress = duration > 0 ? 1 - remaining / duration : 0;
  const ringSize = 300;
  const ringRadius = 130;
  const circumference = 2 * Math.PI * ringRadius;
  const offset = circumference * (1 - progress);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[var(--background,#080b10)] flex flex-col items-center justify-center px-4"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 sm:top-6 sm:right-6 text-white/20 hover:text-white/50 transition-colors p-2 z-10"
        aria-label="Close meditation"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Title */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6 sm:mb-8"
      >
        <h1 className="text-2xl sm:text-3xl font-semibold text-green-400/80 tracking-tight">
          {state === 'done' ? 'Well done' : 'Meditate'}
        </h1>
        {state === 'picking' && (
          <p className="mt-2 text-sm text-white/30">Choose how long you&apos;d like to sit</p>
        )}
        {state === 'done' && (
          <p className="mt-2 text-sm text-white/35">Take a moment before you continue</p>
        )}
      </motion.div>

      {/* Duration picker */}
      <AnimatePresence mode="wait">
        {state === 'picking' && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-wrap justify-center gap-3 mb-10"
          >
            {DURATION_OPTIONS.map(mins => (
              <button
                key={mins}
                onClick={() => start(mins)}
                className="w-16 h-16 rounded-2xl border border-green-500/15 bg-green-500/[0.04] hover:border-green-400/30 hover:bg-green-500/[0.08] transition-all flex flex-col items-center justify-center gap-0.5"
              >
                <span className="text-lg font-semibold text-green-300/80">{mins}</span>
                <span className="text-[9px] text-green-400/40 uppercase tracking-wider">min</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timer ring + breathing waves (visible during running/paused/done) */}
      {state !== 'picking' && (
        <div className="relative w-64 h-64 sm:w-80 sm:h-80 flex items-center justify-center">
          {/* Breathing waves — only during running */}
          {state === 'running' && (
            <>
              {/* Outermost wave — large, bold, clearly visible */}
              <motion.div
                className="absolute rounded-full"
                style={{
                  width: '130%',
                  height: '130%',
                  background: 'radial-gradient(circle, rgba(34,197,94,0.20) 0%, rgba(34,197,94,0.08) 50%, transparent 75%)',
                  border: '2.5px solid rgba(34,197,94,0.30)',
                  boxShadow: '0 0 60px rgba(34,197,94,0.12), inset 0 0 40px rgba(34,197,94,0.06)',
                }}
                animate={{
                  scale: phase === 'inhale' ? 1.18 : 0.82,
                  opacity: phase === 'inhale' ? 1 : 0.5,
                }}
                transition={{
                  duration: phase === 'inhale' ? INHALE_MS / 1000 : EXHALE_MS / 1000,
                  ease: 'easeInOut',
                }}
              />
              {/* Middle ring */}
              <motion.div
                className="absolute rounded-full"
                style={{
                  width: '115%',
                  height: '115%',
                  border: '1.5px solid rgba(34,197,94,0.22)',
                  background: 'radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 60%)',
                }}
                animate={{
                  scale: phase === 'inhale' ? 1.10 : 0.90,
                  opacity: phase === 'inhale' ? 0.8 : 0.3,
                }}
                transition={{
                  duration: phase === 'inhale' ? INHALE_MS / 1000 : EXHALE_MS / 1000,
                  ease: 'easeInOut',
                  delay: 0.15,
                }}
              />
              {/* Inner glow */}
              <motion.div
                className="absolute rounded-full"
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 55%)',
                }}
                animate={{
                  scale: phase === 'inhale' ? 1.06 : 0.94,
                }}
                transition={{
                  duration: phase === 'inhale' ? INHALE_MS / 1000 : EXHALE_MS / 1000,
                  ease: 'easeInOut',
                  delay: 0.1,
                }}
              />
            </>
          )}

          {/* Timer ring */}
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${ringSize} ${ringSize}`}
            className="transform -rotate-90 absolute inset-0"
          >
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={ringRadius}
              fill="none"
              stroke="rgba(255,255,255,0.03)"
              strokeWidth="4"
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={ringRadius}
              fill="none"
              stroke="rgba(34,197,94,0.5)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{
                transition: 'stroke-dashoffset 1s linear',
                filter: state === 'running' ? 'drop-shadow(0 0 12px rgba(34,197,94,0.2))' : 'none',
              }}
            />
          </svg>

          {/* Center text */}
          <div className="relative flex flex-col items-center justify-center">
            {state === 'running' && (
              <motion.p
                key={phase}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs text-green-400/50 uppercase tracking-[0.25em] mb-2"
              >
                {phase === 'inhale' ? 'Breathe in' : 'Breathe out'}
              </motion.p>
            )}
            {state === 'paused' && (
              <p className="text-xs text-white/40 uppercase tracking-[0.25em] mb-2">Paused</p>
            )}
            {state === 'done' && (
              <p className="text-xs text-green-400/50 uppercase tracking-[0.25em] mb-2">Complete</p>
            )}
            <span className="text-5xl sm:text-7xl font-mono font-light text-white tracking-tight tabular-nums">
              {formatMM_SS(remaining)}
            </span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4 mt-8 sm:mt-12">
        {state === 'running' && (
          <>
            <Button
              variant="secondary"
              size="icon"
              onClick={reset}
              className="w-11 h-11 sm:w-12 sm:h-12"
              aria-label="Reset"
            >
              <RotateCcw className="w-5 h-5" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={pause}
              className="gap-2 px-8 sm:px-10 h-12 sm:h-14 text-base"
            >
              <Pause className="w-5 h-5 fill-current" />
              Pause
            </Button>
          </>
        )}

        {state === 'paused' && (
          <>
            <Button
              variant="secondary"
              size="icon"
              onClick={reset}
              className="w-11 h-11 sm:w-12 sm:h-12"
              aria-label="Reset"
            >
              <RotateCcw className="w-5 h-5" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={resume}
              className="gap-2 px-8 sm:px-10 h-12 sm:h-14 text-base"
            >
              <Play className="w-5 h-5 fill-current" />
              Resume
            </Button>
          </>
        )}

        {state === 'done' && (
          <Button
            variant="outline"
            size="lg"
            onClick={onClose}
            className="gap-2 px-8 sm:px-10 h-12 sm:h-14 text-base border-green-500/20 text-green-300 hover:border-green-400/40 hover:bg-green-500/10"
          >
            Done
          </Button>
        )}
      </div>
    </motion.div>
  );
}
