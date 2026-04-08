'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import {
  X, Trophy, Pause, Play, Target, Clock, Trash2,
  Edit3, CheckCircle2, AlertCircle, Calendar, Flame,
  ChevronDown, ChevronUp, BarChart3,
} from 'lucide-react';
import { sessionsToHours, formatDate } from '@/lib/utils';
import * as storage from '@/lib/storage';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

function getStatusConfig(status: string) {
  switch (status) {
    case 'active':
      return { label: 'Active', color: '#22d3ee', bg: 'rgba(34,211,238,0.08)', icon: Play };
    case 'paused':
      return { label: 'Paused', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', icon: Pause };
    case 'completed':
      return { label: 'Completed', color: '#22c55e', bg: 'rgba(34,197,94,0.08)', icon: Trophy };
    default:
      return { label: status, color: '#888', bg: 'rgba(136,136,136,0.08)', icon: AlertCircle };
  }
}

function GoalCard({
  goal,
  isActiveGoal,
  onSwitch,
  onPause,
  onResume,
  onEdit,
  onDelete,
}: {
  goal: ReturnType<typeof storage.getGoals>[0];
  isActiveGoal: boolean;
  onSwitch: () => void;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusConfig = getStatusConfig(goal.status);
  const StatusIcon = statusConfig.icon;
  const pct = goal.estimated_sessions_current > 0
    ? Math.min(100, Math.round((goal.sessions_completed / goal.estimated_sessions_current) * 100))
    : 0;
  const hoursInvested = sessionsToHours(goal.sessions_completed);
  const startedDate = formatDate(goal.created_at);
  const daysElapsed = Math.max(1, Math.floor((Date.now() - new Date(goal.created_at).getTime()) / (1000 * 60 * 60 * 24)));

  // Calculate milestones progress
  const milestonesCompleted = goal.milestones.filter(m => m.completed).length;
  const milestonesTotal = goal.milestones.length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border overflow-hidden transition-colors ${
        isActiveGoal
          ? 'border-[var(--accent,#22d3ee)]/20 bg-[var(--accent,#22d3ee)]/[0.03]'
          : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.03]'
      }`}
    >
      {/* Main row */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Progress ring */}
          <div className="relative w-12 h-12 flex-shrink-0">
            <svg width="48" height="48" viewBox="0 0 48 48" className="transform -rotate-90">
              <circle cx="24" cy="24" r="19" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3" />
              <circle
                cx="24" cy="24" r="19"
                fill="none"
                stroke={statusConfig.color}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 19}
                strokeDashoffset={2 * Math.PI * 19 * (1 - pct / 100)}
                className="transition-all duration-500"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/70">
              {pct}%
            </span>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-semibold text-white truncate">{goal.title}</h4>
              <span
                className="flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0"
                style={{ color: statusConfig.color, backgroundColor: statusConfig.bg }}
              >
                <StatusIcon className="w-2.5 h-2.5" />
                {statusConfig.label}
              </span>
            </div>

            {/* Key stats row */}
            <div className="flex items-center gap-3 text-[11px] text-white/35">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {startedDate}
              </span>
              <span className="flex items-center gap-1">
                <Target className="w-3 h-3" />
                {goal.sessions_completed}/{goal.estimated_sessions_current}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {hoursInvested}h
              </span>
            </div>

            {/* Progress bar */}
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: statusConfig.color }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease }}
              />
            </div>
          </div>

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex-shrink-0 p-1.5 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/5 transition-all"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-white/[0.04]">
              {/* Detail grid */}
              <div className="grid grid-cols-3 gap-3 mb-4 mt-3">
                <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                  <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">Days Active</p>
                  <p className="text-lg font-bold text-white">{daysElapsed}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                  <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">Difficulty</p>
                  <p className="text-sm font-semibold text-white capitalize">{goal.difficulty}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                  <p className="text-[9px] text-white/25 uppercase tracking-wider mb-0.5">Milestones</p>
                  <p className="text-lg font-bold text-white">
                    {milestonesCompleted}<span className="text-sm text-white/25 font-normal">/{milestonesTotal}</span>
                  </p>
                </div>
              </div>

              {/* Milestones list */}
              {milestonesTotal > 0 && (
                <div className="mb-4">
                  <p className="text-[9px] text-white/25 uppercase tracking-wider mb-2">Milestones</p>
                  <div className="space-y-1">
                    {goal.milestones.map(m => (
                      <div key={m.id} className="flex items-center gap-2 text-xs">
                        {m.completed ? (
                          <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-white/10 flex-shrink-0" />
                        )}
                        <span className={m.completed ? 'text-white/40 line-through' : 'text-white/60'}>
                          {m.title}
                        </span>
                        <span className="text-white/15 text-[10px] ml-auto">@{m.session_target}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional info */}
              <div className="grid grid-cols-2 gap-2 mb-4 text-[11px] text-white/30">
                <div className="flex items-center gap-1.5">
                  <Flame className="w-3 h-3 text-orange-400/50" />
                  <span>Confidence: {Math.round(goal.confidence_score * 100)}%</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <BarChart3 className="w-3 h-3 text-blue-400/50" />
                  <span>Pace: {goal.recommended_sessions_per_day}/day</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Target className="w-3 h-3 text-cyan-400/50" />
                  <span>Initial est: {goal.estimated_sessions_initial}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-purple-400/50" />
                  <span>Remaining: {Math.max(0, goal.estimated_sessions_current - goal.sessions_completed)}</span>
                </div>
              </div>

              {goal.completed_at && (
                <p className="text-[11px] text-green-400/50 mb-3 flex items-center gap-1">
                  <Trophy className="w-3 h-3" />
                  Completed on {formatDate(goal.completed_at)}
                </p>
              )}

              {goal.paused_at && goal.status === 'paused' && (
                <p className="text-[11px] text-yellow-400/50 mb-3 flex items-center gap-1">
                  <Pause className="w-3 h-3" />
                  Paused on {formatDate(goal.paused_at)}
                </p>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 pt-2 border-t border-white/[0.04]">
                {goal.status === 'active' && !isActiveGoal && (
                  <Button variant="glow" size="sm" onClick={onSwitch} className="gap-1 text-xs h-7">
                    <Play className="w-3 h-3" />
                    Switch to
                  </Button>
                )}
                {goal.status === 'active' && (
                  <Button variant="ghost" size="sm" onClick={onPause} className="gap-1 text-xs h-7 text-yellow-400/60 hover:text-yellow-400">
                    <Pause className="w-3 h-3" />
                    Pause
                  </Button>
                )}
                {goal.status === 'paused' && (
                  <Button variant="glow" size="sm" onClick={onResume} className="gap-1 text-xs h-7">
                    <Play className="w-3 h-3" />
                    Resume
                  </Button>
                )}
                {goal.status !== 'completed' && (
                  <Button variant="ghost" size="sm" onClick={onEdit} className="gap-1 text-xs h-7">
                    <Edit3 className="w-3 h-3" />
                    Edit
                  </Button>
                )}
                <div className="flex-1" />
                {goal.status !== 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDelete}
                    className="gap-1 text-xs h-7 text-red-400/40 hover:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function GoalHistoryModal() {
  const showGoalHistory = useStore(s => s.showGoalHistory);
  const setShowGoalHistory = useStore(s => s.setShowGoalHistory);
  const resumeGoal = useStore(s => s.resumeGoal);
  const pauseGoal = useStore(s => s.pauseGoal);
  const switchToGoal = useStore(s => s.switchToGoal);
  const activeGoal = useStore(s => s.activeGoal);
  const setShowEditGoal = useStore(s => s.setShowEditGoal);
  const addToast = useStore(s => s.addToast);

  const goals = useStore(s => s.goals);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'completed'>('all');

  const allGoals = goals
    .filter(g => g.status !== 'abandoned')
    .sort((a, b) => {
      // Active first, then paused, then completed
      const order: Record<string, number> = { active: 0, paused: 1, completed: 2, abandoned: 3 };
      const diff = (order[a.status] ?? 3) - (order[b.status] ?? 3);
      if (diff !== 0) return diff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const filteredGoals = filter === 'all' ? allGoals : allGoals.filter(g => g.status === filter);
  const counts = {
    all: allGoals.length,
    active: allGoals.filter(g => g.status === 'active').length,
    paused: allGoals.filter(g => g.status === 'paused').length,
    completed: allGoals.filter(g => g.status === 'completed').length,
  };

  const totalPomodoros = allGoals.reduce((sum, g) => sum + g.sessions_completed, 0);
  const totalHours = sessionsToHours(totalPomodoros);
  const completedCount = allGoals.filter(g => g.status === 'completed').length;

  const deleteGoal = useStore(s => s.deleteGoal);
  const handleDelete = (goalId: string) => {
    deleteGoal(goalId);
    addToast('Goal removed', 'info');
  };

  return (
    <AnimatePresence>
      {showGoalHistory && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setShowGoalHistory(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="w-full max-w-lg bg-[#131820] border border-white/10 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 pb-3 border-b border-white/[0.06] flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-white">Review All Goals</h3>
                <p className="text-xs text-white/30 mt-0.5">
                  {totalPomodoros} pomodoros &middot; {totalHours}h invested &middot; {completedCount} completed
                </p>
              </div>
              <button
                onClick={() => setShowGoalHistory(false)}
                className="text-white/30 hover:text-white/60 transition-colors p-1.5 rounded-lg hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter tabs */}
            <div className="flex items-center gap-1 px-5 py-3 border-b border-white/[0.04] flex-shrink-0">
              {(['all', 'active', 'paused', 'completed'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    filter === f
                      ? 'bg-white/10 text-white'
                      : 'text-white/30 hover:text-white/50 hover:bg-white/5'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  <span className="ml-1 text-[10px] opacity-50">{counts[f]}</span>
                </button>
              ))}
            </div>

            {/* Goals list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredGoals.length > 0 ? (
                filteredGoals.map(goal => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    isActiveGoal={goal.id === activeGoal?.id}
                    onSwitch={() => {
                      switchToGoal(goal.id);
                      setShowGoalHistory(false);
                    }}
                    onPause={() => pauseGoal(goal.id)}
                    onResume={() => {
                      resumeGoal(goal.id);
                      setShowGoalHistory(false);
                    }}
                    onEdit={() => {
                      // Switch to goal first if needed, then open edit
                      if (goal.id !== activeGoal?.id && goal.status === 'active') {
                        switchToGoal(goal.id);
                      }
                      setShowGoalHistory(false);
                      setTimeout(() => setShowEditGoal(true), 200);
                    }}
                    onDelete={() => handleDelete(goal.id)}
                  />
                ))
              ) : (
                <div className="text-center py-12">
                  <Target className="w-10 h-10 text-white/10 mx-auto mb-3" />
                  <p className="text-sm text-white/30">No {filter !== 'all' ? filter : ''} goals found</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
