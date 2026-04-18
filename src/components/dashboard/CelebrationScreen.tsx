'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { Trophy, Clock, Target, Flame, ArrowRight, Sparkles } from 'lucide-react';
import { sessionsToHours } from '@/lib/utils';

const CONFETTI_COLORS = ['#22d3ee', '#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7'];

// Confetti particle component.
//
// All of the "random" per-particle values (colour, size, rotation target,
// duration, horizontal drift, final fall distance) are frozen into a lazy
// useState initialiser so they're computed exactly once when the particle
// mounts — not recomputed on every re-render. Calling Math.random / reading
// window.innerHeight inside the render body tripped React 19's "impure
// function during render" rule and would also make the particle's
// animation path re-randomise on every parent re-render.
function ConfettiParticle({ delay, x }: { delay: number; x: number }) {
  const [params] = useState(() => ({
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    size: 4 + Math.random() * 6,
    rotation: Math.random() * 360,
    duration: 2 + Math.random() * 2,
    drift: (Math.random() - 0.5) * 200,
    fallTo: typeof window !== 'undefined' ? window.innerHeight + 20 : 800,
  }));

  return (
    <motion.div
      initial={{ y: -20, x, opacity: 1, rotate: 0, scale: 1 }}
      animate={{
        y: params.fallTo,
        x: x + params.drift,
        opacity: 0,
        rotate: params.rotation + 720,
        scale: 0.5,
      }}
      transition={{
        duration: params.duration,
        delay,
        ease: 'linear',
      }}
      className="absolute top-0 rounded-sm"
      style={{
        width: params.size,
        height: params.size * 1.5,
        backgroundColor: params.color,
      }}
    />
  );
}

// Confetti burst — mounts once when the celebration opens, generating
// the 60 particle descriptors inside a useState lazy initialiser (which
// React exempts from the purity rule). Unmounted when the celebration
// closes, so the next open re-runs the initialiser with fresh randomness.
function ConfettiBurst() {
  const [particles] = useState(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    return Array.from({ length: 60 }, (_, i) => ({
      id: i,
      delay: Math.random() * 1.5,
      x: Math.random() * w,
    }));
  });
  return (
    <>
      {particles.map(p => (
        <ConfettiParticle key={p.id} delay={p.delay} x={p.x} />
      ))}
    </>
  );
}

export function CelebrationScreen() {
  const showCelebration = useStore(s => s.showCelebration);
  const setShowCelebration = useStore(s => s.setShowCelebration);
  const activeGoal = useStore(s => s.activeGoal);
  const setView = useStore(s => s.setView);

  // `Date.now()` is impure and cannot be called in render body OR in a
  // useMemo (React 19 rule: hooks must be idempotent). A useState lazy
  // initialiser is explicitly exempt — it runs exactly once at mount.
  // We freeze the "now" at mount, so daysSpent won't flicker across
  // re-renders.
  const [nowAtMount] = useState(() => Date.now());

  const derived = useMemo(() => {
    if (!activeGoal) return null;
    return {
      totalHours: sessionsToHours(activeGoal.sessions_completed),
      daysSpent: Math.ceil(
        (nowAtMount - new Date(activeGoal.created_at).getTime()) / (1000 * 60 * 60 * 24)
      ),
    };
  }, [activeGoal, nowAtMount]);

  if (!activeGoal || !derived) return null;
  const { totalHours, daysSpent } = derived;

  return (
    <AnimatePresence>
      {showCelebration && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[55] flex items-center justify-center bg-[#080b10]/95 backdrop-blur-xl overflow-hidden"
        >
          {/* Confetti — ConfettiBurst holds its own particle state, so it
              mounts fresh each time the celebration opens. */}
          <ConfettiBurst />

          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 text-center px-6 max-w-md"
          >
            {/* Trophy */}
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.5, duration: 0.5, type: 'spring', bounce: 0.5 }}
              className="w-20 h-20 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-yellow-500/20"
            >
              <Trophy className="w-10 h-10 text-white" />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="text-3xl font-bold text-white mb-2"
            >
              You did it!
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="text-white/60 mb-2 font-medium"
            >
              {activeGoal.title}
            </motion.p>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
              className="text-sm text-white/30 mb-8"
            >
              {activeGoal.sessions_completed <= activeGoal.estimated_sessions_initial
                ? `You finished ${activeGoal.estimated_sessions_initial - activeGoal.sessions_completed} sessions ahead of schedule. That's real dedication.`
                : daysSpent <= 7
                ? `${daysSpent} days of focused effort. You should be proud.`
                : `${daysSpent} days of consistent work. That takes serious commitment.`
              }
            </motion.p>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9 }}
              className="grid grid-cols-3 gap-4 mb-10"
            >
              <div className="bg-white/[0.04] rounded-xl p-4">
                <Target className="w-5 h-5 text-cyan-400 mx-auto mb-2" />
                <p className="text-2xl font-bold text-white">{activeGoal.sessions_completed}</p>
                <p className="text-xs text-white/40">Sessions</p>
              </div>
              <div className="bg-white/[0.04] rounded-xl p-4">
                <Clock className="w-5 h-5 text-blue-400 mx-auto mb-2" />
                <p className="text-2xl font-bold text-white">{totalHours}</p>
                <p className="text-xs text-white/40">Hours</p>
              </div>
              <div className="bg-white/[0.04] rounded-xl p-4">
                <Flame className="w-5 h-5 text-orange-400 mx-auto mb-2" />
                <p className="text-2xl font-bold text-white">{daysSpent}</p>
                <p className="text-xs text-white/40">Days</p>
              </div>
            </motion.div>

            {/* Accuracy */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.1 }}
              className="text-center mb-8 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]"
            >
              <p className="text-xs text-white/25 uppercase tracking-wider mb-1">Estimation accuracy</p>
              <p className="text-sm text-white/50">
                Estimated {activeGoal.estimated_sessions_initial} sessions, took {activeGoal.sessions_completed}
              </p>
              <p className="text-xs text-white/30 mt-1">
                {Math.abs(activeGoal.sessions_completed - activeGoal.estimated_sessions_initial) <= 2
                  ? 'Almost perfect prediction — your instincts are getting sharper!'
                  : activeGoal.sessions_completed < activeGoal.estimated_sessions_initial
                  ? 'Ahead of schedule! Your momentum is building.'
                  : "It took a bit longer, and that's okay. Each goal teaches you to estimate better."
                }
              </p>
            </motion.div>

            {/* Actions */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 }}
              className="flex flex-col gap-3"
            >
              <Button
                variant="glow"
                size="lg"
                className="w-full gap-2"
                onClick={() => {
                  setShowCelebration(false);
                  useStore.setState({
                    onboardingStep: 0,
                    onboardingData: {},
                    currentView: 'onboarding',
                    activeGoal: null,
                  });
                }}
              >
                Start New Goal
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={() => {
                  setShowCelebration(false);
                }}
              >
                View Dashboard
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
