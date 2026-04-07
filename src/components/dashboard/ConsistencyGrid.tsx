'use client';

import React from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { DailySession } from '@/types';
import { cn } from '@/lib/utils';

interface ConsistencyGridProps {
  dailySessions: DailySession[];
  className?: string;
}

export function ConsistencyGrid({ dailySessions, className = '' }: ConsistencyGridProps) {
  const maxSessions = Math.max(1, ...dailySessions.map(d => d.count));

  // Get last 28 days (4 weeks)
  const last28 = dailySessions.slice(-28);

  const getColor = (count: number): string => {
    if (count === 0) return 'bg-white/[0.03]';
    const intensity = count / maxSessions;
    if (intensity < 0.25) return 'bg-cyan-500/15';
    if (intensity < 0.5) return 'bg-cyan-500/30';
    if (intensity < 0.75) return 'bg-cyan-500/50';
    return 'bg-cyan-500/70';
  };

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <Card variant="default" className={className}>
      <CardTitle>Consistency</CardTitle>
      <div className="mt-4">
        {/* Day labels */}
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {dayLabels.map((d, i) => (
            <span key={i} className="text-[10px] text-white/20 text-center">{d}</span>
          ))}
        </div>
        {/* Grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {last28.map((day, i) => (
            <div
              key={day.date}
              className={cn(
                'aspect-square rounded-[4px] transition-colors duration-200',
                getColor(day.count)
              )}
              title={`${day.date}: ${day.count} sessions`}
            />
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center justify-end gap-1 mt-3">
          <span className="text-[10px] text-white/20">Less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((intensity, i) => (
            <div
              key={i}
              className={cn(
                'w-2.5 h-2.5 rounded-[2px]',
                i === 0 ? 'bg-white/[0.03]' :
                i === 1 ? 'bg-cyan-500/15' :
                i === 2 ? 'bg-cyan-500/30' :
                i === 3 ? 'bg-cyan-500/50' :
                'bg-cyan-500/70'
              )}
            />
          ))}
          <span className="text-[10px] text-white/20">More</span>
        </div>
      </div>
    </Card>
  );
}
