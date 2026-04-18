'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from 'recharts';
import { Card, CardTitle } from '@/components/ui/card';
import { Goal } from '@/types';

interface TrajectoryGraphProps {
  goal: Goal;
  className?: string;
}

// Narrow shape of Recharts' Tooltip content props — enough to render what
// we need, without dragging in the full recharts type (which isn't exported
// stably across major versions).
type TrajectoryTooltipPayload = {
  color?: string;
  name?: string | number;
  value?: number | string;
};

type TrajectoryTooltipProps = {
  active?: boolean;
  payload?: TrajectoryTooltipPayload[];
  label?: string | number;
};

// Hoisted out of the parent component: the react-hooks/static-components
// rule flags components created inside render bodies because their
// identity changes every render, which forces React/Recharts to remount
// them (and lose internal state). Hoisting makes `content={<CustomTooltip />}`
// a stable reference.
function CustomTooltip({ active, payload, label }: TrajectoryTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-white/50 mb-1">Session {label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-medium">
          {p.name}: {p.value} remaining
        </p>
      ))}
    </div>
  );
}

export function TrajectoryGraph({ goal, className = '' }: TrajectoryGraphProps) {
  const {
    estimated_sessions_initial,
    estimated_sessions_current,
    sessions_completed,
  } = goal;

  // Generate trajectory data
  const totalPoints = Math.max(10, estimated_sessions_current);
  const data = [];

  for (let i = 0; i <= Math.min(totalPoints, 50); i++) {
    const sessionNum = Math.round((i / Math.min(totalPoints, 50)) * totalPoints);

    // Initial estimate line (linear decrease)
    const initialRemaining = Math.max(0, estimated_sessions_initial - sessionNum);

    // Current estimate line (may differ due to recalibration)
    const currentRemaining = Math.max(0, estimated_sessions_current - sessionNum);

    // Ideal line (perfect pace)
    const idealRemaining = Math.max(0, estimated_sessions_current - sessionNum);

    // Actual progress (only up to completed sessions)
    const actual = sessionNum <= sessions_completed
      ? Math.max(0, estimated_sessions_current - sessionNum)
      : undefined;

    data.push({
      session: sessionNum,
      initial: initialRemaining,
      current: currentRemaining,
      ideal: idealRemaining,
      actual,
    });
  }

  return (
    <Card variant="default" className={className}>
      <CardTitle>Effort Trajectory</CardTitle>
      <div className="mt-4 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
            <defs>
              <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="session"
              tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Initial estimate (dashed) */}
            <Line
              type="monotone"
              dataKey="initial"
              stroke="rgba(255,255,255,0.15)"
              strokeDasharray="5 5"
              strokeWidth={1}
              dot={false}
              name="Initial"
            />

            {/* Ideal pace (faint) */}
            <Line
              type="monotone"
              dataKey="ideal"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
              dot={false}
              name="Ideal"
            />

            {/* Actual progress (solid with area fill) */}
            <Area
              type="monotone"
              dataKey="actual"
              stroke="#22d3ee"
              strokeWidth={2}
              fill="url(#actualGradient)"
              dot={false}
              name="Actual"
              connectNulls={false}
            />

            {/* Current position marker */}
            {sessions_completed > 0 && (
              <ReferenceLine
                x={sessions_completed}
                stroke="rgba(34,211,238,0.3)"
                strokeDasharray="3 3"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
