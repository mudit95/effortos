'use client';

/* ─────────────────────────────────────────────────────────────────────
 * ShadowGoalsModal
 * --------------------------------------------------------------------
 * The "someday shelf" — a dedicated surface for parking goal ideas
 * without committing to estimation, scheduling, or activation. Keeps
 * the active-goal flow uncluttered while making sure ideas aren't lost
 * to a sticky note.
 *
 * UX
 * ~~~~~~~~
 *  - Top: an inline add form (title required, note optional). Submitting
 *    appends to the top of the list (newest-first) and immediately
 *    clears the inputs so the user can rapid-fire shadow goals.
 *  - Each row exposes Promote / Edit / Delete actions. "Promote" routes
 *    the user into the standard onboarding wizard, prefilled with the
 *    shadow's title + note; the shadow row is removed only on a
 *    successful goal creation (handled in store.completeOnboarding).
 *  - Edits happen inline (no nested modal) so the shelf feels like a
 *    notebook page, not a CRUD form.
 *  - Empty state explains the purpose so first-timers don't think the
 *    shelf is broken.
 *
 * The component subscribes to store slices individually rather than
 * destructuring a single selector so unrelated state changes don't
 * re-render the whole shelf.
 * ──────────────────────────────────────────────────────────────────── */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, Check, Edit3, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { ShadowGoal } from '@/types';

const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

