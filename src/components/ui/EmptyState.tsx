'use client';

import React from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

/**
 * Consistent empty-state primitive for sections that have no content
 * yet (no goals, no tasks, no journal entries, no streaks, no
 * sessions in this period, etc.).
 *
 * Why a shared primitive:
 *   - Empty states were previously bespoke per surface, which meant
 *     the icon size, copy tone, and CTA placement drifted across
 *     the app. A user who hits 4 different empty states in their
 *     first session sees 4 different visual languages.
 *   - The right empty state has THREE pieces of information: an icon
 *     (what kind of "nothing" this is), a sentence (why it's empty,
 *     in encouraging language), and an optional CTA (the obvious
 *     next action). Bundling them keeps every surface honest.
 *
 * Tone: encouraging, not blame-y. Never "you have no goals" — always
 * "your first goal goes here". The implicit "yet" is doing a lot of
 * work in a habit app.
 */

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Optional override for the icon background tint. Defaults to white/[0.03]. */
  iconClassName?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  iconClassName,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center text-center px-6 py-12"
    >
      <div
        className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 ${
          iconClassName ?? 'bg-white/[0.03] border border-white/[0.05]'
        }`}
      >
        <Icon className="w-6 h-6 text-white/30" />
      </div>
      <p className="text-sm font-medium text-white/70 mb-1">{title}</p>
      {body && (
        <p className="text-xs text-white/40 max-w-xs leading-relaxed">{body}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-xs font-medium transition-colors"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
