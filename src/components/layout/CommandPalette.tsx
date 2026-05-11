'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Command as CommandIcon,
  Search,
  Play,
  Settings,
  BookOpen,
  Layout,
  ListTodo,
  BarChart3,
  Target,
  Sparkles,
  Share2,
  Gift,
  ArrowRight,
} from 'lucide-react';
import { useStore } from '@/store/useStore';

// We type icons as a generic component instead of importing LucideIcon —
// the pinned lucide-react@1.7.0 doesn't export that helper type.
type IconComponent = React.ComponentType<{ className?: string }>;

/**
 * Universal Cmd+K / Ctrl+K command palette.
 *
 * Keyboard-first jump + action surface. Replaces "where is X" friction
 * with a typeahead search across:
 *
 *   - Static jumps (Daily Grind, Long-term, Reports, Settings, Journal)
 *   - Static actions (Start a session, New task, Add journal entry,
 *     Share my streak, Invite a friend)
 *   - Dynamic items: every active goal becomes a "Switch to: <goal>"
 *     entry; every pending daily task becomes a "Start: <task>" entry.
 *
 * Shortcut: Cmd+K (Mac) / Ctrl+K (Windows/Linux). Escape to close.
 * Up/Down navigates results, Enter executes the highlighted command.
 *
 * Why a custom build instead of cmdk:
 *   - Universe is small (~20-50 items max) — fuzzy match by substring
 *     is fine; full-text search libs aren't worth the bundle bloat.
 *   - The visual style needs to match the rest of the dark glass UI
 *     pixel-for-pixel; headless libraries get us 80% there with
 *     20% of the rendering still custom anyway.
 *   - Zero new deps keeps deploy size predictable.
 *
 * Mounted once at AppShell level; closed by default. Cmd+K toggles
 * open. The component owns its own state — no store coupling needed.
 */

interface Command {
  id: string;
  label: string;
  /** Optional sub-text rendered to the right of the label. */
  hint?: string;
  /** Search keywords beyond the label — improves substring matching. */
  keywords?: string;
  icon: IconComponent;
  /** Section heading the entry sorts under. Order: actions, jumps, goals, tasks. */
  section: 'action' | 'jump' | 'goal' | 'task';
  run: () => void;
}

const SECTION_LABEL: Record<Command['section'], string> = {
  action: 'Actions',
  jump: 'Go to',
  goal: 'Goals',
  task: 'Pending tasks',
};

