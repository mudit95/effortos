'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate, useInView, useScroll, useSpring, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import {
  Sparkles, ArrowRight, Brain, BarChart3, Target, Clock,
  ChevronDown, Zap, MessageCircle, Calendar, TrendingUp,
  CheckCircle2, Play, Timer, RotateCcw, Flame,
  ListChecks, Bot, Mail, Shield, Pause,
} from 'lucide-react';
import Link from 'next/link';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

// ═════════════════════════════════════════════════════════════════════
// ANIMATED BACKGROUND — floating constellation of connected dots
// ═════════════════════════════════════════════════════════════════════

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrame: number;
    const particles: Array<{
      x: number; y: number; vx: number; vy: number; size: number; opacity: number;
    }> = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Create particles
    const count = Math.min(60, Math.floor(window.innerWidth / 25));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.3 + 0.1,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Update + draw particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas!.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas!.height) p.vy *= -1;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(34, 211, 238, ${p.opacity})`;
        ctx!.fill();
      }

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(34, 211, 238, ${0.06 * (1 - dist / 120)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      animFrame = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animFrame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.6 }}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════
// MORPHING GRADIENT BLOB — slow animated ambient glow
// ═════════════════════════════════════════════════════════════════════

function MorphingBlob({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <motion.div
      style={style}
      className={`absolute rounded-full blur-3xl pointer-events-none ${className}`}
      animate={{
        scale: [1, 1.2, 0.9, 1.1, 1],
        x: [0, 30, -20, 15, 0],
        y: [0, -20, 15, -10, 0],
        rotate: [0, 45, -30, 20, 0],
      }}
      transition={{
        duration: 20,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ═════════════════════════════════════════════════════════════════════

function Section({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease, delay }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (isInView) {
      const controls = animate(count, value, { duration: 2, ease: 'easeOut' });
      return controls.stop;
    }
  }, [isInView, count, value]);

  useEffect(() => {
    const unsub = rounded.on('change', (v) => setDisplay(v));
    return unsub;
  }, [rounded]);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════
// ROTATING HEADLINE — with typewriter-style reveal
// ═════════════════════════════════════════════════════════════════════

// Rotated outcomes (not negations). Outcomes convert significantly better:
// readers see a finish line, not a problem they already know they have.
// Tilted slightly US-first (bar exam, dissertation) but kept universal so
// the same hero works for global traffic.
const ROTATING_WORDS = [
  'your novel.',
  'the bar exam.',
  'your MVP.',
  'your dissertation.',
  'a new language.',
];

function RotatingWord() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="relative inline-block min-w-[180px] sm:min-w-[260px] text-left">
      <AnimatePresence mode="wait">
        <motion.span
          key={ROTATING_WORDS[index]}
          className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 absolute left-0"
          initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -30, filter: 'blur(8px)' }}
          transition={{ duration: 0.4, ease }}
        >
          {ROTATING_WORDS[index]}
        </motion.span>
      </AnimatePresence>
      <span className="invisible">{ROTATING_WORDS[index]}</span>
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════
// INFINITE SCROLLING TICKER — goal examples
// ═════════════════════════════════════════════════════════════════════

const TICKER_ITEMS = [
  { emoji: '🚀', text: 'Build a SaaS MVP', sessions: 52 },
  { emoji: '🐍', text: 'Learn Python', sessions: 28 },
  { emoji: '📝', text: 'Write a research paper', sessions: 44 },
  { emoji: '🎸', text: 'Learn guitar basics', sessions: 36 },
  { emoji: '💪', text: 'Run a half marathon', sessions: 48 },
  { emoji: '🎨', text: 'Design a portfolio', sessions: 20 },
  { emoji: '📚', text: 'Read 12 books', sessions: 60 },
  { emoji: '🧠', text: 'Master system design', sessions: 80 },
  { emoji: '📱', text: 'Ship a mobile app', sessions: 65 },
  { emoji: '✍️', text: 'Start a blog', sessions: 30 },
];

function InfiniteTickerRow({ direction = 'left', speed = 30 }: { direction?: 'left' | 'right'; speed?: number }) {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS]; // duplicate for seamless loop

  return (
    <div className="overflow-hidden relative">
      <motion.div
        className="flex gap-3 w-max"
        animate={{ x: direction === 'left' ? [0, -50 * TICKER_ITEMS.length] : [-50 * TICKER_ITEMS.length, 0] }}
        transition={{ duration: speed, repeat: Infinity, ease: 'linear' }}
      >
        {items.map((item, i) => (
          <div
            key={`${item.text}-${i}`}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] whitespace-nowrap flex-shrink-0 hover:border-cyan-500/20 hover:bg-cyan-500/[0.03] transition-colors"
          >
            <span className="text-base">{item.emoji}</span>
            <span className="text-sm text-white/60 font-medium">{item.text}</span>
            <span className="text-xs text-cyan-400/50 font-mono">{item.sessions}s</span>
          </div>
        ))}
      </motion.div>
      {/* Fade edges */}
      <div className="absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-[#080b10] to-transparent pointer-events-none z-10" />
      <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-[#080b10] to-transparent pointer-events-none z-10" />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// INFINITE VERTICAL CARD COLUMN — hero side panel, drifts upward
// ═════════════════════════════════════════════════════════════════════

function HeroCardGoal() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">Current goal</span>
        <span className="flex items-center gap-1 text-[10px] text-cyan-400/70">
          <Flame size={10} /> 8 day streak
        </span>
      </div>
      <p className="text-sm text-white font-medium leading-snug mb-3">Learn Python for data science</p>
      <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden mb-2">
        <div className="h-full w-[32%] rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-white/30">
        <span>31 / 96 sessions</span>
        <span>~ 16 days left</span>
      </div>
    </div>
  );
}

function HeroCardPomodoro() {
  return (
    <div className="rounded-2xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/[0.06] to-blue-500/[0.04] p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-cyan-400/80">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /> Focus
        </span>
        <Timer size={12} className="text-white/30" />
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-3xl font-mono font-light text-white tabular-nums">14:23</span>
        <span className="text-[10px] text-white/30">of 25:00</span>
      </div>
      <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
        <div className="h-full w-[42%] rounded-full bg-gradient-to-r from-cyan-400 to-blue-400" />
      </div>
      <p className="mt-3 text-[11px] text-white/40 truncate">Writing release notes · pom 2 of 3</p>
    </div>
  );
}

function HeroCardWhatsApp() {
  return (
    <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-3.5 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-[9px] font-bold text-white">EO</div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-white">EffortOS Coach</p>
          <p className="text-[9px] text-emerald-400/70">on WhatsApp · just now</p>
        </div>
        <MessageCircle size={12} className="text-emerald-400/50" />
      </div>
      <div className="rounded-lg rounded-tl-sm bg-emerald-900/30 border border-emerald-500/10 p-2.5">
        <p className="text-[11px] text-white/85 leading-snug whitespace-pre-line">📝 Added 3 tasks for today
  ✅ Study Python — 2 poms
  ✅ Review PRs — 1 pom
  ✅ Release notes — 3 poms

⏱ Total: 6 pomodoros 💪</p>
      </div>
    </div>
  );
}

function HeroCardPlan() {
  const tasks = [
    { done: true, label: 'Study Python', poms: '2/2' },
    { done: false, label: 'Review PRs', poms: '0/1' },
    { done: false, label: 'Release notes', poms: '0/3' },
  ];
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">Daily Grind · Today</span>
        <span className="text-[10px] font-mono text-white/30">2 / 6 poms</span>
      </div>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <li key={t.label} className="flex items-center gap-2.5">
            <span className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center ${t.done ? 'bg-cyan-400/80 border-cyan-400/80' : 'border-white/15'}`}>
              {t.done && <CheckCircle2 size={10} className="text-[#080b10]" strokeWidth={3} />}
            </span>
            <span className={`flex-1 text-[12px] truncate ${t.done ? 'text-white/30 line-through' : 'text-white/70'}`}>{t.label}</span>
            <span className="text-[10px] font-mono text-white/25">{t.poms}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeroCardInsight() {
  return (
    <div className="rounded-2xl border border-purple-500/15 bg-gradient-to-br from-purple-500/[0.05] to-cyan-500/[0.03] p-4 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <Brain size={12} className="text-purple-300/70" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-purple-300/70">AI Insight</span>
      </div>
      <p className="text-[12px] text-white/75 leading-snug">
        You complete <span className="text-cyan-300">40% more tasks</span> when you start before 10am.
        Best day this week: <span className="text-cyan-300">Wednesday</span>.
      </p>
      <p className="mt-2 text-[9px] text-white/25">Based on your last 30 days · auto-refreshes</p>
    </div>
  );
}

