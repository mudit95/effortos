'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { Sparkles, ArrowRight, Zap, Brain, BarChart3, Target, Clock, Users, Timer } from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

const ROTATING_WORDS = ['underestimating', 'guessing', 'procrastinating', 'winging it'];

function RotatingWord() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="relative inline-block min-w-[200px] sm:min-w-[280px]">
      {ROTATING_WORDS.map((word, i) => (
        <motion.span
          key={word}
          className="text-cyan-400 absolute left-0"
          initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
          animate={i === index
            ? { opacity: 1, y: 0, filter: 'blur(0px)' }
            : { opacity: 0, y: -20, filter: 'blur(4px)' }
          }
          transition={{ duration: 0.5, ease }}
        >
          {word}
        </motion.span>
      ))}
      {/* Invisible spacer for height */}
      <span className="invisible">{ROTATING_WORDS[index]}</span>
    </span>
  );
}

function AnimatedCounter({ target, suffix = '', duration = 2 }: { target: number; suffix?: string; duration?: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const controls = animate(count, target, { duration, ease: [0.22, 1, 0.36, 1] });
    const unsub = rounded.on('change', (v) => setDisplay(v));
    return () => { controls.stop(); unsub(); };
  }, [target, count, rounded, duration]);

  return <>{display.toLocaleString()}{suffix}</>;
}

function FloatingOrb({ delay, size, x, y, color }: { delay: number; size: number; x: string; y: string; color: string }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{ width: size, height: size, left: x, top: y, background: color, filter: 'blur(60px)' }}
      animate={{
        y: [0, -30, 0, 30, 0],
        x: [0, 15, 0, -15, 0],
        opacity: [0.3, 0.6, 0.3],
      }}
      transition={{ duration: 8, delay, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

const EXAMPLE_GOALS = [
  { goal: 'Build a SaaS app', sessions: 52, time: '21.7h', emoji: '🚀' },
  { goal: 'Learn Python basics', sessions: 28, time: '11.7h', emoji: '🐍' },
  { goal: 'Write a research paper', sessions: 44, time: '18.3h', emoji: '📝' },
];

export function LandingPage() {
  const setView = useStore(s => s.setView);
  const loginAsDemo = useStore(s => s.loginAsDemo);
  const [hoveredGoal, setHoveredGoal] = useState<number | null>(null);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Ambient background orbs */}
      <FloatingOrb delay={0} size={300} x="10%" y="20%" color="rgba(6,182,212,0.06)" />
      <FloatingOrb delay={2} size={200} x="70%" y="10%" color="rgba(59,130,246,0.05)" />
      <FloatingOrb delay={4} size={250} x="80%" y="60%" color="rgba(6,182,212,0.04)" />
      <FloatingOrb delay={1} size={180} x="20%" y="70%" color="rgba(139,92,246,0.04)" />

      {/* Hero */}
      <div className="flex-1 flex items-center justify-center px-4 py-16 sm:py-20 relative z-10">
        <div className="max-w-2xl mx-auto text-center">
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease }}
            className="inline-flex items-center gap-3 mb-8"
          >
            <motion.div
              className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-cyan-500/20"
              whileHover={{ rotate: 10, scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            >
              <Sparkles className="w-7 h-7 text-white" />
            </motion.div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6, ease }}
            className="text-4xl sm:text-6xl font-bold text-white tracking-tight leading-[1.1] mb-4"
          >
            Stop <RotatingWord />
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.6, ease }}
            className="text-base sm:text-lg text-white/40 mb-10 max-w-md mx-auto leading-relaxed"
          >
            EffortOS learns from your pace to predict how long things actually take. Powered by AI estimation and Pomodoro focus sessions.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.6, ease }}
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              variant="glow"
              size="lg"
              onClick={() => setView('auth')}
              className="gap-2 px-6 h-13 text-base"
            >
              Get Started
              <ArrowRight className="w-5 h-5" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={loginAsDemo}
              className="gap-2 px-6 h-12"
            >
              <Zap className="w-4 h-4" />
              Try without signing up
            </Button>
          </motion.div>

          {/* Sign in link */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.6, ease }}
            className="mt-4 text-sm text-white/30"
          >
            Already have an account?{' '}
            <button
              onClick={() => setView('auth')}
              className="text-cyan-400/70 hover:text-cyan-400 underline underline-offset-2 transition-colors"
            >
              Sign in
            </button>
          </motion.p>

          {/* Live stats bar */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="flex items-center justify-center gap-6 sm:gap-10 mt-12 mb-12"
          >
            {[
              { icon: Timer, value: 15000, suffix: '+', label: 'Sessions completed' },
              { icon: Users, value: 200, suffix: '+', label: 'Active users' },
              { icon: Target, value: 95, suffix: '%', label: 'Goal accuracy' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + i * 0.1 }}
                className="text-center"
              >
                <p className="text-xl sm:text-2xl font-bold text-white">
                  <AnimatedCounter target={stat.value} suffix={stat.suffix} duration={2 + i * 0.3} />
                </p>
                <p className="text-[10px] sm:text-xs text-white/25 mt-0.5">{stat.label}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* Features */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.8 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6"
          >
            {[
              { icon: Brain, label: 'AI Estimation', desc: 'Predicts your real effort' },
              { icon: Zap, label: '25-min Focus', desc: 'Built-in Pomodoro timer' },
              { icon: BarChart3, label: 'Adapts to You', desc: 'Learns from your pace' },
              { icon: Target, label: 'Visual Progress', desc: 'Every session counts' },
            ].map((feature, i) => (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 + i * 0.1, ease }}
                whileHover={{ y: -4, scale: 1.02 }}
                className="text-center p-3 rounded-xl border border-transparent hover:border-white/[0.06] hover:bg-white/[0.02] transition-colors cursor-default"
              >
                <feature.icon className="w-5 h-5 text-cyan-500/60 mx-auto mb-2" />
                <p className="text-sm font-medium text-white/60">{feature.label}</p>
                <p className="text-xs text-white/30 mt-0.5">{feature.desc}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* Example goals — interactive cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.1, duration: 0.6, ease }}
            className="mt-16"
          >
            <p className="text-xs text-white/25 uppercase tracking-wider mb-4">Real examples</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {EXAMPLE_GOALS.map((ex, i) => (
                <motion.div
                  key={i}
                  onHoverStart={() => setHoveredGoal(i)}
                  onHoverEnd={() => setHoveredGoal(null)}
                  whileHover={{ y: -6, scale: 1.02 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-left cursor-default relative overflow-hidden"
                >
                  {hoveredGoal === i && (
                    <motion.div
                      layoutId="goal-hover-glow"
                      className="absolute inset-0 bg-cyan-500/[0.03] rounded-xl"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{ex.emoji}</span>
                      <p className="text-sm font-medium text-white/70">{ex.goal}</p>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/30">{ex.sessions} sessions</span>
                      <span className="text-cyan-400/60 font-medium">{ex.time}</span>
                    </div>
                    {/* Mini progress bar */}
                    <div className="h-1 rounded-full bg-white/[0.04] mt-3 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-cyan-500/40"
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        transition={{ delay: 1.5 + i * 0.2, duration: 1.2, ease }}
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 text-center relative z-10">
        <p className="text-xs text-white/15">
          Built with intention. Your data syncs securely across devices.
        </p>
      </footer>
    </div>
  );
}