const SECTION_ORDER: Command['section'][] = ['action', 'jump', 'goal', 'task'];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Live store reads. We resubscribe to ALL deps the palette uses so
  // the result list reflects the current state (e.g., a newly-added
  // goal shows up the next time the palette opens without remount).
  const goals = useStore((s) => s.goals);
  const dailyTasks = useStore((s) => s.dailyTasks);
  const activeGoal = useStore((s) => s.activeGoal);
  const setView = useStore((s) => s.setView);
  const setDashboardMode = useStore((s) => s.setDashboardMode);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const setJournalModalDate = useStore((s) => s.setJournalModalDate);
  const setActiveDailyTask = useStore((s) => s.setActiveDailyTask);
  const startTimer = useStore((s) => s.startTimer);
  const dailyViewDate = useStore((s) => s.dailyViewDate);

  // Open / close + focus management.
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad/.test(
        typeof navigator !== 'undefined' ? navigator.platform : '',
      );
      const opener = isMac ? e.metaKey : e.ctrlKey;
      if (opener && e.key.toLowerCase() === 'k') {
        // Don't hijack Cmd+K when the user is mid-text-input AND it's
        // a contenteditable rich-text region (rare in this app, but
        // defensive). Plain inputs are fine — Cmd+K is universally
        // expected to override input focus.
        const target = e.target as HTMLElement | null;
        const isContentEditable = target?.isContentEditable;
        if (isContentEditable) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      // Focus into the search field once the modal mounts.
      // requestAnimationFrame so the input element exists.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Build the command list. Memo'd on the inputs that affect contents.
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    // ── Actions ──
    list.push({
      id: 'start-session',
      label: 'Start a focus session',
      hint: 'Begin a pomodoro now',
      keywords: 'pomodoro timer focus begin',
      icon: Play,
      section: 'action',
      run: () => {
        startTimer();
        setView('focus');
      },
    });
    list.push({
      id: 'add-journal',
      label: "Add today's journal entry",
      keywords: 'journal mood reflect',
      icon: BookOpen,
      section: 'action',
      run: () => {
        setJournalModalDate(dailyViewDate);
      },
    });
    list.push({
      id: 'share-streak',
      label: 'Share my streak',
      hint: 'Open share sheet',
      keywords: 'streak public share viral',
      icon: Share2,
      section: 'action',
      run: () => {
        // Surface settings open first so the share-streak button is
        // visible. The dashboard surface also has a share button,
        // but jumping to settings reliably exposes the panel.
        setShowSettings(true);
      },
    });
    list.push({
      id: 'invite-friend',
      label: 'Invite a friend',
      hint: '1 month free for both',
      keywords: 'referral coupon invite friend',
      icon: Gift,
      section: 'action',
      run: () => setShowSettings(true),
    });

    // ── Jumps ──
    list.push({
      id: 'goto-daily',
      label: 'Today',
      // Keep "daily grind" in the keyword bag so muscle memory typists still
      // land here. The visible label changed with the product pivot but the
      // user&apos;s search string didn&apos;t.
      keywords: 'today plan tasks daily grind',
      icon: ListTodo,
      section: 'jump',
      run: () => {
        setView('dashboard');
        setDashboardMode('daily');
      },
    });
    list.push({
      id: 'goto-longterm',
      label: 'Long-term goals',
      keywords: 'goals long term progress',
      icon: Target,
      section: 'jump',
      run: () => {
        setView('dashboard');
        setDashboardMode('longterm');
      },
    });
    list.push({
      id: 'goto-reports',
      label: 'Reports',
      keywords: 'analytics trends streaks weekly monthly',
      icon: BarChart3,
      section: 'jump',
      run: () => {
        setView('dashboard');
        setDashboardMode('reports');
      },
    });
    list.push({
      id: 'goto-focus',
      label: 'Focus mode',
      hint: 'Full-screen timer',
      keywords: 'focus timer pomodoro screen full',
      icon: Layout,
      section: 'jump',
      run: () => setView('focus'),
    });
    list.push({
      id: 'goto-settings',
      label: 'Settings',
      keywords: 'preferences account theme persona',
      icon: Settings,
      section: 'jump',
      run: () => setShowSettings(true),
    });

    // ── Dynamic goals ──
    for (const g of goals) {
      if (g.status !== 'active') continue;
      const isCurrent = activeGoal?.id === g.id;
      list.push({
        id: `goal-${g.id}`,
        label: `Switch to: ${g.title}`,
        hint: isCurrent ? 'Currently active' : `${g.sessions_completed} / ${g.estimated_sessions_current} pom`,
        keywords: g.title,
        icon: Sparkles,
        section: 'goal',
        run: () => {
          // No dedicated setActiveGoal action — set state directly to
          // avoid plumbing an action just for this consumer. The
          // dashboard re-renders on the activeGoal change as expected.
          useStore.setState({ activeGoal: g });
          setView('dashboard');
          setDashboardMode('longterm');
        },
      });
    }

    // ── Dynamic pending tasks ──
    const today = dailyViewDate;
    for (const t of dailyTasks) {
      if (t.completed || t.date !== today) continue;
      list.push({
        id: `task-${t.id}`,
        label: `Start: ${t.title}`,
        hint: `${t.pomodoros_done}/${t.pomodoros_target} pom`,
        keywords: t.title,
        icon: Play,
        section: 'task',
        run: () => {
          setActiveDailyTask(t.id);
          setDashboardMode('daily');
          startTimer();
          setView('focus');
        },
      });
    }

    return list;
  }, [
    goals,
    dailyTasks,
    activeGoal,
    dailyViewDate,
    setView,
    setDashboardMode,
    setShowSettings,
    setJournalModalDate,
    setActiveDailyTask,
    startTimer,
  ]);

  // Filtered + sorted view of commands.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? commands.filter((c) => {
          const haystack = (c.label + ' ' + (c.keywords ?? '')).toLowerCase();
          return q.split(/\s+/).every((token) => haystack.includes(token));
        })
      : commands;
    // Group by section then preserve insertion order within each.
    const grouped: Record<Command['section'], Command[]> = {
      action: [],
      jump: [],
      goal: [],
      task: [],
    };
    for (const c of matched) grouped[c.section].push(c);
    const flat: Command[] = [];
    for (const sec of SECTION_ORDER) flat.push(...grouped[sec]);
    return { flat, grouped };
  }, [commands, query]);

  // Reset highlight when query changes (so the current top result is
  // always selected by default). React's "deriving state from props"
  // pattern via setState-during-render — preferred over useEffect
  // here because it avoids the cascade-render warning and keeps the
  // highlight in sync within a single commit.
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setHighlight(0);
  }

  // Keyboard nav on the result list.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.flat.length - 1)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered.flat[highlight];
        if (cmd) {
          cmd.run();
          close();
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered.flat, highlight, close]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="cmdk-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        onClick={close}
      />
      <motion.div
        key="cmdk-panel"
        initial={{ opacity: 0, y: -10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.97 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed left-1/2 top-[15vh] -translate-x-1/2 w-[min(92vw,640px)] z-[101] rounded-2xl border border-white/[0.08] bg-[#0F141B] shadow-2xl shadow-black/60 overflow-hidden"
      >
        {/* Search row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
          <Search className="w-4 h-4 text-white/30 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, goal, or task…"
            className="flex-1 bg-transparent border-0 outline-none text-sm text-white placeholder:text-white/25"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/30 border border-white/[0.06]">
            <CommandIcon className="w-3 h-3" />K
          </kbd>
        </div>

        {/* Result list */}
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {filtered.flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-white/30">
              No matches for &ldquo;{query}&rdquo;
            </div>
          ) : (
            SECTION_ORDER.map((sec) => {
              const items = filtered.grouped[sec];
              if (!items || items.length === 0) return null;
              return (
                <div key={sec} className="mb-1">
                  <p className="px-4 py-1 text-[10px] uppercase tracking-wider text-white/30">
                    {SECTION_LABEL[sec]}
                  </p>
                  {items.map((cmd) => {
                    const idx = filtered.flat.indexOf(cmd);
                    const isHighlighted = idx === highlight;
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => {
                          cmd.run();
                          close();
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                          isHighlighted
                            ? 'bg-cyan-500/[0.10] text-white'
                            : 'text-white/70 hover:bg-white/[0.03]'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isHighlighted ? 'text-cyan-400' : 'text-white/40'
                          }`}
                        />
                        <span className="flex-1 text-sm truncate">{cmd.label}</span>
                        {cmd.hint && (
                          <span className="text-[10px] text-white/30 shrink-0">
                            {cmd.hint}
                          </span>
                        )}
                        {isHighlighted && (
                          <ArrowRight className="w-3 h-3 text-cyan-400/70 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between px-4 py-2 text-[10px] text-white/25 border-t border-white/[0.04]">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/[0.04]">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/[0.04]">↵</kbd> run
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/[0.04]">esc</kbd> close
            </span>
          </div>
          <span>{filtered.flat.length} result{filtered.flat.length === 1 ? '' : 's'}</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
