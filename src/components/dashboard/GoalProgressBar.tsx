'use client';

import React from 'react';
import { motion } from 'framer-motion';
import type { Milestone } from '@/types';

interface GoalProgressBarProps {
  sessionsCompleted: number;
  sessionsTotal: number;
  milestones: Milestone[];
  onClick?: () => void;
  className?: string;
}

export function GoalProgressBar({
  sessionsCompleted,
  sessionsTotal,
  milestones,
  onClick,
  className = '',
}: GoalProgressBarProps) {
  const pct = sessionsTotal > 0 ? Math.min(100, (sessionsCompleted / sessionsTotal) * 100) : 0;

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left cursor-pointer transition-all ${className}`}
      aria-label="View detailed reports"
    >
      {/* Top labels */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-white/30">
          {sessionsCompleted} of {sessionsTotal} sessions
        </span>
        <span className="text-xs font-medium text-white/50">
          {Math.round(pct)}%
        </span>
      </div>

      {/* Bar container */}
      <div className="relative h-3 bg-white/[0.06] rounded-full overflow-visible group-hover:bg-white/[0.08] transition-colors">
        {/* Fill */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          style={{
            boxShadow: '0 0 12px rgba(34, 211, 238, 0.2)',
          }}
        />

        {/* Milestone markers */}
        {milestones.map((m) => {
          const markerPct = sessionsTotal > 0
            ? Math.min(100, (m.session_target / sessionsTotal) * 100)
            : 0;
          const isReached = sessionsCompleted >= m.session_target;

          return (
            <div
              key={m.id}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
              style={{ left: `${markerPct}%` }}
              title={`${m.title} (session ${m.session_target})`}
            >
              <div
                className={`w-3 h-3 rounded-full border-2 transition-colors ${
                  isReached
                    ? 'bg-green-400 border-green-400/50'
                    : 'bg-[#131820] border-white/20'
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* Hover hint */}
      <p className="text-[10px] text-white/0 group-hover:text-white/20 transition-colors mt-1.5 text-center">
        Tap to see detailed report
      </p>
    </button>
  );
}
