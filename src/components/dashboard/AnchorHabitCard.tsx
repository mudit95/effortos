'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coffee, Check, X, Sparkles, Edit2 } from 'lucide-react';
import { useStore } from '@/store/useStore';

/**
 * Anchor-habit setter card.
 *
 * Lives in Settings → Account section. Lets the user name an existing
 * daily anchor that their focus habit will attach to ("after morning
 * coffee", "after lunch", "right before bed"). Habit-stacking is one
 * of the strongest behavior-design levers in productivity research:
 * attaching a new habit to an existing anchor is dramatically stickier
 * than scheduling it at an abstract time.
 *
 * Storage: profiles.anchor_habit_text (mig 041). Updated via the
 * existing user-update path so the change syncs across devices.
 *
 * UX:
 *   - One field, one save button. Zero ceremony.
 *   - 4 prefill suggestions (chips) below the input — tap to fill.
 *     Lower the entry friction for users who haven't thought about
 *     their day in this language before.
 *   - Inline edit pattern (read-only state by default; click pencil
 *     to edit). Users return to settings often; we don't want them
 *     accidentally re-typing their anchor every time.
 *   - 80-char CHECK at the DB level; UI cap at 80 too so the column
 *     never has to truncate.
 */

const SUGGESTIONS = [
  'after morning coffee',
  'right after lunch',
  'after my workout',
  'before bed',
];

export function AnchorHabitCard() {
  const user = useStore((s) => s.user);
  const updateAnchor = useStore((s) => s.updateAnchorHabit);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user?.anchor_habit_text ?? '');
  const [saving, setSaving] = useState(false);

  const current = user?.anchor_habit_text ?? '';

  const handleSave = async () => {
    const trimmed = draft.trim().slice(0, 80);
    setSaving(true);
    await updateAnchor(trimmed.length > 0 ? trimmed : null);
    setSaving(false);
    setEditing(false);
  };

  const handleClear = async () => {
    setSaving(true);
    await updateAnchor(null);
    setDraft('');
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="pt-4 border-t border-white/[0.06]">
      <div className="flex items-center gap-2 mb-3">
        <Coffee className="w-4 h-4 text-amber-400" />
        <h4 className="text-sm font-medium text-white/70">Anchor habit</h4>
      </div>

      <p className="text-xs text-white/50 leading-relaxed mb-3">
        Attach your focus habit to something you already do every day. It&rsquo;s
        the strongest predictor of habit formation — &ldquo;after morning coffee&rdquo;
        beats &ldquo;at 8 AM&rdquo; by a wide margin.
      </p>

      <AnimatePresence mode="wait">
        {!editing && current ? (
          <motion.div
            key="display"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-amber-400/20 bg-amber-500/[0.04]"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="flex-1 text-sm text-amber-100/85">
              I focus <span className="font-semibold text-amber-100">{current}</span>
            </span>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-amber-300/70 hover:text-amber-200 transition-colors flex items-center gap-1"
              aria-label="Edit anchor"
            >
              <Edit2 className="w-3 h-3" />
              Edit
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="edit"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 80))}
                placeholder='e.g. "after morning coffee"'
                className="flex-1 px-3.5 py-2 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm text-white placeholder:text-white/30 outline-none focus:border-amber-400/40"
                maxLength={80}
                autoFocus={editing}
              />
              <button
                onClick={handleSave}
                disabled={saving}
                aria-label="Save anchor"
                className="p-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 transition-colors disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
              </button>
              {editing && current && (
                <button
                  onClick={() => {
                    setDraft(current);
                    setEditing(false);
                  }}
                  aria-label="Cancel"
                  className="p-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Suggestion chips — only when no current value (first-time
                set) or when the field is empty. Once the user has any
                anchor, suggestions become noise. */}
            {!current || !draft ? (
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setDraft(s)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-white/[0.06] bg-white/[0.02] text-white/55 hover:bg-amber-500/10 hover:border-amber-400/30 hover:text-amber-200 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            {current && (
              <button
                onClick={handleClear}
                className="text-[11px] text-white/30 hover:text-red-400/70 transition-colors"
              >
                Remove anchor
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
