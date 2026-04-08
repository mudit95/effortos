'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Sparkles, Play, Calendar, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function WelcomeCard() {
  const [dismissed, setDismissed] = React.useState(false);
  const startTimer = useStore(s => s.startTimer);
  const setDashboardMode = useStore(s => s.setDashboardMode);
  const timerState = useStore(s => s.timerState);

  React.useEffect(() => {
    try {
      const seen = JSON.parse(localStorage.getItem('effortos_hints_seen') || '[]');
      if (seen.includes('welcome-card')) setDismissed(true);
    } catch {}
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      const seen = JSON.parse(localStorage.getItem('effortos_hints_seen') || '[]');
      if (!seen.includes('welcome-card')) {
        seen.push('welcome-card');
        localStorage.setItem('effortos_hints_seen', JSON.stringify(seen));
      }
    } catch {}
  };

  // Don't show if timer already running or if dismissed
  if (dismissed || timerState !== 'idle') return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="mb-4"
      >
        <div className="relative bg-gradient-to-br from-cyan-500/[0.08] to-blue-600/[0.06] border border-cyan-500/15 rounded-2xl p-5">
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 text-white/20 hover:text-white/50 transition-colors p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium text-white/80">Welcome to EffortOS!</span>
          </div>

          <p className="text-xs text-white/40 mb-4 leading-relaxed max-w-md">
            Your goal is set. Start a focus session to begin tracking your progress, or switch to Daily Grind to plan tasks for today.
          </p>

          <div className="flex items-center gap-3">
            <Button
              variant="glow"
              size="sm"
              onClick={() => { startTimer(); handleDismiss(); }}
              className="gap-1.5 text-xs"
            >
              <Play className="w-3 h-3 fill-current" />
              Start a Session
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDashboardMode('daily'); handleDismiss(); }}
              className="gap-1.5 text-xs text-white/50"
            >
              <Calendar className="w-3 h-3" />
              Try Daily Grind
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
