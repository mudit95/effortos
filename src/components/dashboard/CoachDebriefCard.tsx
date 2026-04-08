'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Brain, TrendingUp, AlertCircle, CheckCircle, X, Loader2 } from 'lucide-react';

const patternIcons = {
  positive: CheckCircle,
  neutral: TrendingUp,
  attention: AlertCircle,
};

const patternColors = {
  positive: 'text-green-400',
  neutral: 'text-blue-400',
  attention: 'text-yellow-400',
};

export function CoachDebriefCard() {
  const coachDebrief = useStore(s => s.coachDebrief);
  const coachDebriefLoading = useStore(s => s.coachDebriefLoading);
  const dismissCoachDebrief = useStore(s => s.dismissCoachDebrief);

  if (!coachDebrief && !coachDebriefLoading) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.04] border border-purple-500/10 rounded-2xl p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center">
              <Brain className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <span className="text-xs font-medium text-white/50">Session Debrief</span>
          </div>
          {coachDebrief && (
            <button
              onClick={dismissCoachDebrief}
              className="text-white/20 hover:text-white/50 transition-colors p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {coachDebriefLoading && (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin" />
            <span className="text-xs text-white/30">Analyzing session...</span>
          </div>
        )}

        {coachDebrief && (
          <>
            <p className="text-sm text-white/60 leading-relaxed">{coachDebrief.message}</p>
            {coachDebrief.pattern && (
              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-white/[0.05]">
                {React.createElement(
                  patternIcons[coachDebrief.patternType] || TrendingUp,
                  { className: `w-3.5 h-3.5 ${patternColors[coachDebrief.patternType] || 'text-blue-400'}` }
                )}
                <span className="text-xs text-white/30">{coachDebrief.pattern}</span>
              </div>
            )}
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
