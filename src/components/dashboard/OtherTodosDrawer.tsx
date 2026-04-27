'use client';

/**
 * OtherTodosDrawer — slide-out panel from the right edge of the screen for
 * the user's "side list" of non-Pomodoro tasks (errands).
 *
 * Design contract:
 *   - Triggered by a small button in the DailyGrind header. Closed = invisible.
 *   - Open errands at the top, completed ones collapsed at the bottom.
 *   - Add row at the very top: title + optional minutes preset (15/30/60/none).
 *   - These do NOT start a Pomodoro and do NOT show in the daily nudges
 *     beyond a count line in the nightly recap.
 *
 * Why a drawer (not a modal):
 *   - The brief asked for "less visible". A drawer slides out of the way
 *     when closed and feels secondary by construction. A modal demands
 *     attention; a drawer offers it.
 *
 * Closing: backdrop click, X button, or Escape key.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Check, Trash2, Clock, ChevronDown, ChevronUp, ListTodo } from 'lucide-react';
import type { OtherTodo } from '@/types';
import {
  listOtherTodos,
  createOtherTodo,
  toggleOtherTodoComplete,
  deleteOtherTodo,
  updateOtherTodo,
} from '@/lib/other-todos';

// Time-estimate presets shown as chips when adding a new errand. `null`
// means "no estimate" — we explicitly include it so the user can tap-out
// of estimating without leaving the row blank-looking.
const ESTIMATE_PRESETS: Array<{ label: string; value: number | null }> = [
  { label: 'No time', value: null },
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
];

function formatMinutes(mins: number | null): string {
  if (mins == null) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Optional callback fired whenever the open-todo count changes — lets the
   * parent (DailyGrind header) render a red dot without re-querying.
   */
  onOpenCountChange?: (n: number) => void;
}

