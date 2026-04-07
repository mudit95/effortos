'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

interface EffortRingProps {
  percentage: number;
  initialEstimate: number;
  currentEstimate: number;
  sessionsCompleted: number;
  size?: number;
  className?: string;
}

export function EffortRing({
  percentage,
  initialEstimate,
  currentEstimate,
  sessionsCompleted,
  size = 280,
  className = '',
}: EffortRingProps) {
  const center = size / 2;
  const strokeWidth = 8;
  const outerRadius = (size - strokeWidth * 2) / 2 - 4;
  const innerRadius = outerRadius - 16;

  // Calculate circumferences
  const outerCircumference = 2 * Math.PI * outerRadius;
  const innerCircumference = 2 * Math.PI * innerRadius;

  // Progress values
  const outerProgress = Math.min(1, percentage / 100);
  const innerProgress = initialEstimate > 0
    ? Math.min(1, sessionsCompleted / initialEstimate)
    : 0;

  const outerOffset = outerCircumference * (1 - outerProgress);
  const innerOffset = innerCircumference * (1 - innerProgress);

  // Color based on progress
  const progressColor = useMemo(() => {
    if (percentage < 30) return { main: '#ef4444', glow: '#ef444440' }; // Red
    if (percentage < 60) return { main: '#eab308', glow: '#eab30840' }; // Yellow
    if (percentage < 90) return { main: '#22d3ee', glow: '#22d3ee40' }; // Cyan
    return { main: '#22c55e', glow: '#22c55e40' }; // Green
  }, [percentage]);

  // Micro ticks
  const tickCount = Math.min(100, Math.max(10, currentEstimate));
  const completedTicks = Math.min(tickCount, Math.floor((sessionsCompleted / currentEstimate) * tickCount));
  const tickRadius = outerRadius + 12;

  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
        role="img"
        aria-label={`Progress: ${percentage}% complete`}
      >
        {/* Glow filter */}
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={3 + outerProgress * 4} result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={progressColor.main} />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>

        {/* Micro ticks */}
        {Array.from({ length: Math.min(60, tickCount) }).map((_, i) => {
          const angle = (i / Math.min(60, tickCount)) * 360;
          const rad = (angle * Math.PI) / 180;
          const x1 = center + (tickRadius - 3) * Math.cos(rad);
          const y1 = center + (tickRadius - 3) * Math.sin(rad);
          const x2 = center + (tickRadius + 1) * Math.cos(rad);
          const y2 = center + (tickRadius + 1) * Math.sin(rad);
          const isCompleted = i < (completedTicks / tickCount) * Math.min(60, tickCount);

          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isCompleted ? progressColor.main : 'rgba(255,255,255,0.08)'}
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={isCompleted ? 0.8 : 0.3}
            />
          );
        })}

        {/* Background rings */}
        <circle
          cx={center}
          cy={center}
          r={outerRadius}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={innerRadius}
          fill="none"
          stroke="rgba(255,255,255,0.03)"
          strokeWidth={strokeWidth - 2}
        />

        {/* Inner ring: original estimate progress */}
        <motion.circle
          cx={center}
          cy={center}
          r={innerRadius}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={strokeWidth - 2}
          strokeLinecap="round"
          strokeDasharray={innerCircumference}
          initial={{ strokeDashoffset: innerCircumference }}
          animate={{ strokeDashoffset: innerOffset }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* Outer ring: current estimate progress (main) */}
        <motion.circle
          cx={center}
          cy={center}
          r={outerRadius}
          fill="none"
          stroke="url(#ringGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={outerCircumference}
          initial={{ strokeDashoffset: outerCircumference }}
          animate={{ strokeDashoffset: outerOffset }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          filter="url(#glow)"
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          key={percentage}
          initial={{ scale: 0.95, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="text-5xl font-bold text-white tracking-tight"
        >
          {percentage}
          <span className="text-2xl text-white/40">%</span>
        </motion.span>
        <span className="text-xs text-white/30 mt-1 uppercase tracking-widest">
          {percentage >= 100 ? 'Complete' : 'Progress'}
        </span>
      </div>
    </div>
  );
}
