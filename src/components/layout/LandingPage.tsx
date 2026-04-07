'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { Sparkles, ArrowRight, Zap, Brain, BarChart3, Target, Clock } from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

const EXAMPLE_GOALS = [
  { goal: 'Build a SaaS app', estimated: '48 sessions', actual: '52 sessions', time: '21.7h' },
  { goal: 'Learn Python basics', estimated: '32 sessions', actual: '28 sessions', time: '11.7h' },
  { goal: 'Write a research paper', estimated: '40 sessions', actual: '44 sessions', time: '18.3h' },
];

export function LandingPage() {
  const setView = useStore(s => s.setView);
  const loginAsDemo = useStore(s => s.loginAsDemo);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex items-center justify-center px-4 py-16 sm:py-20">
        <div className="max-w-2xl mx-auto text-center">
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease }}
            className="inline-flex items-center gap-3 mb-8"
          >
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-cyan-500/20">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6, ease }}
            className="text-4xl sm:text-6xl font-bold text-white tracking-tight leading-[1.1] mb-4"
          >
            Stop under<span className="text-cyan-400">estimating</span>
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

          {/* Features */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mt-16"
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
                transition={{ delay: 0.6 + i * 0.1, ease }}
                className="text-center"
              >
                <feature.icon className="w-5 h-5 text-cyan-500/60 mx-auto mb-2" />
                <p className="text-sm font-medium text-white/60">{feature.label}</p>
                <p className="text-xs text-white/30 mt-0.5">{feature.desc}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* Example goals */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.6, ease }}
            className="mt-16"
          >
            <p className="text-xs text-white/25 uppercase tracking-wider mb-4">Real examples</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {EXAMPLE_GOALS.map((ex, i) => (
                <div
                  key={i}
                  className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-left"
                >
                  <p className="text-sm font-medium text-white/70 mb-2">{ex.goal}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/30">Estimated: {ex.estimated}</span>
                    <span className="text-cyan-400/60">{ex.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-xs text-white/15">
          Built with intention. Your data syncs securely across devices.
        </p>
      </footer>
    </div>
  );
}
