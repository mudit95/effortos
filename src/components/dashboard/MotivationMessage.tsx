'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';

// Fallback messages when AI is unavailable
const FALLBACK_MESSAGES = [
  'Small steps compound into big results',
  'The next session is the only one that matters',
  'You chose to show up — that already counts',
  'Focus is a muscle. You are building it right now',
  'Every session teaches you something about yourself',
  'Consistency beats intensity, every time',
  'Your future self will thank you for this session',
  'Progress happens one pomodoro at a time',
];

interface MotivationMessageProps {
  taskTitle?: string;
  goalTitle?: string;
  sessionsCompleted: number;
  sessionsTotal: number;
  streakDays: number;
  userName: string;
}

export function MotivationMessage({
  taskTitle,
  goalTitle,
  sessionsCompleted,
  sessionsTotal,
  streakDays,
  userName,
}: MotivationMessageProps) {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const fetchMotivation = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/coach/motivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskTitle,
          goalTitle,
          sessionsCompleted,
          sessionsTotal,
          streakDays,
          userName,
        }),
      });

      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setMessage(data.message);
    } catch {
      // Use a random fallback
      setMessage(FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)]);
    } finally {
      setIsLoading(false);
    }
  }, [taskTitle, goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName]);

  useEffect(() => {
    fetchMotivation();
  }, [fetchMotivation]);

  return (
    <AnimatePresence mode="wait">
      {message && !isLoading && (
        <motion.div
          key={message}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-center gap-2 text-center px-4"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400/40 flex-shrink-0" />
          <p className="text-sm text-white/35 italic leading-relaxed">{message}</p>
        </motion.div>
      )}
      {isLoading && (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-5"
        />
      )}
    </AnimatePresence>
  );
}