function HeroCardWeek() {
  const bars = [3, 5, 2, 7, 4, 6, 8];
  const max = Math.max(...bars);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/30">This week</span>
        <span className="flex items-center gap-1 text-[10px] text-emerald-400/80">
          <TrendingUp size={10} /> +18%
        </span>
      </div>
      <div className="flex items-end gap-1.5 h-12 mb-2">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-cyan-500/40 to-cyan-300/20" style={{ height: `${(b / max) * 100}%` }} />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-white/25 font-mono">
        <span>14h 30m focused</span><span>35 sessions</span>
      </div>
    </div>
  );
}

const HERO_CARDS: React.FC[] = [
  HeroCardPomodoro,
  HeroCardWhatsApp,
  HeroCardGoal,
  HeroCardPlan,
  HeroCardInsight,
  HeroCardWeek,
];

function InfiniteCardColumn({ speed = 38 }: { speed?: number }) {
  // Duplicate the cards so the loop is seamless: when we've translated by
  // exactly half the column's height, the second copy has scrolled into the
  // first copy's position — visually identical.
  const items = [...HERO_CARDS, ...HERO_CARDS];

  return (
    <div className="relative h-[640px] w-full max-w-[400px] overflow-hidden">
      <motion.div
        className="flex flex-col gap-3"
        animate={{ y: ['0%', '-50%'] }}
        transition={{ duration: speed, repeat: Infinity, ease: 'linear' }}
      >
        {items.map((Card, i) => (
          <Card key={i} />
        ))}
      </motion.div>
      {/* Fade edges top + bottom */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#080b10] to-transparent pointer-events-none z-10" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#080b10] to-transparent pointer-events-none z-10" />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// AUTO-PLAYING TIMER DEMO — sped up to show the flow
// ═════════════════════════════════════════════════════════════════════

function TimerDemo() {
  const [seconds, setSeconds] = useState(1500);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'focus' | 'break'>('focus');

  // Auto-start after a short delay for visual effect
  useEffect(() => {
    const timeout = setTimeout(() => setRunning(true), 2000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!running) return;
    // Speed up: tick 10x per second visually
    const timer = setInterval(() => {
      setSeconds((s) => {
        if (s <= 0) {
          setRunning(false);
          if (mode === 'focus') {
            setMode('break');
            return 300;
          } else {
            setMode('focus');
            return 1500;
          }
        }
        return s - 10; // fast tick for demo
      });
    }, 100);
    return () => clearInterval(timer);
  }, [running, mode]);

  const mins = Math.floor(Math.max(0, seconds) / 60);
  const secs = Math.max(0, seconds) % 60;
  const total = mode === 'focus' ? 1500 : 300;
  const progress = (total - Math.max(0, seconds)) / total;
  const circumference = 2 * Math.PI * 54;

  return (
    <div className="relative flex flex-col items-center">
      {/* Ambient glow behind timer */}
      <motion.div
        className="absolute w-48 h-48 rounded-full blur-3xl pointer-events-none"
        animate={{
          background: mode === 'focus'
            ? 'radial-gradient(circle, rgba(34,211,238,0.08) 0%, transparent 70%)'
            : 'radial-gradient(circle, rgba(52,211,153,0.08) 0%, transparent 70%)',
        }}
        transition={{ duration: 1 }}
      />

      {/* Mode label */}
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        className={`text-[10px] uppercase tracking-[0.2em] font-semibold mb-4 ${
          mode === 'focus' ? 'text-cyan-400/70' : 'text-emerald-400/70'
        }`}
      >
        {mode === 'focus' ? 'Focus Session' : 'Break Time'}
      </motion.div>

      {/* Circular timer */}
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
          <motion.circle
            cx="60" cy="60" r="54" fill="none"
            stroke={mode === 'focus' ? '#22d3ee' : '#34d399'}
            strokeWidth="4" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            style={{ filter: `drop-shadow(0 0 8px ${mode === 'focus' ? 'rgba(34,211,238,0.4)' : 'rgba(52,211,153,0.4)'})` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-mono font-bold text-white tracking-wider">
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </span>
          <span className="text-[10px] text-white/30 mt-1">of {mode === 'focus' ? '25:00' : '05:00'}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mt-5">
        <button
          onClick={() => { setSeconds(mode === 'focus' ? 1500 : 300); setRunning(false); }}
          className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-white/40 hover:text-white/70 hover:border-white/20 transition-all"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={() => setRunning(!running)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg ${
            running
              ? 'bg-white/10 text-white hover:bg-white/15 shadow-white/5'
              : 'bg-gradient-to-br from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400 shadow-cyan-500/25'
          }`}
        >
          {running ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>
        <button
          onClick={() => {
            setMode(mode === 'focus' ? 'break' : 'focus');
            setSeconds(mode === 'focus' ? 300 : 1500);
            setRunning(false);
          }}
          className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-white/40 hover:text-white/70 hover:border-white/20 transition-all"
        >
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// AUTO-CYCLING DAILY GRIND — tasks complete themselves
// ═════════════════════════════════════════════════════════════════════

const ALL_TASKS = [
  [
    { title: 'Review pull requests', poms: 2, done: 2, complete: true, tag: 'job' },
    { title: 'Study system design', poms: 3, done: 1, complete: false, tag: 'learning' },
    { title: 'Write blog post draft', poms: 2, done: 0, complete: false, tag: 'creative' },
    { title: 'Morning run', poms: 1, done: 1, complete: true, tag: 'health' },
  ],
  [
    { title: 'Ship landing page v2', poms: 3, done: 3, complete: true, tag: 'startup' },
    { title: 'Practice guitar scales', poms: 1, done: 1, complete: true, tag: 'creative' },
    { title: 'Read research paper', poms: 2, done: 1, complete: false, tag: 'learning' },
    { title: 'Team standup notes', poms: 1, done: 0, complete: false, tag: 'job' },
  ],
  [
    { title: 'Refactor auth module', poms: 3, done: 2, complete: false, tag: 'startup' },
    { title: 'HIIT workout', poms: 1, done: 1, complete: true, tag: 'health' },
    { title: 'Write newsletter', poms: 2, done: 2, complete: true, tag: 'creative' },
    { title: 'Study AWS certs', poms: 2, done: 0, complete: false, tag: 'learning' },
  ],
];

function DailyGrindPreview() {
  const [setIndex, setSetIndex] = useState(0);
  const tasks = ALL_TASKS[setIndex];
  const done = tasks.filter((t) => t.complete).length;

  useEffect(() => {
    const timer = setInterval(() => {
      setSetIndex((i) => (i + 1) % ALL_TASKS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const tagColors: Record<string, string> = {
    job: 'bg-blue-500/15 text-blue-400/80',
    learning: 'bg-purple-500/15 text-purple-400/80',
    creative: 'bg-amber-500/15 text-amber-400/80',
    health: 'bg-emerald-500/15 text-emerald-400/80',
    startup: 'bg-rose-500/15 text-rose-400/80',
  };

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 max-w-sm mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ListChecks size={16} className="text-cyan-400/60" />
          <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">Daily Grind</span>
        </div>
        <motion.span key={done} initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-xs text-white/30">
          {done}/{tasks.length} done
        </motion.span>
      </div>
      <div className="space-y-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={setIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4, ease }}
            className="space-y-2"
          >
            {tasks.map((task, i) => (
              <motion.div
                key={task.title}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
                  task.complete
                    ? 'border-white/[0.04] bg-white/[0.01]'
                    : 'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    task.complete ? 'border-cyan-500/60 bg-cyan-500/20' : 'border-white/20'
                  }`}
                >
                  {task.complete && <CheckCircle2 size={10} className="text-cyan-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${task.complete ? 'text-white/30 line-through' : 'text-white/70'}`}>
                    {task.title}
                  </p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tagColors[task.tag]}`}>{task.tag}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: task.poms }).map((_, j) => (
                    <motion.div
                      key={j}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: i * 0.08 + j * 0.05 + 0.2 }}
                      className={`w-1.5 h-1.5 rounded-full ${j < task.done ? 'bg-cyan-400/60' : 'bg-white/10'}`}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
      {/* Pagination dots */}
      <div className="flex justify-center gap-1.5 mt-4">
        {ALL_TASKS.map((_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === setIndex ? 'bg-cyan-400/60 w-4' : 'bg-white/10'}`} />
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// AI ESTIMATION — animated reveal with pulsing analysis
// ═════════════════════════════════════════════════════════════════════

function GoalEstimationPreview() {
  const [stage, setStage] = useState(0);
  const [goalIndex, setGoalIndex] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: '-100px' });

  const goals = [
    { name: 'Build a SaaS MVP', type: 'Software project', sessions: 52, timeline: '~3 weeks at 3 sessions/day' },
    { name: 'Learn conversational Spanish', type: 'Language learning', sessions: 90, timeline: '~6 weeks at 2 sessions/day' },
    { name: 'Write a novel first draft', type: 'Creative writing', sessions: 120, timeline: '~8 weeks at 2 sessions/day' },
  ];

  const goal = goals[goalIndex];

  useEffect(() => {
    if (!isInView) return;
    // Reset stage before advancing through the cycle. This is a legitimate
    // animation reset — scrolling out mid-cycle can leave `stage` stuck on
    // 1 or 2, and we need it at 0 before the 800ms timer fires. The
    // "cascading render" this creates is the whole point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStage(0);
    const timers = [
      setTimeout(() => setStage(1), 800),
      setTimeout(() => setStage(2), 1600),
      setTimeout(() => setStage(3), 2400),
      setTimeout(() => {
        setStage(0);
        setGoalIndex((i) => (i + 1) % goals.length);
      }, 5500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isInView, goalIndex, goals.length]);

  return (
    <div ref={ref} className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 max-w-sm mx-auto relative overflow-hidden">
      {/* Scanning line effect */}
      {stage > 0 && stage < 3 && (
        <motion.div
          className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent"
          initial={{ top: '20%' }}
          animate={{ top: '90%' }}
          transition={{ duration: 2, ease: 'linear' }}
        />
      )}

      <div className="flex items-center gap-2 mb-4">
        <motion.div animate={{ rotate: stage > 0 && stage < 3 ? 360 : 0 }} transition={{ duration: 2, ease: 'linear' }}>
          <Brain size={16} className="text-cyan-400/60" />
        </motion.div>
        <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">AI Estimation</span>
        {stage > 0 && stage < 3 && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }} className="text-[10px] text-cyan-400/60 ml-auto">
            Analyzing...
          </motion.span>
        )}
      </div>

      {/* Goal input */}
      <AnimatePresence mode="wait">
        <motion.div key={goalIndex} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="mb-4 p-3 rounded-lg border border-white/[0.08] bg-white/[0.02]">
          <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Goal</p>
          <p className="text-sm text-white/80 font-medium">{goal.name}</p>
        </motion.div>
      </AnimatePresence>

      {/* Analysis steps */}
      <div className="space-y-2.5">
        {[
          { label: 'Analyzing complexity', value: `${goal.type} detected` },
          { label: 'Estimating sessions', value: `~${goal.sessions} Pomodoro sessions` },
          { label: 'Projected timeline', value: goal.timeline },
        ].map((step, i) => (
          <motion.div
            key={`${goalIndex}-${step.label}`}
            initial={{ opacity: 0, height: 0 }}
            animate={stage > i ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between p-2 rounded-lg bg-cyan-500/[0.04] border border-cyan-500/[0.08]">
              <span className="text-[11px] text-white/50">{step.label}</span>
              <motion.span initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="text-[11px] text-cyan-400/80 font-medium">
                {step.value}
              </motion.span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Progress bar */}
      <AnimatePresence>
        {stage >= 3 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.2 }} className="mt-4">
            <div className="flex justify-between text-[10px] text-white/30 mb-1.5">
              <span>Ready to start</span>
              <span>0 / {goal.sessions} sessions</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                initial={{ width: 0 }}
                animate={{ width: '6%' }}
                transition={{ delay: 0.4, duration: 1, ease }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// FEATURE CARDS with animated icon on hover
// ═════════════════════════════════════════════════════════════════════

function FeatureCard({
  icon: Icon,
  title,
  description,
  gradient,
  delay = 0,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  gradient: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-40px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease, delay }}
      whileHover={{ y: -6, scale: 1.02 }}
      className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 overflow-hidden cursor-default"
    >
      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${gradient}`} />
      <div className="relative z-10">
        <motion.div
          className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4"
          whileHover={{ rotate: 10, scale: 1.1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 15 }}
        >
          <Icon size={20} className="text-cyan-400/80" />
        </motion.div>
        <h3 className="text-sm font-semibold text-white/90 mb-2">{title}</h3>
        <p className="text-sm text-white/40 leading-relaxed">{description}</p>
      </div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// HOW IT WORKS — animated step connector
// ═════════════════════════════════════════════════════════════════════

function Step({
  number, title, description, icon: Icon, delay = 0, isLast = false,
}: {
  number: number; title: string; description: string; icon: React.ElementType; delay?: number; isLast?: boolean;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-40px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -20 }}
      animate={isInView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.6, ease, delay }}
      className="flex gap-4"
    >
      <div className="flex flex-col items-center">
        <motion.div
          className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 flex items-center justify-center text-sm font-bold text-cyan-400 flex-shrink-0"
          whileInView={{ scale: [0.8, 1.1, 1] }}
          viewport={{ once: true }}
          transition={{ delay: delay + 0.2, duration: 0.5 }}
        >
          {number}
        </motion.div>
        {!isLast && (
          <motion.div
            className="w-px flex-1 mt-2"
            initial={{ background: 'transparent' }}
            whileInView={{ background: 'linear-gradient(to bottom, rgba(34,211,238,0.2), transparent)' }}
            viewport={{ once: true }}
            transition={{ delay: delay + 0.4, duration: 0.6 }}
          />
        )}
      </div>
      <div className="pb-8">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={16} className="text-cyan-400/60" />
          <h3 className="text-sm font-semibold text-white/90">{title}</h3>
        </div>
        <p className="text-sm text-white/40 leading-relaxed">{description}</p>
      </div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// SCROLLING FEATURE PILLS — horizontal auto-scroll
// ═════════════════════════════════════════════════════════════════════

const FEATURE_PILLS = [
  '25-min Focus Sessions', 'AI Goal Estimation', 'Daily Task Planner', 'WhatsApp Bot',
  'Session Debrief', 'Streak Calendar', 'Weekly Insights', 'Smart Email Nudges',
  'Repeating Templates', 'Picture-in-Picture', 'Cross-Device Sync', '8 Custom Themes',
  'Admin Dashboard', 'Milestone Tracking', 'Pomodoro Counter', 'Effort Recalibration',
];

function ScrollingPills() {
  const pills = [...FEATURE_PILLS, ...FEATURE_PILLS];

  return (
    <div className="overflow-hidden relative py-4">
      <motion.div
        className="flex gap-2 w-max"
        animate={{ x: [0, -24 * FEATURE_PILLS.length] }}
        transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
      >
        {pills.map((pill, i) => (
          <span
            key={`${pill}-${i}`}
            className="px-3 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] text-[11px] text-white/40 whitespace-nowrap flex-shrink-0"
          >
            {pill}
          </span>
        ))}
      </motion.div>
      <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-[#080b10] to-transparent pointer-events-none z-10" />
      <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-[#080b10] to-transparent pointer-events-none z-10" />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// LEGAL MENU
// ═════════════════════════════════════════════════════════════════════

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pages = [
    { href: '/legal/terms', label: 'Terms & Conditions' },
    { href: '/legal/privacy', label: 'Privacy Policy' },
    { href: '/legal/refund', label: 'Cancellation & Refund' },
    { href: '/legal/shipping', label: 'Shipping & Exchange' },
    { href: '/legal/contact', label: 'Contact Us' },
  ];

  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-[11px] text-white/25 hover:text-white/50 transition-colors" aria-expanded={open}>
        Legal <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 min-w-[190px] rounded-lg border border-white/[0.08] bg-[#0d1117] shadow-lg py-1 z-20">
          {pages.map((p) => (
            <Link key={p.href} href={p.href} className="block px-3 py-1.5 text-[11px] text-white/50 hover:text-white hover:bg-white/[0.04] text-left" onClick={() => setOpen(false)}>
              {p.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// MAIN LANDING PAGE
// ═════════════════════════════════════════════════════════════════════

export function LandingPage() {
  const setView = useStore((s) => s.setView);
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 100, damping: 30 });

  return (
    <div className="flex flex-col bg-[#080b10] min-h-screen overflow-hidden">
      {/* Progress bar at top */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-500 to-blue-500 z-[60] origin-left"
        style={{ scaleX: smoothProgress }}
      />

      {/* ── Navbar ──────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#080b10]/80 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 h-14">
          <motion.div
            className="flex items-center gap-2.5"
            whileHover={{ scale: 1.02 }}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-white tracking-tight">EffortOS</span>
          </motion.div>
          <div className="flex items-center gap-3">
            <button onClick={() => setView('auth')} className="text-sm text-white/50 hover:text-white transition-colors">
              Sign in
            </button>
            <Button variant="glow" size="sm" onClick={() => setView('auth')} className="gap-1.5">
              Get Started <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <header className="relative pt-28 pb-8 sm:pt-36 sm:pb-12 px-4 min-h-[90vh] flex flex-col justify-center">
        {/* Particle constellation background */}
        <ParticleField />

        {/* Morphing gradient blobs */}
        <MorphingBlob className="w-[600px] h-[600px] -top-40 -left-40 opacity-30" style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.08) 0%, transparent 70%)' } as React.CSSProperties} />
        <MorphingBlob className="w-[500px] h-[500px] top-20 -right-40 opacity-20" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)' } as React.CSSProperties} />

        <div className="max-w-6xl mx-auto w-full relative z-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:gap-12 lg:items-center">
          {/* ── LEFT: copy (centered ≤ md, left-aligned ≥ lg) ── */}
          <div className="text-center lg:text-left max-w-xl mx-auto lg:mx-0 lg:max-w-none">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, ease }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/[0.06] mb-8"
            >
              <motion.div animate={{ rotate: [0, 360] }} transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}>
                <Sparkles size={12} className="text-cyan-400" />
              </motion.div>
              <span className="text-[11px] text-cyan-400/90 font-medium tracking-wide">The quiet OS for the work that matters</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.8, ease }}
              className="text-4xl sm:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.08] mb-6"
            >
              <span className="text-white/50">Finish</span>
              <br />
              <RotatingWord />
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.7, ease }}
              className="text-base sm:text-lg text-white/40 mb-10 max-w-xl mx-auto lg:mx-0 leading-relaxed"
            >
              In a world engineered to fragment your attention, EffortOS is the quiet operating
              system that holds the line. Tell it your goal — it estimates the work, paces your
              sessions, and recalibrates as you go. So the world doesn&apos;t get to decide what
              you ship.
            </motion.p>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.6, ease }}
              className="flex flex-col items-center lg:items-start gap-3"
            >
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <Button
                  variant="glow"
                  size="lg"
                  onClick={() => useStore.getState().startQuickPomodoro()}
                  className="gap-2 px-8 h-13 text-base"
                >
                  <Play className="w-5 h-5 fill-current" />
                  Try a quick pomodoro
                </Button>
                <Button variant="outline" size="lg" onClick={() => setView('auth')} className="gap-2 px-6 h-13 text-base">
                  Sign up free <ArrowRight className="w-5 h-5" />
                </Button>
              </div>
              <p className="text-[11px] text-white/20 mt-1">No signup. No noise. Just twenty-five quiet minutes.</p>
            </motion.div>

            {/* Trust badges */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 mt-10"
            >
              {[
                { icon: Shield, text: '3 days free, no card needed' },
                { icon: Clock, text: 'Cancel anytime' },
                { icon: Zap, text: 'No notifications by default' },
              ].map(({ icon: I, text }) => (
                <span key={text} className="flex items-center gap-1.5 text-xs text-white/25">
                  <I size={12} /> {text}
                </span>
              ))}
            </motion.div>
          </div>

          {/* ── RIGHT: vertical card stack (lg+ only) ── */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, duration: 0.8, ease }}
            className="hidden lg:flex justify-center"
            aria-hidden="true"
          >
            <InfiniteCardColumn />
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          className="absolute bottom-6 left-1/2 -translate-x-1/2"
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown size={20} className="text-white/15" />
        </motion.div>
      </header>

      {/* ── Scrolling goal ticker ──────────────────────────────── */}
      <div className="py-6 sm:py-8">
        <p className="text-center text-[10px] text-white/20 uppercase tracking-[0.2em] mb-4">
          What people are quietly working toward
        </p>
        <InfiniteTickerRow direction="left" speed={35} />
        <div className="mt-3">
          <InfiniteTickerRow direction="right" speed={40} />
        </div>
      </div>

      {/* ── Timer + Daily Grind ────────────────────────────────── */}
      <Section className="py-16 sm:py-24 px-4" delay={0.1}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[11px] text-cyan-400/60 uppercase tracking-[0.2em] font-semibold mb-3">Try it yourself</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">A timer that knows what you&apos;re working on.</h2>
            <p className="text-sm text-white/35 max-w-md mx-auto">
              Pick the three things that matter today. Hit start. EffortOS quietly logs every
              focused session against the work you set out to do. No leaderboards. No streak guilt.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <TimerDemo />
            <DailyGrindPreview />
          </div>
        </div>
      </Section>

      {/* ── AI Estimation ──────────────────────────────────────── */}
      <Section className="py-16 sm:py-24 px-4 relative" delay={0.1}>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/[0.02] to-transparent pointer-events-none" />
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-[11px] text-cyan-400/60 uppercase tracking-[0.2em] font-semibold mb-3">Effort, calibrated</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">Know how long things actually take.</h2>
              <p className="text-sm text-white/40 leading-relaxed mb-6">
                Tell EffortOS what you&apos;re trying to finish. It estimates the work in focused
                sessions, then quietly recalibrates as you go. Your timeline learns from your
                real life — late meetings, bad days, breakthroughs, all of it. No guesswork.
                No fake confidence.
              </p>
              <div className="space-y-3">
                {[
                  'Sizes up your goal in seconds',
                  'Adapts to your real pace and consistency',
                  'Recalibrates after every session',
                  'Marks milestones so you always know where you are',
                ].map((item, i) => (
                  <motion.div
                    key={item}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-start gap-2.5"
                  >
                    <CheckCircle2 size={16} className="text-cyan-400/60 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-white/50">{item}</span>
                  </motion.div>
                ))}
              </div>
            </div>
            <GoalEstimationPreview />
          </div>
        </div>
      </Section>

      {/* ── Scrolling feature pills ────────────────────────────── */}
      <div id="features">
        <ScrollingPills />
      </div>

      {/* ── Features Grid ──────────────────────────────────────── */}
      <Section className="py-16 sm:py-24 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[11px] text-cyan-400/60 uppercase tracking-[0.2em] font-semibold mb-3">Quiet by default</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">The features are quiet. The progress isn&apos;t.</h2>
            <p className="text-sm text-white/35 max-w-md mx-auto">
              Every feature here exists to protect your attention and make your hours add up.
              Nothing in this product is asking for more of you.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard icon={Timer} title="Pomodoro Timer" description="Twenty-five quiet minutes at a time. Smart breaks. Picture-in-picture so the timer stays in view, not in the way." gradient="bg-gradient-to-br from-cyan-500/[0.05] to-transparent" delay={0} />
            <FeatureCard icon={Brain} title="AI Effort Estimation" description="Tell EffortOS what you&apos;re trying to finish. It estimates the work, then sharpens its guess every time you finish a session." gradient="bg-gradient-to-br from-purple-500/[0.05] to-transparent" delay={0.1} />
            <FeatureCard icon={ListChecks} title="Daily Grind Planner" description="Pick three priorities for today. Tag what they&apos;re for. Hit start. EffortOS keeps the rest of the noise out." gradient="bg-gradient-to-br from-emerald-500/[0.05] to-transparent" delay={0.2} />
            <FeatureCard icon={Bot} title="AI Coach" description="Honest reflections after each session. Weekly recaps that read like a coach who actually pays attention." gradient="bg-gradient-to-br from-amber-500/[0.05] to-transparent" delay={0.1} />
            <FeatureCard icon={MessageCircle} title="Messaging Bot" description="Add tasks, check progress, log wins from WhatsApp. Useful when you don&apos;t want to open another app." gradient="bg-gradient-to-br from-green-500/[0.05] to-transparent" delay={0.2} />
            <FeatureCard icon={BarChart3} title="Reports & Streaks" description="See where your hours actually went. A streak calendar that respects bad weeks instead of punishing them." gradient="bg-gradient-to-br from-blue-500/[0.05] to-transparent" delay={0.3} />
            <FeatureCard icon={Mail} title="Quiet Email Nudges" description="Three short emails a day, on your timezone. Easy to silence. Honest about your week." gradient="bg-gradient-to-br from-rose-500/[0.05] to-transparent" delay={0.2} />
            <FeatureCard icon={Calendar} title="Repeating Templates" description="Set your daily habits once. EffortOS rebuilds the day for you each morning, so consistency stops being a chore." gradient="bg-gradient-to-br from-indigo-500/[0.05] to-transparent" delay={0.3} />
            <FeatureCard icon={TrendingUp} title="Adaptive Recalibration" description="Rate the accuracy after each session. Watch the estimate stop lying to you over time." gradient="bg-gradient-to-br from-cyan-500/[0.05] to-transparent" delay={0.4} />
          </div>
        </div>
      </Section>

      {/* ── How It Works ───────────────────────────────────────── */}
      <Section className="py-16 sm:py-24 px-4 relative" delay={0.1}>
        <div id="how-it-works" className="absolute -top-20" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/[0.02] to-transparent pointer-events-none" />
        <div className="max-w-2xl mx-auto relative z-10">
          <div className="text-center mb-12">
            <p className="text-[11px] text-cyan-400/60 uppercase tracking-[0.2em] font-semibold mb-3">How it works</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Tell it the goal. Let it carry the math.</h2>
          </div>
          <div className="space-y-0">
            <Step number={1} icon={Target} title="Name what matters" description="Tell EffortOS what you&apos;re working toward — your novel, the bar exam, your MVP, the dissertation. Whatever&apos;s been on the list too long." delay={0} />
            <Step number={2} icon={Brain} title="Get an honest estimate" description="EffortOS sizes up the work, your skill level, and the rest of your life. You get a real number of focused sessions, not a fantasy." delay={0.1} />
            <Step number={3} icon={Zap} title="Work in quiet blocks" description="Twenty-five minutes at a time. Every session lands against the goal that matters. The world keeps moving; you keep going." delay={0.2} />
            <Step number={4} icon={TrendingUp} title="Watch it learn you" description="After every session the estimate gets sharper. Your timeline learns from your actual pace — not who you said you&apos;d be." delay={0.3} isLast />
          </div>
        </div>
      </Section>

      {/* ── Stats ──────────────────────────────────────────────── */}
      <Section className="py-16 sm:py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
            {[
              { value: 25, suffix: 'min', label: 'Per quiet session', icon: Timer },
              { value: 52, suffix: '+', label: 'Goals you can finish here', icon: Target },
              { value: 3, suffix: '', label: 'Days free, no card', icon: Mail },
              { value: 0, suffix: '', label: 'Push notifications by default', icon: Flame },
            ].map(({ value, suffix, label, icon: I }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5, ease }}
                className="text-center"
              >
                <motion.div whileInView={{ scale: [0.5, 1.1, 1] }} viewport={{ once: true }} transition={{ delay: i * 0.1 + 0.2 }}>
                  <I size={20} className="text-cyan-400/40 mx-auto mb-3" />
                </motion.div>
                <p className="text-3xl sm:text-4xl font-bold text-white mb-1">
                  <AnimatedNumber value={value} suffix={suffix} />
                </p>
                <p className="text-xs text-white/30">{label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── WhatsApp Wedge ─────────────────────────────────────── */}
      <Section className="py-16 sm:py-24 px-4 relative" delay={0.1}>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-500/[0.02] to-transparent pointer-events-none" />
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <p className="text-[11px] text-emerald-400/70 uppercase tracking-[0.2em] font-semibold mb-3">Lives where you already are</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                A coach in WhatsApp.<br />
                <span className="text-white/50">Not yet another app to open.</span>
              </h2>
              <p className="text-sm sm:text-base text-white/45 mb-6 leading-relaxed">
                Add tasks, log a session, plan tomorrow, ask for a nudge — all by texting EffortOS the way you&apos;d text a friend.
                Pro users get morning kickoffs, evening wrap-ups, and quiet streak-saver alerts when you&apos;re about to drop the chain.
              </p>
              <ul className="space-y-2.5 text-sm text-white/55">
                {[
                  'Drop a task in chat — it lands in tomorrow&apos;s plan',
                  'Reply &quot;done&quot; after a session, get an honest debrief',
                  'Type &quot;plan tomorrow&quot; — Claude builds your next day',
                  'Streak about to break? You get one heads-up, no spam',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <CheckCircle2 size={16} className="text-emerald-400/60 mt-0.5 flex-shrink-0" />
                    <span dangerouslySetInnerHTML={{ __html: line }} />
                  </li>
                ))}
              </ul>
            </div>

            {/* Phone-frame chat mockup */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, ease }}
              className="relative mx-auto w-full max-w-sm"
            >
              <div className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent p-4 shadow-2xl shadow-emerald-500/5">
                {/* WhatsApp-style header */}
                <div className="flex items-center gap-3 px-2 pb-3 border-b border-white/[0.06]">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                    <MessageCircle size={16} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white/90">EffortOS</p>
                    <p className="text-[10px] text-emerald-400/70">online</p>
                  </div>
                  <span className="text-[10px] text-white/25">9:14 AM</span>
                </div>

                {/* Chat bubbles */}
                <div className="space-y-2.5 pt-4 px-1">
                  {/* Bot bubble */}
                  <div className="flex">
                    <div className="rounded-2xl rounded-tl-sm bg-white/[0.06] px-3.5 py-2 max-w-[80%]">
                      <p className="text-[13px] text-white/80 leading-snug">Morning Aanya. You&rsquo;ve done 6 sessions on the CFA this week — 3 to go for your weekly target. Want me to slot 2 in this afternoon?</p>
                    </div>
                  </div>

                  {/* User bubble */}
                  <div className="flex justify-end">
                    <div className="rounded-2xl rounded-tr-sm bg-emerald-600/30 border border-emerald-500/20 px-3.5 py-2 max-w-[80%]">
                      <p className="text-[13px] text-white/85 leading-snug">yes, after lunch. and add &ldquo;ethics module 4&rdquo; to today</p>
                    </div>
                  </div>

                  {/* Bot bubble */}
                  <div className="flex">
                    <div className="rounded-2xl rounded-tl-sm bg-white/[0.06] px-3.5 py-2 max-w-[80%]">
                      <p className="text-[13px] text-white/80 leading-snug">Done. Two sessions at 2:30 and 4:00. Ethics Mod 4 is on today&rsquo;s grind. I&rsquo;ll ping you when the first block starts. ⏱</p>
                    </div>
                  </div>

                  {/* Typing indicator */}
                  <motion.div
                    className="flex"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <div className="rounded-2xl rounded-tl-sm bg-white/[0.04] px-3.5 py-2.5">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                        <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                        <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                      </div>
                    </div>
                  </motion.div>
                </div>

                <p className="text-[10px] text-white/20 text-center mt-4 pt-3 border-t border-white/[0.04]">Pro plan · WhatsApp Business API</p>
              </div>

              {/* Soft glow */}
              <div className="absolute -inset-4 bg-emerald-500/[0.04] rounded-[2rem] blur-3xl -z-10 pointer-events-none" />
            </motion.div>
          </div>
        </div>
      </Section>

      {/* ── Testimonials / Social Proof ─────────────────────────── */}
      <Section className="py-16 sm:py-24 px-4 relative">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[11px] text-cyan-400/60 uppercase tracking-[0.2em] font-semibold mb-3">Real users, real hours</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Built with the first 50 who tried it.</h2>
            <p className="text-sm text-white/35 max-w-md mx-auto">
              Early access feedback from students, founders, and aspirants who&apos;ve been logging sessions since beta.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                quote: 'I&rsquo;ve tried four Pomodoro apps. This is the first one where the timer talks to my actual goals. I&rsquo;m 38 sessions into my CFA L2 and the estimate has stopped lying to me.',
                name: 'Aanya',
                role: 'CFA L2 aspirant',
                city: 'Mumbai',
                accent: 'cyan',
              },
              {
                quote: 'The WhatsApp coach is the only reason I&rsquo;m on day 21 of a streak. It nudges me without being a nag. Shipped two MVP milestones in three weeks.',
                name: 'Rohan',
                role: 'Indie founder',
                city: 'Bangalore',
                accent: 'purple',
              },
              {
                quote: 'I stopped writing fake schedules in Notion. The recalibration after each session is brutal in the best way — my UPSC plan finally matches my actual pace.',
                name: 'Priya',
                role: 'UPSC aspirant',
                city: 'Delhi',
                accent: 'emerald',
              },
            ].map((t, i) => {
              const accentMap: Record<string, { dot: string; border: string; glow: string; text: string }> = {
                cyan: { dot: 'bg-cyan-400', border: 'border-cyan-500/20', glow: 'bg-cyan-500/[0.04]', text: 'text-cyan-400/70' },
                purple: { dot: 'bg-purple-400', border: 'border-purple-500/20', glow: 'bg-purple-500/[0.05]', text: 'text-purple-400/70' },
                emerald: { dot: 'bg-emerald-400', border: 'border-emerald-500/20', glow: 'bg-emerald-500/[0.04]', text: 'text-emerald-400/70' },
              };
              const a = accentMap[t.accent];
              return (
                <motion.figure
                  key={t.name}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ delay: i * 0.1, duration: 0.5, ease }}
                  className={`relative rounded-2xl border ${a.border} bg-gradient-to-b from-white/[0.03] to-transparent p-6 overflow-hidden`}
                >
                  <div className={`absolute -top-16 -right-16 w-32 h-32 ${a.glow} rounded-full blur-3xl pointer-events-none`} />
                  <div className="relative z-10">
                    <div className={`text-2xl ${a.text} leading-none mb-3`}>&ldquo;</div>
                    <blockquote
                      className="text-sm text-white/65 leading-relaxed mb-5"
                      dangerouslySetInnerHTML={{ __html: t.quote }}
                    />
                    <figcaption className="flex items-center gap-2.5 pt-4 border-t border-white/[0.05]">
                      <span className={`w-1.5 h-1.5 rounded-full ${a.dot}`} />
                      <div>
                        <p className="text-xs font-semibold text-white/80">{t.name}</p>
                        <p className="text-[11px] text-white/35">{t.role} · {t.city}</p>
                      </div>
                    </figcaption>
                  </div>
                </motion.figure>
              );
            })}
          </div>
          <p className="text-[11px] text-white/25 text-center mt-8">
            Quotes are from beta users. First names + cities; full attribution available on request.
          </p>
        </div>
      </Section>

      {/* ── Pricing ────────────────────────────────────────────── */}
      <Section className="py-16 sm:py-24 px-4">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">Two plans. Both quiet.</h2>
          <p className="text-sm text-white/40 max-w-md mx-auto">Three days free on either. Cancel anytime, no questions.</p>
        </div>
        <div className="max-w-3xl mx-auto grid sm:grid-cols-2 gap-4">
          {/* Starter */}
          <motion.div
            whileHover={{ y: -4 }}
            className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-6 sm:p-8 relative overflow-hidden"
          >
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-cyan-500/[0.06] rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10">
              <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2">Starter</div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold text-white">$5.99</span>
                <span className="text-sm text-white/30">/month</span>
              </div>
              <p className="text-[11px] text-white/30 mb-4">≈ ₹499 — billed in INR via Razorpay</p>
              <ul className="space-y-2.5 mb-6 text-sm text-white/50">
                {[
                  'AI goal estimation that learns your pace',
                  'Pomodoro focus timer with picture-in-picture',
                  'Daily Grind planner — three priorities, no clutter',
                  'Streak calendar that respects bad weeks',
                  'WhatsApp bot for tasks and check-ins',
                  'Three quiet email nudges a day',
                  'Journal and mood, just for you',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-cyan-400/60 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="lg" onClick={() => setView('auth')} className="w-full gap-2">
                Start Free Trial <ArrowRight size={14} />
              </Button>
            </div>
          </motion.div>

          {/* Pro */}
          <motion.div
            whileHover={{ y: -4 }}
            className="rounded-2xl border border-purple-500/30 bg-gradient-to-b from-purple-500/[0.06] to-transparent p-6 sm:p-8 relative overflow-hidden"
          >
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-purple-500/[0.1] rounded-full blur-3xl pointer-events-none" />
            <div className="absolute top-4 right-4 px-2 py-0.5 bg-purple-500 text-[10px] font-bold text-white rounded-full">
              AI COACH
            </div>
            <div className="relative z-10">
              <div className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">Pro</div>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold text-white">$11.99</span>
                <span className="text-sm text-white/30">/month</span>
              </div>
              <p className="text-[11px] text-white/30 mb-4">≈ ₹999 — billed in INR via Razorpay</p>
              <ul className="space-y-2.5 mb-6 text-sm text-white/50">
                {[
                  'Everything in Starter, plus:',
                  'A coach that checks in without asking for your day',
                  'Morning kickoff and evening wrap-up, on your time',
                  'Streak saver and gentle idle nudges',
                  'Weekly recap written by Claude, not a template',
                  '“Plan tomorrow” over WhatsApp in one message',
                  'Pick how loud the coaching is. Or how quiet.',
                ].map((f, i) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 size={14} className={`shrink-0 ${i === 0 ? 'text-cyan-400/60' : 'text-purple-400/70'}`} />
                    <span className={i === 0 ? 'text-white/40 text-xs' : ''}>{f}</span>
                  </li>
                ))}
              </ul>
              <Button variant="glow" size="lg" onClick={() => setView('auth')} className="w-full gap-2 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 border-purple-500/30">
                Start Free Trial <Sparkles size={14} />
              </Button>
            </div>
          </motion.div>
        </div>
        <p className="text-[11px] text-white/20 text-center mt-4">USD shown for reference. Subscriptions are billed in INR by Razorpay; international cards welcome — your bank handles FX.</p>
      </Section>

      {/* ── Final CTA ──────────────────────────────────────────── */}
      <Section className="py-20 sm:py-28 px-4 text-center relative">
        <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/[0.03] via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-2xl mx-auto">
          <motion.div
            className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-cyan-500/20"
            whileHover={{ rotate: 10, scale: 1.05 }}
            animate={{ boxShadow: ['0 0 30px rgba(34,211,238,0.15)', '0 0 60px rgba(34,211,238,0.25)', '0 0 30px rgba(34,211,238,0.15)'] }}
            transition={{ boxShadow: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }}
          >
            <Sparkles className="w-8 h-8 text-white" />
          </motion.div>
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-4">The world doesn&apos;t run your schedule. You do.</h2>
          <p className="text-sm sm:text-base text-white/35 mb-8 max-w-md mx-auto">
            Start with a quiet twenty-five minutes. Decide later if you want the rest.
          </p>
          <Button variant="glow" size="lg" onClick={() => setView('auth')} className="gap-2 px-8 h-13 text-base">
            Get Started Free <ArrowRight size={18} />
          </Button>
        </div>
      </Section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.04] py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs text-white/30">EffortOS — The quiet OS for the work that matters.</span>
          </div>
          <div className="flex items-center gap-4">
            <MoreMenu />
            <span className="text-[11px] text-white/15">Your data, encrypted, in sync, in your hands.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