export function OtherTodosDrawer({ open, onClose, onOpenCountChange }: Props) {
  const [todos, setTodos] = useState<OtherTodo[]>([]);
  // `loading` starts true — the first open will show a skeleton until the
  // initial fetch resolves. Subsequent opens keep `loading` false because we
  // already have cached `todos`, so the user sees data instantly while a
  // background refresh runs.
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  // Add-row state
  const [newTitle, setNewTitle] = useState('');
  const [newMinutes, setNewMinutes] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Refresh from server. Called on open and after every mutation.
  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await listOtherTodos();
    setTodos(data);
    setLoading(false);
    if (onOpenCountChange) {
      onOpenCountChange(data.filter(t => !t.completed).length);
    }
  }, [onOpenCountChange]);

  // Load on open. We keep the data hydrated only while the drawer is mounted
  // so a closed drawer doesn't subscribe to anything.
  //
  // Implementation note: we run the fetch inside an async IIFE with a
  // `cancelled` flag rather than calling `refresh()` directly from the
  // effect body. This avoids the react-hooks/purity warning about cascading
  // setState during effect commit and lets us safely drop a stale response
  // if the drawer is closed (or `open` flips again) mid-flight.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const data = await listOtherTodos();
      if (cancelled) return;
      setTodos(data);
      setLoading(false);
      if (onOpenCountChange) {
        onOpenCountChange(data.filter(t => !t.completed).length);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onOpenCountChange]);

  // Esc-to-close. Wired only when open so we don't intercept Esc elsewhere.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    const created = await createOtherTodo({ title, estimated_minutes: newMinutes });
    setSubmitting(false);
    if (created) {
      setNewTitle('');
      setNewMinutes(null);
      // Optimistic-ish: prepend then refresh in the background to reconcile
      // ordering with the server.
      setTodos(prev => [created, ...prev]);
      if (onOpenCountChange) {
        onOpenCountChange([created, ...todos].filter(t => !t.completed).length);
      }
    }
  }

  async function handleToggle(t: OtherTodo) {
    // Optimistic flip — UI feels instant, reconcile if the server disagrees.
    const optimistic = todos.map(x =>
      x.id === t.id ? { ...x, completed: !x.completed } : x,
    );
    setTodos(optimistic);
    if (onOpenCountChange) {
      onOpenCountChange(optimistic.filter(x => !x.completed).length);
    }
    const updated = await toggleOtherTodoComplete(t.id, t.completed);
    if (!updated) {
      // Rollback if the write failed.
      setTodos(todos);
      if (onOpenCountChange) {
        onOpenCountChange(todos.filter(x => !x.completed).length);
      }
    }
  }

  async function handleDelete(id: string) {
    const next = todos.filter(t => t.id !== id);
    setTodos(next);
    if (onOpenCountChange) {
      onOpenCountChange(next.filter(t => !t.completed).length);
    }
    const ok = await deleteOtherTodo(id);
    if (!ok) {
      // Rollback — server refused.
      await refresh();
    }
  }

  async function handleEditMinutes(t: OtherTodo, mins: number | null) {
    const optimistic = todos.map(x =>
      x.id === t.id ? { ...x, estimated_minutes: mins } : x,
    );
    setTodos(optimistic);
    await updateOtherTodo(t.id, { estimated_minutes: mins });
  }

  const openTodos = todos.filter(t => !t.completed);
  const completedTodos = todos.filter(t => t.completed);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.aside
            role="dialog"
            aria-label="Other to-dos"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className="absolute right-0 top-0 h-full w-full max-w-md bg-[#131820] border-l border-white/[0.08] shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <ListTodo className="w-4 h-4 text-amber-400/90" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Other To-Dos</h2>
                  <p className="text-[11px] text-white/40">
                    Errands & quick tasks — no Pomodoro needed
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-white/30 hover:text-white/70 transition-colors"
                aria-label="Close other to-dos"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Add row */}
            <div className="px-5 py-4 border-b border-white/[0.04] bg-white/[0.01]">
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder="Pick Susan from school, grab groceries..."
                className="w-full bg-transparent text-sm text-white placeholder:text-white/25 focus:outline-none mb-3"
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  {ESTIMATE_PRESETS.map(p => {
                    const active = newMinutes === p.value;
                    return (
                      <button
                        key={p.label}
                        onClick={() => setNewMinutes(p.value)}
                        className={`text-[11px] px-2 py-1 rounded-md transition-all ${
                          active
                            ? 'bg-amber-500/15 text-amber-300/90 border border-amber-500/20'
                            : 'bg-white/[0.03] text-white/40 hover:text-white/70 border border-transparent'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={handleAdd}
                  disabled={!newTitle.trim() || submitting}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300/90 hover:bg-amber-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </div>

            {/* Body — scrollable list */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
              {loading && todos.length === 0 ? (
                <p className="text-xs text-white/25 text-center py-6">Loading…</p>
              ) : openTodos.length === 0 && completedTodos.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-xs text-white/30">Your side list is empty.</p>
                  <p className="text-[11px] text-white/20 mt-1">
                    Add the errands you don&apos;t want cluttering your Pomodoro list.
                  </p>
                </div>
              ) : (
                <>
                  {/* Open todos */}
                  <ul className="space-y-1">
                    <AnimatePresence initial={false}>
                      {openTodos.map(t => (
                        <TodoRow
                          key={t.id}
                          todo={t}
                          onToggle={() => handleToggle(t)}
                          onDelete={() => handleDelete(t.id)}
                          onEditMinutes={mins => handleEditMinutes(t, mins)}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>

                  {/* Completed (collapsed by default — keeps the drawer clean) */}
                  {completedTodos.length > 0 && (
                    <div className="pt-4 mt-4 border-t border-white/[0.04]">
                      <button
                        onClick={() => setShowCompleted(s => !s)}
                        className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors mb-2"
                      >
                        {showCompleted ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                        Completed ({completedTodos.length})
                      </button>
                      <AnimatePresence initial={false}>
                        {showCompleted && (
                          <motion.ul
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="space-y-1 overflow-hidden"
                          >
                            {completedTodos.map(t => (
                              <TodoRow
                                key={t.id}
                                todo={t}
                                onToggle={() => handleToggle(t)}
                                onDelete={() => handleDelete(t.id)}
                                onEditMinutes={mins => handleEditMinutes(t, mins)}
                                muted
                              />
                            ))}
                          </motion.ul>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-5 py-3 border-t border-white/[0.04] bg-white/[0.01]">
              <p className="text-[10px] text-white/25 leading-relaxed">
                💡 Add errands here from WhatsApp too — just text the coach things like
                &ldquo;remind me to grab groceries&rdquo; or &ldquo;pick Susan up at 4pm&rdquo;.
              </p>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Single row ──────────────────────────────────────────────────────────

interface RowProps {
  todo: OtherTodo;
  onToggle: () => void;
  onDelete: () => void;
  onEditMinutes: (mins: number | null) => void;
  muted?: boolean;
}

function TodoRow({ todo, onToggle, onDelete, onEditMinutes, muted }: RowProps) {
  const [editingMins, setEditingMins] = useState(false);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8, height: 0 }}
      transition={{ duration: 0.18 }}
      className={`group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-colors ${
        muted ? 'opacity-60' : ''
      }`}
    >
      {/* Check */}
      <button
        onClick={onToggle}
        aria-label={todo.completed ? 'Mark incomplete' : 'Mark complete'}
        className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
          todo.completed
            ? 'bg-amber-500/30 border-amber-500/40 text-amber-200'
            : 'border-white/15 hover:border-amber-400/40 text-transparent hover:text-amber-400/40'
        }`}
      >
        <Check className="w-3 h-3" strokeWidth={3} />
      </button>

      {/* Title */}
      <span
        className={`flex-1 text-sm leading-tight ${
          todo.completed ? 'text-white/30 line-through' : 'text-white/85'
        }`}
      >
        {todo.title}
      </span>

      {/* Estimated minutes — click to edit */}
      <div className="relative">
        {editingMins ? (
          <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-md px-1 py-0.5">
            {ESTIMATE_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => {
                  onEditMinutes(p.value);
                  setEditingMins(false);
                }}
                className="text-[10px] px-1.5 py-0.5 rounded text-white/50 hover:text-white/90 hover:bg-white/10 transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setEditingMins(true)}
            className={`text-[10px] flex items-center gap-1 px-1.5 py-1 rounded transition-all ${
              todo.estimated_minutes != null
                ? 'text-amber-300/70 hover:text-amber-300'
                : 'text-white/15 hover:text-white/40'
            }`}
          >
            <Clock className="w-3 h-3" />
            {todo.estimated_minutes != null ? formatMinutes(todo.estimated_minutes) : '—'}
          </button>
        )}
      </div>

      {/* Delete — only on hover */}
      <button
        onClick={onDelete}
        aria-label="Delete"
        className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400/80 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </motion.li>
  );
}