/** Format ISO timestamp as a compact "2 days ago" / "Apr 18" label. */
function formatAge(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  const diffMs = nowMs - then;
  const day = 1000 * 60 * 60 * 24;
  const days = Math.floor(diffMs / day);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ShadowGoalsModal() {
  const showShadowGoals = useStore(s => s.showShadowGoals);
  const setShowShadowGoals = useStore(s => s.setShowShadowGoals);

  return (
    <AnimatePresence>
      {showShadowGoals && (
        <ShadowGoalsModalBody onClose={() => setShowShadowGoals(false)} />
      )}
    </AnimatePresence>
  );
}

function ShadowGoalsModalBody({ onClose }: { onClose: () => void }) {
  const shadowGoals = useStore(s => s.shadowGoals);
  const addShadowGoal = useStore(s => s.addShadowGoal);
  const promoteShadowGoal = useStore(s => s.promoteShadowGoal);
  const removeShadowGoal = useStore(s => s.removeShadowGoal);
  const updateShadowGoal = useStore(s => s.updateShadowGoal);
  const goals = useStore(s => s.goals);

  // 5-active-goal limit lives in createNewGoal; we mirror it here so the
  // Promote button can be disabled with a clear reason rather than letting
  // the user click through to onboarding only to see a toast at the end.
  const activeOrPaused = goals.filter(g => g.status === 'active' || g.status === 'paused').length;
  const atGoalLimit = activeOrPaused >= 5;

  const [draftTitle, setDraftTitle] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [showNoteField, setShowNoteField] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  // Frozen "now" so age labels don't drift between renders within this open
  // session. The shelf re-mounts on each open, so the value is always fresh
  // when the user actually sees it.
  const [nowAtMount] = useState(() => Date.now());

  // Escape closes the modal. We don't intercept it while editing — the inline
  // editor's own handler stops propagation when it wants to swallow Esc.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleAdd = () => {
    const title = draftTitle.trim();
    if (!title) return;
    addShadowGoal(title, draftNote);
    setDraftTitle('');
    setDraftNote('');
    setShowNoteField(false);
  };

  const handlePromote = (id: string) => {
    if (atGoalLimit) return; // Button is disabled in this case; defensive.
    promoteShadowGoal(id);
    // promoteShadowGoal flips currentView to 'onboarding' and closes the
    // shelf via showShadowGoals: false in the same set() call.
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.96, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[88vh] flex flex-col bg-gradient-to-b from-[#161c26] to-[#11151c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shadow-goals-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-white/10">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-2 rounded-lg bg-purple-500/10 text-purple-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 id="shadow-goals-title" className="text-lg font-semibold text-white">
                Shadow Goals
              </h2>
              <p className="text-xs text-white/50 mt-0.5">
                A shelf for ideas you might commit to later. {shadowGoals.length === 0 ? 'Empty for now.' : `${shadowGoals.length} parked.`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Add form */}
        <div className="px-6 py-4 border-b border-white/10 bg-white/[0.015]">
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Park an idea — e.g. Learn Rust, Run a half marathon…"
            className="w-full bg-transparent border border-white/10 focus:border-purple-400/40 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition"
            maxLength={120}
          />
          {showNoteField ? (
            <textarea
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="Why this matters, rough scope, links… (optional)"
              rows={2}
              className="w-full mt-2 bg-transparent border border-white/10 focus:border-purple-400/40 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition resize-none"
              maxLength={500}
            />
          ) : null}
          <div className="flex items-center justify-between mt-2.5">
            {!showNoteField ? (
              <button
                onClick={() => setShowNoteField(true)}
                className="text-xs text-white/40 hover:text-white/70 transition"
              >
                + Add a note
              </button>
            ) : <span />}
            <button
              onClick={handleAdd}
              disabled={!draftTitle.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/15 text-purple-200 text-xs font-medium hover:bg-purple-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Add to shelf
            </button>
          </div>
        </div>

        {/* List body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {shadowGoals.length === 0 ? (
            <EmptyShelf />
          ) : (
            <ul className="space-y-2">
              {shadowGoals.map((g) => (
                <ShadowGoalRow
                  key={g.id}
                  shadow={g}
                  nowMs={nowAtMount}
                  isEditing={editingId === g.id}
                  isConfirmingDelete={confirmingDeleteId === g.id}
                  atGoalLimit={atGoalLimit}
                  onEdit={() => setEditingId(g.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(patch) => {
                    updateShadowGoal(g.id, patch);
                    setEditingId(null);
                  }}
                  onPromote={() => handlePromote(g.id)}
                  onAskDelete={() => setConfirmingDeleteId(g.id)}
                  onCancelDelete={() => setConfirmingDeleteId(null)}
                  onConfirmDelete={() => {
                    removeShadowGoal(g.id);
                    setConfirmingDeleteId(null);
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint about limit */}
        {atGoalLimit && shadowGoals.length > 0 && (
          <div className="px-6 py-3 border-t border-white/10 bg-amber-500/[0.04] text-xs text-amber-200/80">
            You&rsquo;re at the 5 active-goal limit, so promoting is paused. Pause or complete a goal to free a slot.
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ─── Row ─────────────────────────────────────────────────────────── */

function ShadowGoalRow({
  shadow,
  nowMs,
  isEditing,
  isConfirmingDelete,
  atGoalLimit,
  onEdit,
  onCancelEdit,
  onSave,
  onPromote,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  shadow: ShadowGoal;
  nowMs: number;
  isEditing: boolean;
  isConfirmingDelete: boolean;
  atGoalLimit: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: { title: string; note: string }) => void;
  onPromote: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  // Editing is rendered as a sibling component so useState initializers
  // seed the draft from props on mount — no setState-in-effect needed
  // (which would trip the React 19 `react-hooks/set-state-in-effect`
  // rule). Keying the editor by `shadow.id` guarantees a fresh mount if
  // the parent swaps which row is being edited without a closing step.
  if (isEditing) {
    return (
      <ShadowGoalEditor
        key={shadow.id}
        shadow={shadow}
        onCancel={onCancelEdit}
        onSave={onSave}
      />
    );
  }

  return (
    <li className="group rounded-xl border border-white/8 bg-white/[0.02] hover:border-white/15 transition p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-white truncate">
              {shadow.title}
            </span>
            <span className="text-[10px] text-white/30 shrink-0">
              {formatAge(shadow.created_at, nowMs)}
            </span>
          </div>
          {shadow.note && (
            <p className="mt-1 text-xs text-white/55 whitespace-pre-wrap leading-relaxed">
              {shadow.note}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isConfirmingDelete ? (
            <>
              <button
                onClick={onConfirmDelete}
                className="px-2 py-1 rounded-md text-[11px] bg-red-500/20 text-red-200 hover:bg-red-500/30 transition"
              >
                Delete?
              </button>
              <button
                onClick={onCancelDelete}
                className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition"
                aria-label="Cancel delete"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onPromote}
                disabled={atGoalLimit}
                title={atGoalLimit ? 'Pause or complete a goal first' : 'Promote to active goal'}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Promote
              </button>
              <button
                onClick={onEdit}
                title="Edit"
                className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition"
                aria-label="Edit"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onAskDelete}
                title="Delete"
                className="p-1.5 rounded-md text-white/40 hover:text-red-300 hover:bg-red-500/5 transition"
                aria-label="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/* ─── Inline editor ───────────────────────────────────────────────── */

function ShadowGoalEditor({
  shadow,
  onCancel,
  onSave,
}: {
  shadow: ShadowGoal;
  onCancel: () => void;
  onSave: (patch: { title: string; note: string }) => void;
}) {
  // useState initializers run once on mount, so we don't need an effect
  // to seed the buffers from props — the parent uses `key={shadow.id}`
  // to force a fresh mount whenever the editing target changes.
  const [editTitle, setEditTitle] = useState(shadow.title);
  const [editNote, setEditNote] = useState(shadow.note);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Autofocus the title input on mount. We use a ref callback rather than
  // a useEffect with imperative focus so we don't run into the "setState
  // in effect" rule by writing to component state from the same effect.
  // Calling focus() here is a side-effect-only action on a DOM node, so
  // it's allowed under the React 19 effect rules.
  useEffect(() => {
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, []);

  const canSave = editTitle.trim().length > 0;

  return (
    <li className="rounded-xl border border-purple-400/30 bg-purple-500/[0.04] p-3">
      <input
        ref={titleInputRef}
        type="text"
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSave) onSave({ title: editTitle, note: editNote });
          } else if (e.key === 'Escape') {
            // stopPropagation so the modal-level Escape handler doesn't
            // also close the whole shelf — Esc here just exits the editor.
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        className="w-full bg-transparent border border-white/10 focus:border-purple-400/40 rounded-lg px-3 py-2 text-sm text-white outline-none transition"
        maxLength={120}
      />
      <textarea
        value={editNote}
        onChange={(e) => setEditNote(e.target.value)}
        placeholder="Note (optional)"
        rows={2}
        className="w-full mt-2 bg-transparent border border-white/10 focus:border-purple-400/40 rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none transition resize-none"
        maxLength={500}
      />
      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          onClick={onCancel}
          className="px-2.5 py-1 rounded-md text-xs text-white/60 hover:text-white hover:bg-white/5 transition"
        >
          Cancel
        </button>
        <button
          onClick={() => canSave && onSave({ title: editTitle, note: editNote })}
          disabled={!canSave}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-purple-500/20 text-purple-100 hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Check className="w-3.5 h-3.5" />
          Save
        </button>
      </div>
    </li>
  );
}

/* ─── Empty state ─────────────────────────────────────────────────── */

function EmptyShelf() {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6">
      <div className="p-3 rounded-2xl bg-purple-500/10 text-purple-300 mb-3">
        <Sparkles className="w-6 h-6" />
      </div>
      <h3 className="text-sm font-medium text-white">Nothing parked yet</h3>
      <p className="mt-1 text-xs text-white/50 max-w-xs leading-relaxed">
        Drop ideas here that you&rsquo;d like to revisit — half-formed
        ambitions, &ldquo;maybe someday&rdquo; projects, things you&rsquo;re
        curious about. When you&rsquo;re ready, promote one and the standard
        onboarding wizard will turn it into a real goal.
      </p>
    </div>
  );
}
