'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardTitle } from '@/components/ui/card';
import { Milestone } from '@/types';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MilestoneTrackerProps {
  milestones: Milestone[];
  sessionsCompleted: number;
  className?: string;
}

export function MilestoneTracker({ milestones, sessionsCompleted, className = '' }: MilestoneTrackerProps) {
  return (
    <Card variant="default" className={className}>
      <CardTitle>Milestones</CardTitle>
      <div className="mt-4 space-y-3">
        {milestones.map((milestone, index) => {
          const isCompleted = milestone.completed || sessionsCompleted >= milestone.session_target;
          const isCurrent = !isCompleted && (
            index === 0 || milestones[index - 1].completed || sessionsCompleted >= milestones[index - 1].session_target
          );
          const progress = Math.min(1, sessionsCompleted / milestone.session_target);

          return (
            <motion.div
              key={milestone.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl transition-all duration-300',
                isCompleted && 'bg-green-500/5',
                isCurrent && 'bg-cyan-500/5 border border-cyan-500/10',
                !isCompleted && !isCurrent && 'opacity-40'
              )}
            >
              {isCompleted ? (
                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
              ) : (
                <Circle className={cn('w-5 h-5 flex-shrink-0', isCurrent ? 'text-cyan-400' : 'text-white/20')} />
              )}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-sm font-medium truncate',
                  isCompleted ? 'text-white/60 line-through' : 'text-white/80'
                )}>
                  {milestone.title}
                </p>
                <p className="text-xs text-white/30">
                  Session {milestone.session_target}
                </p>
              </div>
              {isCurrent && (
                <div className="w-12 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <motion.div
                    className="h-full bg-cyan-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}
