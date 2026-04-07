'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardTitle } from '@/components/ui/card';
import { Goal, DashboardStats } from '@/types';
import { formatRelativeDate, sessionsToHours } from '@/lib/utils';
import { TrendingDown, TrendingUp, Minus, Calendar, Clock, Zap } from 'lucide-react';

interface ProjectionPanelProps {
  goal: Goal;
  stats: DashboardStats;
  className?: string;
}

export function ProjectionPanel({ goal, stats, className = '' }: ProjectionPanelProps) {
  const [extraSessions, setExtraSessions] = useState(0);

  const baseRemaining = stats.sessions_remaining;
  const dailyTarget = goal.recommended_sessions_per_day;
  const adjustedRemaining = Math.max(0, baseRemaining - extraSessions);
  const daysToComplete = dailyTarget > 0 ? Math.ceil(adjustedRemaining / dailyTarget) : 0;

  const projectedDate = new Date();
  projectedDate.setDate(projectedDate.getDate() + daysToComplete);

  const hoursRemaining = sessionsToHours(adjustedRemaining);

  const StatusIcon = stats.pace_status === 'ahead' ? TrendingDown
    : stats.pace_status === 'behind' ? TrendingUp
    : Minus;

  const statusColors = {
    ahead: 'text-green-400 bg-green-500/10',
    on_track: 'text-cyan-400 bg-cyan-500/10',
    adjusting: 'text-yellow-400 bg-yellow-500/10',
    behind: 'text-red-400 bg-red-500/10',
  };

  const statusLabels = {
    ahead: 'Ahead of pace',
    on_track: 'On track',
    adjusting: 'Adjusting',
    behind: 'Behind pace',
  };

  return (
    <Card variant="default" className={className}>
      <div className="flex items-center justify-between mb-4">
        <CardTitle>Live Projection</CardTitle>
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[stats.pace_status]}`}>
          <StatusIcon className="w-3 h-3" />
          {statusLabels[stats.pace_status]}
        </div>
      </div>

      <div className="space-y-4">
        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-white/40 text-xs mb-1">
              <Calendar className="w-3 h-3" />
              <span>Completion</span>
            </div>
            <motion.p
              key={daysToComplete}
              initial={{ y: -5, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="text-lg font-bold text-white"
            >
              {daysToComplete}
              <span className="text-xs text-white/40 ml-1">days</span>
            </motion.p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-white/40 text-xs mb-1">
              <Clock className="w-3 h-3" />
              <span>Remaining</span>
            </div>
            <p className="text-lg font-bold text-white">
              {hoursRemaining}
              <span className="text-xs text-white/40 ml-1">hrs</span>
            </p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-white/40 text-xs mb-1">
              <Zap className="w-3 h-3" />
              <span>Daily</span>
            </div>
            <p className="text-lg font-bold text-white">
              {dailyTarget}
              <span className="text-xs text-white/40 ml-1">sess</span>
            </p>
          </div>
        </div>

        {/* Interactive slider */}
        <div className="pt-3 border-t border-white/5">
          <div className="flex items-center justify-between text-xs text-white/40 mb-2">
            <span>What if you did more?</span>
            <span className="text-white/60 font-medium">+{extraSessions} sessions</span>
          </div>
          <input
            type="range"
            min="0"
            max={Math.min(20, baseRemaining)}
            step="1"
            value={extraSessions}
            onChange={(e) => setExtraSessions(parseInt(e.target.value))}
            className="w-full accent-cyan-500 h-1.5 rounded-full appearance-none bg-white/10 cursor-pointer"
            aria-label="Extra sessions slider"
          />
          {extraSessions > 0 && (
            <motion.p
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-cyan-400 mt-2"
            >
              +{extraSessions} session{extraSessions !== 1 ? 's' : ''}/day saves{' '}
              {Math.max(0, Math.ceil(baseRemaining / dailyTarget) - daysToComplete)} days
            </motion.p>
          )}
        </div>
      </div>
    </Card>
  );
}
