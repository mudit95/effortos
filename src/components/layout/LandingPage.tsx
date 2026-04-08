'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { Sparkles, ArrowRight, Zap, Brain, BarChart3, Target, Clock } from 'lucide-react';

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


/* ── Floating background elements ──────────────────────────────────── */

const FLOATING_LABELS = [
  { text: 'Coding', color: 'rgba(34,211,238,0.35)', border: 'rgba(34,211,238,0.12)', x: '4%', y: '8%', dur: 7, delay: 0 },
  { text: 'Writing', color: 'rgba(59,130,246,0.35)', border: 'rgba(59,130,246,0.12)', x: '82%', y: '14%', dur: 8.5, delay: 0.8 },
  { text: 'Fitness', color: 'rgba(34,197,94,0.35)', border: 'rgba(34,197,94,0.12)', x: '6%', y: '62%', dur: 9, delay: 1.5 },
  { text: 'Music', color: 'rgba(168,85,247,0.35)', border: 'rgba(168,85,247,0.12)', x: '78%', y: '72%', dur: 7.5, delay: 2 },
  { text: 'Design', color: 'rgba(234,179,8,0.35)', border: 'rgba(234,179,8,0.12)', x: '68%', y: '35%', dur: 10, delay: 3 },
  { text: 'Learning', color: 'rgba(239,68,68,0.35)', border: 'rgba(239,68,68,0.12)', x: '2%', y: '38%', dur: 8, delay: 0.5 },
  { text: 'Reading', color: 'rgba(34,211,238,0.28)', border: 'rgba(34,211,238,0.10)', x: '35%', y: '82%', dur: 9.5, delay: 4 },
  { text: 'Research', color: 'rgba(168,85,247,0.28)', border: 'rgba(168,85,247,0.10)', x: '52%', y: '5%', dur: 8.5, delay: 1.2 },
  { text: 'Practice', color: 'rgba(34,197,94,0.28)', border: 'rgba(34,197,94,0.10)', x: '88%', y: '48%', dur: 7.8, delay: 2.5 },
  { text: 'Startup', color: 'rgba(239,68,68,0.28)', border: 'rgba(239,68,68,0.10)', x: '42%', y: '55%', dur: 9.2, delay: 3.5 },
];

// Icon SVG paths (outline style)
const ICON_PATHS = [
  // Book
  'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  // Lightbulb
  'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  // Code
  'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
  // Music
  'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
  // Heart
  'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  // Globe
  'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
];

const FLOATING_ICONS = [
  { path: 0, x: '15%', y: '18%', size: 28, dur: 12, delay: 0.5 },
  { path: 1, x: '75%', y: '25%', size: 26, dur: 14, delay: 1.5 },
  { path: 2, x: '60%', y: '65%', size: 24, dur: 11, delay: 3 },
  { path: 3, x: '22%', y: '78%', size: 26, dur: 13, delay: 2 },
  { path: 4, x: '85%', y: '58%', size: 24, dur: 10, delay: 4 },
  { path: 5, x: '48%', y: '12%', size: 22, dur: 15, delay: 1 },
  { path: 2, x: '10%', y: '48%', size: 20, dur: 12.5, delay: 3.5 },
  { path: 0, x: '92%', y: '82%', size: 22, dur: 11.5, delay: 2.5 },
];

function FloatingBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Floating word bubbles — small text to not compete with headline */}
      {FLOATING_LABELS.map((label) => (
        <motion.span
          key={label.text}
          className="absolute text-[11px] font-semibold tracking-[0.12em] uppercase px-2.5 py-1 rounded-full select-none"
          style={{
            left: label.x,
            top: label.y,
            color: label.color,
            border: `1px solid ${label.border}`,
            background: `${label.border}33`,
          }}
          animate={{
            y: [0, -10, 0, 10, 0],
            x: [0, 5, 0, -5, 0],
          }}
          transition={{
            duration: label.dur,
            delay: label.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          {label.text}
        </motion.span>
      ))}

      {/* Floating icon outlines */}
      {FLOATING_ICONS.map((icon, i) => (
        <motion.svg
          key={i}
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={1.2}
          className="absolute select-none"
          style={{
            left: icon.x,
            top: icon.y,
            width: icon.size,
            height: icon.size,
          }}
          animate={{
            y: [0, -12, 0, 12, 0],
            x: [0, 6, 0, -6, 0],
            rotate: [0, 3, 0, -3, 0],
          }}
          transition={{
            duration: icon.dur,
            delay: icon.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          <path d={ICON_PATHS[icon.path]} />
        </motion.svg>
      ))}
    </div>
  );
}

const EXAMPLE_GOALS = [
  { goal: 'Build a SaaS app', sessions: 52, time: '21.7h', emoji: '🚀' },
  { goal: 'Learn Python basics', sessions: 28, time: '11.7h', emoji: '🐍' },
  { goal: 'Write a research paper', sessions: 44, time: '18.3h', emoji: '📝' },
];

export function LandingPage() {
  const setView = useStore(s => s.setView);
  const [hoveredGoal, setHoveredGoal] = useState<number | null>(null);

  return (
    <div className="flex flex-col relative overflow-hidden bg-[#080b10]">
      {/* Floating background: word bubbles + icon outlines */}
      <FloatingBackground />

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
            Track your goals with AI that adapts to your real pace. Set a target, focus with Pomodoro sessions, and watch your estimates get smarter over time.
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

          {/* Trust line */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="flex items-center justify-center gap-2 mt-10 mb-10"
          >
            <span className="text-xs text-white/20">AI-powered</span>
            <span className="text-white/10">·</span>
            <span className="text-xs text-white/20">Pomodoro-based</span>
            <span className="text-white/10">·</span>
            <span className="text-xs text-white/20">Adapts to your pace</span>
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
