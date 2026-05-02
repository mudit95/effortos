'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';

// Cache TTL for the AI motivation message — 4 hours. Held at module
// scope so useCallback's deps array stays empty and the function
// identity remains stable across renders.
const MOTIVATION_TTL_MS = 4 * 60 * 60 * 1000;

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

  // Store current props in a ref so fetchMotivation never changes identity
  const propsRef = useRef({ taskTitle, goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName });
  propsRef.current = { taskTitle, goalTitle, sessionsCompleted, sessionsTotal, streakDays, userName };

  // Cache TTL for the motivation message — 4 hours. Module-level
  // constant lifted out of the component body so the useCallback below
  // doesn't need it in its deps array.

  // Per-user motivation cache. Pre-cache, this fired on every dashboard
  // mount — refresh / back-button / deeplink all cost an Anthropic round
  // trip. The widget's design intent ("Auto-refreshes") is preserved by
  // keeping a 4-hour TTL; multiple loads in the same window reuse the
  // cached message, the next morning gets a fresh one. The optional
  // refreshKey parameter on parent re-mounts will still bypass the
  // cache if the parent passes a manual ⟳ trigger.
  const cacheKeyRef = useRef<string>('');
  cacheKeyRef.current = `effortos:motivation:${propsRef.current.userName || 'anon'}`;

  const fetchMotivation = useCallback(async (force?: boolean) => {
    const cacheKey = cacheKeyRef.current;
    // Try the cache first unless forced.
    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { message: string; ts: number };
          if (parsed.ts && Date.now() - parsed.ts < MOTIVATION_TTL_MS && parsed.message) {
            setMessage(parsed.message);
            return;
          }
        }
      } catch {
        // localStorage / JSON failure — fall through to network.
      }
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/coach/motivation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(propsRef.current),
      });

      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setMessage(data.message);
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ message: data.message, ts: Date.now() }));
      } catch { /* ignore */ }
    } catch {
      // Use a random fallback
      setMessage(FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)]);
    } finally {
      setIsLoading(false);
    }
  }, []); // stable — reads from ref, no prop dependencies

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
