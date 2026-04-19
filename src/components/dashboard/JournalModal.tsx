'use client';

/* ─────────────────────────────────────────────────────────────────────
 * JournalModal
 * --------------------------------------------------------------------
 * Per-day journal popup, opened by clicking a cell in StreakCalendar or
 * by any other view that wires `setJournalModalDate(dateKey)`. One
 * entry per calendar day (the DB enforces this with UNIQUE(user_id,
 * date)), so the same component handles "create" and "edit" without
 * branching — we always upsert.
 *
 * UX notes
 * ~~~~~~~~
 * - Roomy two-pane layout: metadata (date / mood / AI prompt) on the
 *   left, writing surface on the right. The writing pane fills the
 *   available viewport height so the user has a real page, not a toast.
 * - Auto-saves 800ms after the last keystroke. Short enough to feel
 *   responsive but long enough to avoid a write per character.
 * - Mood is optional; selecting/unselecting it also triggers the
 *   debounce so moods persist the same way as text.
 * - "Ask for AI Prompt" is a one-shot per entry — once an `ai_prompt`
 *   exists on the row, the button is disabled and the prompt is shown
 *   above the textarea as a writing marker. The store action guards
 *   against re-generation on top of the disabled state.
 * - Escape closes; the click-outside overlay also closes. Both flush
 *   any pending debounced save synchronously before unmounting so
 *   users never lose the last few characters they typed.
 * - Empty content + no mood = delete the entry. Matches the mental
 *   model "if I erase everything, there's nothing to remember".
 * ──────────────────────────────────────────────────────────────────── */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Check, Sparkles, Trash2, X, Loader2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { JOURNAL_MOODS, type JournalMoodId } from '@/types';

const AUTOSAVE_MS = 800;

/** Format a YYYY-MM-DD key as a human-readable header ("Mon, Apr 18 · 2026"). */
function formatHeaderDate(dateKey: string): string {
  // Parse as noon local time to dodge UTC-edge-case day rollover.
  const d = new Date(dateKey + 'T12:00:00');
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const year = d.getFullYear();
  return `${weekday}, ${monthDay} · ${year}`;
}

/** Relative label ("Today" / "Yesterday" / etc.) shown above the long date. */
function getRelativeLabel(dateKey: string): string | null {
  const todayDt = new Date();
  const todayKey = todayDt.toISOString().split('T')[0];
  if (dateKey === todayKey) return 'Today';

  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (dateKey === yest.toISOString().split('T')[0]) return 'Yesterday';

  const tom = new Date();
  tom.setDate(tom.getDate() + 1);
  if (dateKey === tom.toISOString().split('T')[0]) return 'Tomorrow';

  return null;
}

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved';

export function JournalModal() {
  const journalModalDate = useStore(s => s.journalModalDate);
  const setJournalModalDate = useStore(s => s.setJournalModalDate);
  const journalEntries = useStore(s => s.journalEntries);
  const saveJournalEntry = useStore(s => s.saveJournalEntry);
  const deleteJournalEntry = useStore(s => s.deleteJournalEntry);
  const requestJournalAIPrompt = useStore(s => s.requestJournalAIPrompt);
  const addToast = useStore(s => s.addToast);

  // Key the body component by the active date so its useState initializers
  // re-seed cleanly when the user jumps between days without closing.
  const existing = journalModalDate
    ? journalEntries.find(e => e.date === journalModalDate) ?? null
    : null;

  return (
    <AnimatePresence>
      {journalModalDate && (
        <JournalModalBody
          key={journalModalDate}
          dateKey={journalModalDate}
          existing={existing}
          onClose={() => setJournalModalDate(null)}
          onSave={saveJournalEntry}
          onDelete={deleteJournalEntry}
          onRequestPrompt={requestJournalAIPrompt}
          onToast={addToast}
        />
      )}
    </AnimatePresence>
  );
}

