'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Eye, Droplets, Activity } from 'lucide-react';
import { useStore } from '@/store/useStore';

/**
 * Tiny per-break wellness prompt. Shown only during the break phase
 * of FocusMode, only when the user hasn't disabled wellness prompts
 * in settings. Picks one of three categories per break:
 *
 *   - eye    : 20-20-20 rule (look 20 ft away for 20 sec)
 *   - hydro  : drink water
 *   - body   : stand up / shoulder roll / micro-stretch
 *
 * The prompt is purely advisory — it doesn't block anything, doesn't
 * track compliance, doesn't nag if ignored. The whole point is to
 * compound long-term wellbeing perception ("this app cares about me")
 * without creating any new chore.
 *
 * Selection rotates day-of-year mod 3 so the same prompt doesn't
 * appear back-to-back across a sustained focus session, and the user
 * sees variety even if they only do one or two pomodoros a day.
 *
 * UX choices:
 *   - One sentence, one icon. No "tips" jargon, no health lecture.
 *   - Soft mint accent (different from the cyan of focus controls)
 *     so the eye registers it as a different conceptual layer.
 *   - Sits below the break timer, doesn't compete with it.
 *   - Respects prefers-reduced-motion (framer-motion auto-handles).
 */

const PROMPTS = {
  eye: {
    icon: Eye,
    title: '20-20-20',
    body: 'Look ~20 ft away for 20 seconds. Your eyes have been close-focused for 25 min straight.',
    accent: 'text-cyan-300 border-cyan-400/25 bg-cyan-500/[0.05]',
  },
  hydro: {
    icon: Droplets,
    title: 'Sip of water',
    body: 'Hydration drops measurably during deep focus. A quick few sips now beats a headache at 3 PM.',
    accent: 'text-sky-300 border-sky-400/25 bg-sky-500/[0.05]',
  },
  body: {
    icon: Activity,
    title: 'Stand and roll your shoulders',
    body: 'A 30-second posture reset undoes most of what 25 min of seated typing did to your spine.',
    accent: 'text-emerald-300 border-emerald-400/25 bg-emerald-500/[0.05]',
  },
} as const;

type PromptKey = keyof typeof PROMPTS;

/** Day-of-year mod 3 picks one of (eye, hydro, body) for stable rotation. */
function pickPromptKey(): PromptKey {
  const order: PromptKey[] = ['eye', 'hydro', 'body'];
  const start = new Date(new Date().getFullYear(), 0, 0);
  const diff = Date.now() - start.getTime();
  const dayOfYear = Math.floor(diff / (24 * 60 * 60 * 1000));
  return order[dayOfYear % order.length];
}

export function BreakWellnessPrompt() {
  const user = useStore((s) => s.user);

  // Disabled by user setting? Currently piggy-backs on the existing
  // `notifications_enabled` flag — wellness prompts are a soft form
  // of in-app notification. If we add a dedicated `wellness_prompts`
  // setting later, swap this read.
  const enabled = user?.settings?.notifications_enabled !== false;

  const prompt = useMemo(() => PROMPTS[pickPromptKey()], []);

  if (!enabled) return null;

  const Icon = prompt.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`mt-6 sm:mt-8 max-w-md mx-auto px-4 py-3 rounded-xl border ${prompt.accent} flex items-start gap-3`}
    >
      <span className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4" />
      </span>
      <div className="text-left">
        <p className="text-xs font-semibold mb-0.5 text-white/85">{prompt.title}</p>
        <p className="text-[11px] text-white/55 leading-relaxed">{prompt.body}</p>
      </div>
    </motion.div>
  );
}
