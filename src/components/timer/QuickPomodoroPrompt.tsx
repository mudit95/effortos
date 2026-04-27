'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { Sparkles, ArrowRight, X, CheckCircle2 } from 'lucide-react';

/**
 * Post-session prompt shown after a guest completes a quick pomodoro.
 * 
 * "Nice work — want to save your progress? Create a free account to
 *  track streaks, set goals, and pick up where you left off."
 */
export function QuickPomodoroPrompt() {
  const quickPomodoroComplete = useStore(s => s.quickPomodoroComplete);

  const handleSignUp = () => {
    // Reset guest state and go to auth
    useStore.setState({
      user: null,
      activeGoal: null,
      isAuthenticated: false,
      quickPomodoroComplete: false,
      currentView: 'auth',
    });
  };

  const handleDismiss = () => {
    // Go back to landing page
    useStore.setState({
      user: null,
      activeGoal: null,
      isAuthenticated: false,
      quickPomodoroComplete: false,
      currentView: 'landing',
    });
  };

  if (!quickPomodoroComplete) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-[#131820] border border-white/10 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl relative"
      >
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-white/20 hover:text-white/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 className="w-7 h-7 text-green-400" />
        </div>

        <h2 className="text-xl font-semibold text-white mb-2">
          Nice work!
        </h2>

        <p className="text-sm text-white/40 mb-6 leading-relaxed">
          You just completed a 25-minute focus session. Want to keep the momentum going?
          Create a free account to track streaks, set goals, and get AI-powered insights
          that help you stay consistent.
        </p>

        <div className="flex flex-col gap-3">
          <Button
            variant="glow"
            size="lg"
            onClick={handleSignUp}
            className="gap-2 w-full"
          >
            <Sparkles className="w-4 h-4" />
            Create free account
            <ArrowRight className="w-4 h-4" />
          </Button>

          <button
            onClick={handleDismiss}
            className="text-xs text-white/25 hover:text-white/50 transition-colors py-2"
          >
            Maybe later — back to homepage
          </button>
        </div>

        <p className="text-[10px] text-white/15 mt-5">
          3-day free trial &middot; No credit card required
        </p>
      </motion.div>
    </motion.div>
  );
}