function JournalModalBody({
  dateKey,
  existing,
  onClose,
  onSave,
  onDelete,
  onRequestPrompt,
  onToast,
}: {
  dateKey: string;
  existing: { content: string; mood?: JournalMoodId; ai_prompt?: string } | null;
  onClose: () => void;
  onSave: (date: string, content: string, mood?: JournalMoodId) => void;
  onDelete: (date: string) => void;
  onRequestPrompt: (date: string) => Promise<string | null>;
  onToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}) {
  const [content, setContent] = useState(existing?.content ?? '');
  const [mood, setMood] = useState<JournalMoodId | undefined>(existing?.mood);
  const [aiPrompt, setAIPrompt] = useState<string | undefined>(existing?.ai_prompt);
  const [promptLoading, setPromptLoading] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Tracks whether there is currently anything persisted to disk for this
  // date. Promoted from a ref to state so we can render the "Delete entry"
  // button without reading refs during render (React 19 `react-hooks/refs`
  // rule). It's updated imperatively from the save/delete paths below.
  const initialExists = !!(existing && (existing.content.trim() !== '' || existing.mood || existing.ai_prompt));
  const [entryExistsOnDisk, setEntryExistsOnDisk] = useState(initialExists);

  // Refs track the latest values for the debounced save. Updated
  // synchronously from event handlers so the setTimeout callback never
  // sees a stale closure. `lastSavedRef` mirrors the most recent
  // persist so we can skip no-op writes. All ref reads happen inside
  // handlers or effect cleanups — never during render — which keeps
  // the ref-purity rule satisfied.
  const contentRef = useRef(content);
  const moodRef = useRef(mood);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({ content: existing?.content ?? '', mood: existing?.mood });

  // Core persist logic. Extracted into useCallback so the unmount-flush
  // effect can depend on it without re-subscribing every render.
  const flushSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const c = contentRef.current;
    const m = moodRef.current;
    if (c === lastSavedRef.current.content && m === lastSavedRef.current.mood) return;

    if (c.trim() === '' && !m) {
      // "Delete by emptying" — only act if an entry actually exists on disk.
      // We deliberately do NOT trigger deletion when an ai_prompt is set
      // but the user hasn't typed yet; the prompt itself is worth preserving
      // so the one-time guard still reads correctly after close+reopen.
      if (lastSavedRef.current.content !== '' || lastSavedRef.current.mood) {
        onDelete(dateKey);
        lastSavedRef.current = { content: '', mood: undefined };
        setEntryExistsOnDisk(false);
      }
    } else {
      onSave(dateKey, c, m);
      lastSavedRef.current = { content: c, mood: m };
      setEntryExistsOnDisk(true);
    }
  }, [dateKey, onSave, onDelete]);

  // Schedule the debounced save. Called from the change handlers rather
  // than from an effect — if we drove this from useEffect, every render
  // that touched `content` or `mood` would bump the timer, and the
  // unconditional setStatus('dirty') inside the effect would trip the
  // react-hooks/set-state-in-effect rule. Handlers are effect-free, so
  // this is the idiomatic React 19 pattern.
  const scheduleSave = useCallback(() => {
    setStatus('dirty');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setStatus('saving');
      flushSave();
      // Small delay to let the "Saving..." flicker feel real rather
      // than jumping straight to "Saved" (which would read as "did
      // anything actually happen?").
      setTimeout(() => setStatus('saved'), 120);
    }, AUTOSAVE_MS);
  }, [flushSave]);

  const handleContentChange = (next: string) => {
    setContent(next);
    contentRef.current = next;
    scheduleSave();
  };

  const handleMoodToggle = (id: JournalMoodId) => {
    const next: JournalMoodId | undefined = mood === id ? undefined : id;
    setMood(next);
    moodRef.current = next;
    scheduleSave();
  };

  const handleRequestPrompt = async () => {
    if (aiPrompt || promptLoading) return; // one-shot + no double-fire
    setPromptLoading(true);
    try {
      const result = await onRequestPrompt(dateKey);
      if (result) {
        setAIPrompt(result);
        // The store action creates a shell row server-side; ensure our
        // local delete-path doesn't then wipe it if the user closes
        // without typing anything.
        setEntryExistsOnDisk(true);
      } else {
        onToast('Could not generate a prompt right now. Try again later.', 'warning');
      }
    } catch {
      onToast('Could not generate a prompt right now. Try again later.', 'warning');
    } finally {
      setPromptLoading(false);
    }
  };

  // Flush any pending debounce when the modal unmounts. Without this,
  // closing within 800ms of the last keystroke would silently drop the
  // edit on the floor.
  useEffect(() => {
    return () => { flushSave(); };
  }, [flushSave]);

  // Escape closes. We listen on the window so this works even if focus
  // is in the textarea (which eats keydown events otherwise via native
  // behavior).
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

  const handleDelete = () => {
    onDelete(dateKey);
    // Reset local state so the (brief) time between state clear and
    // modal unmount doesn't flash stale content.
    setContent('');
    setMood(undefined);
    setAIPrompt(undefined);
    lastSavedRef.current = { content: '', mood: undefined };
    setEntryExistsOnDisk(false);
    onClose();
  };

  const hasAnyContent = content.trim() !== '' || !!mood;

  const relative = getRelativeLabel(dateKey);

  // Rough word count for the writing progress footer. Matches /\s+/ split
  // after trim so single-word entries count as 1 rather than 0.
  const wordCount = content.trim().length === 0
    ? 0
    : content.trim().split(/\s+/).length;

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
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[85vh] max-h-[880px] bg-gradient-to-b from-[#161c26] to-[#11151c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={`Journal entry for ${formatHeaderDate(dateKey)}`}
      >
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <BookOpen className="w-4.5 h-4.5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                {relative && (
                  <span className="text-xs font-medium text-cyan-400 uppercase tracking-wider">
                    {relative}
                  </span>
                )}
                <SaveIndicator status={status} />
              </div>
              <h2 className="text-[16px] font-semibold text-white/95 leading-tight mt-0.5">
                {formatHeaderDate(dateKey)}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white/70 transition-colors p-1 -mr-1 rounded-md hover:bg-white/5"
            aria-label="Close journal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body: two-pane layout on md+ ─────────────────────── */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]">
          {/* ── Left rail: mood + AI prompt trigger ───────────── */}
          <aside className="border-b md:border-b-0 md:border-r border-white/[0.06] px-6 py-5 space-y-5 overflow-y-auto">
            {/* Mood picker — stacked here so it doesn't steal horizontal
                space from the writing surface. */}
            <section>
              <div className="text-[10px] text-white/30 uppercase tracking-widest mb-2">
                How did the day feel?
              </div>
              <div className="grid grid-cols-5 md:grid-cols-3 gap-1.5">
                {JOURNAL_MOODS.map((m) => {
                  const selected = mood === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleMoodToggle(m.id)}
                      className={`flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl border transition-all ${
                        selected
                          ? 'border-cyan-400/40 bg-cyan-400/10'
                          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
                      }`}
                      aria-pressed={selected}
                      aria-label={`Mood: ${m.label}`}
                    >
                      <span className="text-xl leading-none">{m.emoji}</span>
                      <span className={`text-[10px] uppercase tracking-wide ${
                        selected ? 'text-cyan-300' : 'text-white/40'
                      }`}>
                        {m.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── AI prompt: one-shot per entry ──────────────── */}
            <section>
              <div className="text-[10px] text-white/30 uppercase tracking-widest mb-2">
                Writing spark
              </div>
              {aiPrompt ? (
                // Prompt exists → show it as a calm card, no button. The
                // marker lives here so the writing pane stays uncluttered
                // but the prompt is glanceable while typing.
                <div className="rounded-xl border border-amber-400/20 bg-gradient-to-b from-amber-400/[0.07] to-amber-400/[0.02] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-300/80 uppercase tracking-wider mb-1.5">
                    <Sparkles className="w-3 h-3" />
                    AI prompt
                  </div>
                  <p className="text-[13px] leading-relaxed text-amber-100/90 italic">
                    &ldquo;{aiPrompt}&rdquo;
                  </p>
                  <p className="mt-2 text-[10px] text-white/25">
                    Use this as a starting point — or ignore it and write your own thing.
                  </p>
                </div>
              ) : (
                // No prompt yet → one-shot button. Loading state shows a
                // spinner to indicate the request is in flight.
                <button
                  type="button"
                  onClick={handleRequestPrompt}
                  disabled={promptLoading}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] hover:border-amber-400/40 hover:bg-amber-400/[0.08] text-amber-300/90 hover:text-amber-200 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-wait"
                  title="Generate a one-time writing prompt for today's entry"
                >
                  {promptLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Thinking...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Ask for AI Prompt
                    </>
                  )}
                </button>
              )}
              {!aiPrompt && !promptLoading && (
                <p className="mt-1.5 text-[10px] text-white/25 leading-relaxed">
                  One prompt per entry. Pick your moment.
                </p>
              )}
            </section>
          </aside>

          {/* ── Writing pane ──────────────────────────────────── */}
          <div className="flex flex-col min-h-0">
            <div className="px-6 pt-5 pb-2 shrink-0">
              <label htmlFor="journal-content" className="text-[10px] text-white/30 uppercase tracking-widest">
                Today&rsquo;s entry
              </label>
            </div>
            <div className="px-6 pb-4 flex-1 min-h-0">
              <textarea
                id="journal-content"
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="What happened today? What's on your mind? Small wins, struggles, plans for tomorrow — this is just for you."
                className="w-full h-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 text-[15px] leading-[1.7] text-white/90 placeholder:text-white/25 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/30 transition-all"
                autoFocus
                spellCheck
              />
            </div>
            <div className="px-6 pb-3 flex items-center justify-between text-[11px] text-white/25 shrink-0">
              <span>
                Auto-saves as you type · Press{' '}
                <kbd className="px-1 py-0.5 rounded bg-white/5 border border-white/10 text-white/40 font-mono text-[10px]">
                  Esc
                </kbd>{' '}
                to close
              </span>
              <span className="tabular-nums">
                {wordCount} word{wordCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t border-white/[0.06] bg-white/[0.01] flex items-center justify-between shrink-0">
          <div>
            {entryExistsOnDisk && !confirmingDelete && (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="flex items-center gap-1.5 text-xs text-white/35 hover:text-red-400/80 transition-colors py-1.5 px-2 rounded-md hover:bg-white/[0.02]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete entry
              </button>
            )}
            {confirmingDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/50">Delete for good?</span>
                <button
                  onClick={handleDelete}
                  className="text-xs font-medium text-red-400 hover:text-red-300 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 transition-colors"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="text-xs text-white/40 hover:text-white/70 px-2 py-1"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={confirmingDelete}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
              confirmingDelete
                ? 'text-white/30 cursor-not-allowed'
                : hasAnyContent
                  ? 'text-cyan-300 hover:text-cyan-200 bg-cyan-500/10 hover:bg-cyan-500/20'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            }`}
          >
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Tiny "saved / saving / ..." pill shown in the header. */
function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  if (status === 'dirty' || status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-white/35 uppercase tracking-wider">
        <span className="w-1 h-1 rounded-full bg-amber-400/70 animate-pulse" />
        Saving
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/80 uppercase tracking-wider">
      <Check className="w-2.5 h-2.5" />
      Saved
    </span>
  );
}
