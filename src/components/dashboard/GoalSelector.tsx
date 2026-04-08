'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Target, Plus, Pause, Play, ChevronDown, ChevronUp } from 'lucide-react';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

export function GoalSelector() {
  const activeGoal = useStore(s => s.activeGoal);
  const goals = useStore(s => s.goals);
  const switchToGoal = useStore(s => s.switchToGoal);
  const pauseGoal = useStore(s => s.pauseGoal);

  const [expanded, setExpanded] = useState(false);

  const MAX_GOALS = 5;
  const allGoals = goals.filter(g => g.status === 'active' || g.status === 'paused');
  const canAddMore = allGoals.length < MAX_GOALS;

  // Don't render if only one goal
  if (allGoals.length <= 1) return null;

  const otherGoals = allGoals.filter(g => g.id !== activeGoal?.id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      className="mb-6"
    >
      {/* Collapsed: show a horizontal scrollable row of goal chips */}
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-[10px] text-white/25 uppercase tracking-widest flex-shrink-0">Goals</h3>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-white/20 hover:text-white/40 transition-colors p-1 rounded-md hover:bg-white/5"
          title={expanded ? 'Collapse goals' : 'Expand goals'}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Goal chips row — always visible */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {allGoals.map(goal => {
          const isActive = goal.id === activeGoal?.id;
          const pct = goal.estimated_sessions_current > 0
            ? Math.round((goal.sessions_completed / goal.estimated_sessions_current) * 100)
            : 0;

          return (
            <button
              key={goal.id}
              onClick={() => !isActive && switchToGoal(goal.id)}
              className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                isActive
                  ? 'bg-[var(--accent,#22d3ee)]/[0.06] border-[var(--accent,#22d3ee)]/20 text-white'
                  : 'border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.02] hover:border-white/10'
              }`}
            >
              {/* Mini progress ring */}
              <div className="relative w-6 h-6 flex-shrink-0">
                <svg width="24" height="24" viewBox="0 0 24 24" className="transform -rotate-90">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
                  <circle
                    cx="12" cy="12" r="9"
                    fill="none"
                    stroke={isActive ? 'var(--accent, #22d3ee)' : 'rgba(255,255,255,0.15)'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 9}
                    strokeDashoffset={2 * Math.PI * 9 * (1 - pct / 100)}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold">
                  {pct}
                </span>
              </div>

              <div className="text-left min-w-0">
                <p className="text-xs font-medium truncate max-w-[200px]" title={goal.title}>{goal.title}</p>
                <p className="text-[9px] text-white/25">
                  {goal.sessions_completed}/{goal.estimated_sessions_current}
                  {goal.status === 'paused' && (
                    <span className="ml-1 text-yellow-500/60">paused</span>
                  )}
                </p>
              </div>
            </button>
          );
        })}

        {/* New goal button */}
        {canAddMore ? (
          <button
            onClick={() => {
              useStore.setState({
                onboardingStep: 0,
                onboardingData: {},
                currentView: 'onboarding',
              });
            }}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-white/[0.08] text-white/20 hover:text-white/40 hover:border-white/15 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="text-xs">New</span>
          </button>
        ) : (
          <span className="flex-shrink-0 text-[10px] text-white/15 px-2">
            Max {MAX_GOALS} goals
          </span>
        )}
      </div>

      {/* Expanded detail view */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden mt-3"
          >
            <div className="space-y-2">
              {otherGoals.map(goal => {
                const pct = goal.estimated_sessions_current > 0
                  ? Math.round((goal.sessions_completed / goal.estimated_sessions_current) * 100)
                  : 0;

                return (
                  <div
                    key={goal.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.01]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/60 truncate">{goal.title}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <div className="flex-1 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-white/15"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-white/25 font-mono flex-shrink-0">{pct}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => switchToGoal(goal.id)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10 transition-all"
                      >
                        Switch
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
