'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useTimer } from '@/hooks/useTimer';
import { useStore } from '@/store/useStore';
import { formatDuration } from '@/lib/utils';
import { Play, Pause, RotateCcw, SkipForward, Maximize2 } from 'lucide-react';

interface TimerDisplayProps {
  compact?: boolean;
  onEnterFocus?: () => void;
}

export function TimerDisplay({ compact = false, onEnterFocus }: TimerDisplayProps) {
  const {
    timerState,
    timeRemaining,
    isBreak,
    startTimer,
    pauseTimer,
    resumeTimer,
    skipBreak,
    resetTimer,
  } = useTimer();

  const activeGoal = useStore(s => s.activeGoal);

  const progress = isBreak
    ? 1 - (timeRemaining / (5 * 60))
    : 1 - (timeRemaining / (25 * 60));

  const circumference = 2 * Math.PI * 90;
  const offset = circumference * (1 - progress);

  const timerColor = isBreak ? '#22c55e' : '#22d3ee';

  if (!activeGoal) return null;

  return (
    <div className={`flex flex-col items-center ${compact ? 'scale-90' : ''}`}>
      {/* Timer Ring */}
      <div className="relative w-52 h-52 mb-6">
        <svg width="208" height="208" viewBox="0 0 208 208" className="transform -rotate-90">
          {/* Background */}
          <circle
            cx="104"
            cy="104"
            r="90"
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="6"
          />
          {/* Progress */}
          <motion.circle
            cx="104"
            cy="104"
            r="90"
            fill="none"
            stroke={timerColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.3, ease: 'linear' }}
            style={{ filter: `drop-shadow(0 0 8px ${timerColor}40)` }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.span
              key={isBreak ? 'break' : 'focus'}
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="text-xs text-white/30 uppercase tracking-widest mb-1"
            >
              {isBreak ? 'Break' : 'Focus'}
            </motion.span>
          </AnimatePresence>
          <span className="text-4xl font-mono font-bold text-white tracking-tight">
            {formatDuration(timeRemaining)}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {timerState === 'idle' && (
          <Button
            variant="glow"
            size="lg"
            onClick={startTimer}
            className="gap-2 px-8"
          >
            <Play className="w-4 h-4 fill-current" />
            Start Session
          </Button>
        )}

        {timerState === 'running' && (
          <>
            <Button variant="secondary" size="icon" onClick={resetTimer}>
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button variant="glow" size="lg" onClick={pauseTimer} className="gap-2 px-8">
              <Pause className="w-4 h-4 fill-current" />
              Pause
            </Button>
            {onEnterFocus && (
              <Button variant="secondary" size="icon" onClick={onEnterFocus}>
                <Maximize2 className="w-4 h-4" />
              </Button>
            )}
          </>
        )}

        {timerState === 'paused' && (
          <>
            <Button variant="secondary" size="icon" onClick={resetTimer}>
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button variant="glow" size="lg" onClick={resumeTimer} className="gap-2 px-8">
              <Play className="w-4 h-4 fill-current" />
              Resume
            </Button>
          </>
        )}

        {(timerState === 'break') && (
          <>
            <Button variant="outline" size="lg" onClick={skipBreak} className="gap-2">
              <SkipForward className="w-4 h-4" />
              Skip Break
            </Button>
          </>
        )}

        {timerState === 'completed' && (
          <Button variant="glow" size="lg" onClick={startTimer} className="gap-2 px-8">
            <Play className="w-4 h-4 fill-current" />
            Next Session
          </Button>
        )}
      </div>

      {/* Session info */}
      {!compact && activeGoal && (
        <div className="mt-4 text-center">
          <p className="text-xs text-white/30">
            Session {activeGoal.sessions_completed + 1} of {activeGoal.estimated_sessions_current}
          </p>
        </div>
      )}
    </div>
  );
}
