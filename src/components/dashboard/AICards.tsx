'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

// Fallback insights when API fails
const FALLBACK_INSIGHTS = [
  "Consistency beats intensity — your daily habit is building real momentum.",
  "Your best work happens in focused blocks. Notice which time of day you're sharpest.",
  "Every session you complete rewires your brain for better focus.",
  "Break patterns emerge from consistency. Keep showing up for 30 days.",
  "Rest days aren't setbacks — they're recovery for peak performance.",
  "Your streak is proof that small daily efforts compound into transformation.",
  "Track not just sessions but the quality of focus. Intensity matters too.",
];

// Fallback motivations when API fails
const FALLBACK_MOTIVATIONS = [
  "The next pomodoro is all that matters right now.",
  "Small steps compound into big results.",
  "You chose to show up — that already counts.",
  "Focus is a muscle. You are building it right now.",
  "Consistency beats intensity, every time.",
  "Your future self will thank you for this session.",
  "Progress happens one pomodoro at a time.",
];

interface AIInsightCardProps {
  goalTitle?: string;
  sessionsCompleted?: number;
  sessionsTotal?: number;
  streakDays?: number;
  context?: 'longterm' | 'daily';
  className?: string;
}

interface AIMotivationCardProps {
  goalTitle?: string;
  sessionsCompleted?: number;
  sessionsTotal?: number;
  streakDays?: number;
  userName?: string;
  className?: string;
}

export function AIInsightCard({
  goalTitle,
  sessionsCompleted = 0,
  sessionsTotal = 0,
  streakDays = 0,
  context = 'longterm',
  className = '',
}: AIInsightCardProps) {
  const [insight, setInsight] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Store current props in a ref so fetchInsight never changes identity
  const propsRef = useRef({ goalTitle, sessionsCompleted, sessionsTotal, streakDays, context });
  propsRef.current = { goalTitle, sessionsCompleted, sessionsTotal, streakDays, context };

  const fetchInsight = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/coach/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(propsRef.current),
      });

      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setInsight(data.insight);
    } catch {
      // Use a random fallback
      setInsight(
        FALLBACK_INSIGHTS[Math.floor(Math.random() * FALLBACK_INSIGHTS.length)]
      );
    } finally {
      setIsLoading(false);
    }
  }, []); // stable — reads from ref, no prop dependencies

  // Fetch once on mount, then auto-rotate every 20 minutes
  useEffect(() => {
    fetchInsight();

    const autoRotateMs = 20 * 60 * 1000; // 20 minutes
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchInsight();
      }
    }, autoRotateMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchInsight]);

  return (
    <div
      className={`border border-white/[0.06] bg-white/[0.02] rounded-xl p-4 ${className}`}
    >
      {/* Header with title and shuffle button */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <h3 className="text-[10px] text-white/25 uppercase tracking-widest font-medium">
            AI Insights
          </h3>
        </div>
        <button
          onClick={fetchInsight}
          disabled={isLoading}
          className="p-2 border border-white/[0.08] rounded-md hover:border-white/[0.15] hover:bg-white/[0.02] transition-all duration-200 flex items-center justify-center disabled:opacity-50"
          aria-label="Get another insight"
          title="Shuffle insight"
        >
          <RefreshCw
            size={16}
            className={`text-white/50 ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Content with animation */}
      <div className="min-h-[60px] flex items-center">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-8 bg-gradient-to-r from-white/[0.05] to-transparent rounded animate-pulse"
            />
          ) : (
            <motion.p
              key={insight}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-white/50 leading-relaxed"
            >
              {insight}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <p className="text-[10px] text-white/15 mt-3">
        Auto-refreshes · Tap ⟳ for another
      </p>
    </div>
  );
}

export function AIMotivationCard({
  goalTitle,
  sessionsCompleted = 0,
  sessionsTotal = 0,
  streakDays = 0,
  userName = 'there',
  className = '',
}: AIMotivationCardProps) {
  const [motivation, setMotivation] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Store current props in a ref so fetchMotivation never changes identity
  const propsRef = useRef({ goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName });
  propsRef.current = { goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName };

  const fetchMotivation = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/coach/motivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(propsRef.current),
      });

      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setMotivation(data.message);
    } catch {
      // Use a random fallback
      setMotivation(
        FALLBACK_MOTIVATIONS[Math.floor(Math.random() * FALLBACK_MOTIVATIONS.length)]
      );
    } finally {
      setIsLoading(false);
    }
  }, []); // stable — reads from ref, no prop dependencies

  // Fetch once on mount, then auto-rotate every 15 minutes
  useEffect(() => {
    fetchMotivation();

    const autoRotateMs = 15 * 60 * 1000; // 15 minutes
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMotivation();
      }
    }, autoRotateMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchMotivation]);

  return (
    <div
      className={`border border-cyan-500/[0.08] bg-gradient-to-br from-cyan-500/[0.04] to-purple-500/[0.04] rounded-xl p-4 ${className}`}
    >
      {/* Header with title and shuffle button */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">✨</span>
          <h3 className="text-[10px] text-white/25 uppercase tracking-widest font-medium">
            Motivation
          </h3>
        </div>
        <button
          onClick={fetchMotivation}
          disabled={isLoading}
          className="p-2 border border-white/[0.08] rounded-md hover:border-white/[0.15] hover:bg-white/[0.02] transition-all duration-200 flex items-center justify-center disabled:opacity-50"
          aria-label="Get another motivation"
          title="Shuffle motivation"
        >
          <RefreshCw
            size={16}
            className={`text-white/50 ${isLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Content with animation */}
      <div className="min-h-[60px] flex items-center">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-8 bg-gradient-to-r from-white/[0.05] to-transparent rounded animate-pulse"
            />
          ) : (
            <motion.p
              key={motivation}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="text-sm text-white/50 italic leading-relaxed"
            >
              {motivation}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <p className="text-[10px] text-white/15 mt-3">
        Auto-refreshes · Tap ⟳ for another
      </p>
    </div>
  );
}
