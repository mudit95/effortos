'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Headspace-style breathing meditation guide.
 *
 * A pulsing organic circle that expands and contracts in a
 * 4s inhale / 4s exhale cycle. The animation loops continuously.
 *
 * Renders as an overlay around the timer ring — the timer
 * keeps running behind it.
 */

const INHALE_MS = 4000;
const EXHALE_MS = 4000;
const CYCLE_MS = INHALE_MS + EXHALE_MS;

type Phase = 'inhale' | 'exhale';

export function BreathingGuide({ onClose }: { onClose?: () => void }) {
  const [phase, setPhase] = useState<Phase>('inhale');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setPhase('inhale');

    intervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) % CYCLE_MS;
      setPhase(elapsed < INHALE_MS ? 'inhale' : 'exhale');
    }, 100);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 flex items-center justify-center"
      >
        {/* Outer breathing wave — bold and clearly visible */}
        <motion.div
          className="rounded-full"
          style={{
            width: 380,
            height: 380,
            background: 'radial-gradient(circle, rgba(34,197,94,0.22) 0%, rgba(34,197,94,0.08) 50%, transparent 75%)',
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
            width: 320,
            height: 320,
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
            width: 260,
            height: 260,
            background: 'radial-gradient(circle, rgba(34,197,94,0.14) 0%, transparent 55%)',
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

        {/* Text instruction */}
        <motion.div
          className="absolute -bottom-12 left-1/2 -translate-x-1/2 whitespace-nowrap"
          key={phase}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-sm text-green-400/60 font-medium tracking-wide">
            {phase === 'inhale' ? 'Breathe in...' : 'Breathe out...'}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
