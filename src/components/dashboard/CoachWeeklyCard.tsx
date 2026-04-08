'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { BarChart3, TrendingUp, TrendingDown, Minus, X, Loader2, Sparkles } from 'lucide-react';

const momentumConfig = {
  rising: { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/10', label: 'Momentum rising' },
  steady: { icon: Minus, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Steady pace' },
  declining: { icon: TrendingDown, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Needs attention' },
};

export function CoachWeeklyCard() {
  const coachWeekly = useStore(s => s.coachWeekly);
  const coachWeeklyLoading = useStore(s => s.coachWeeklyLoading);
  const dismissCoachWeekly = useStore(s => s.dismissCoachWeekly);

  if (!coachWeekly && !coachWeeklyLoading) return null;

  const momentum = coachWeekly ? momentumConfig[coachWeekly.momentum] || momentumConfig.steady : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="bg-gradient-to-br from-amber-500/[0.06] to-orange-500/[0.04] border border-amber-500/10 rounded-2xl p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center">
              <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <span className="text-xs font-medium text-white/50">Weekly Insights</span>
          </div>
          {coachWeekly && (
            <button
              onClick={dismissCoachWeekly}
              className="text-white/20 hover:text-white/50 transition-colors p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {coachWeeklyLoading && (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span className="text-xs text-white/30">Crunching your week...</span>
          </div>
        )}

        {coachWeekly && momentum && (
          <>
            <p className="text-base font-semibold text-white/80 mb-1">{coachWeekly.headline}</p>
            <p className="text-sm text-white/50 leading-relaxed mb-3">{coachWeekly.body}</p>

            {/* Momentum badge */}
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-5 h-5 rounded-full ${momentum.bg} flex items-center justify-center`}>
                {React.createElement(momentum.icon, { className: `w-3 h-3 ${momentum.color}` })}
              </div>
              <span className={`text-xs font-medium ${momentum.color}`}>{momentum.label}</span>
            </div>

            {/* Suggestion */}
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-white/40 leading-relaxed">{coachWeekly.suggestion}</p>
            </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
