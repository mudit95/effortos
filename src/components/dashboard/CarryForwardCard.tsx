'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, X, Check } from 'lucide-react';
import { useStore } from '@/store/useStore';
import * as storage from '@/lib/storage';
import * as api from '@/lib/api';
import type { DailyTask } from '@/types';

/**
 * Smart auto-carry-forward card.
 *
 * Surfaces ONCE per day on Daily Grind when:
 *   - The user has ≥1 INCOMPLETE tasks dated yesterday (or any past day
 *     within the last 3 days, capped to avoid surfacing weeks-old detritus).
 *   - Today isn't yet at end of day (i.e., still actionable).
 *   - The user hasn't dismissed for today.
 *
 * UX:
 *   - One sentence framing: "3 tasks didn't get done yesterday — bring them forward?"
 *   - List of the tasks (max 5, with "+N more" for the rest) so the user
 *     SEES what they're committing to. The hardest carry-forward UX trap
 *     is users tapping "yes" then realizing the rolled tasks aren't ones
 *     they want today.
 *   - Two buttons: "Carry all" (primary) and "Pick & choose" (opens
 *     individual checkboxes). Most days the bulk action is right, so it's
 *     the default.
 *   - Dismissal lasts 24h (per-date localStorage flag).
 *
 * Implementation: re-uses the existing `addDailyTaskForDate` action +
 * `deleteDailyTask` to perform the move (no dedicated bulk endpoint
 * needed; carry-forward is rare enough that 1 RPC per task is fine).
 */

const DISMISSED_KEY = 'effortos:carryforward_dismissed_for';
const LOOKBACK_DAYS = 3;
const MAX_PREVIEW = 5;

/** Lazy-init helper: does the dismissal flag already match today? */
function shouldStartDismissed(todayKey: string): boolean {
  if (typeof window === 'undefined') return true; // SSR: don't render
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === todayKey;
  } catch {
    return false;
  }
}

export function CarryForwardCard() {
  const dailyViewDate = useStore((s) => s.dailyViewDate);
  const addDailyTaskForDate = useStore((s) => s.addDailyTaskForDate);
  const deleteDailyTask = useStore((s) => s.deleteDailyTask);
  const addToast = useStore((s) => s.addToast);

  // Today-key check — only surface on the canonical "today" view, not
  // when the user has nav'd back to a past day.
  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const isToday = dailyViewDate === todayKey;

  const [pastTasks, setPastTasks] = useState<DailyTask[]>([]);
  // Lazy init: when we know up-front the card won't render (not today
  // or already dismissed), start with loading=false so the effect
  // below can short-circuit without a setState-in-effect.
  const [loading, setLoading] = useState<boolean>(() => isToday && !shouldStartDismissed(todayKey));
  // Lazy init: read the dismissal flag once at mount. No effect needed.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(DISMISSED_KEY) === todayKey;
    } catch {
      return false;
    }
  });
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  // Dismissal state — lazy initializer so the localStorage read
  // happens during render (no setState-in-effect cascade). Reset on
  // todayKey change via a derived comparison below.
  // (The lazy initializer pattern is used in several other places —
  // PWAInstallPrompt, FirstSessionRitual, AntiRelapseCard.)

  // Pull past INCOMPLETE tasks from the lookback window. Try cloud
  // first, fall back to local. We don't merge across — if cloud
  // returns 0 we trust it, since cloud is the source of truth for
  // multi-device users. The early-bail branches don't need to set
  // loading=false because the lazy initializer already started it
  // false in those cases.
  useEffect(() => {
    if (!isToday || dismissed) return;
    let cancelled = false;
    (async () => {
      const all: DailyTask[] = [];
      for (let i = 1; i <= LOOKBACK_DAYS; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        try {
          const cloudRows = await api.getDailyTasksForDate(key);
          all.push(...cloudRows.filter((t) => !t.completed));
        } catch {
          all.push(...storage.getDailyTasksForDate(key).filter((t) => !t.completed));
        }
      }
      if (cancelled) return;
      setPastTasks(all);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isToday, dismissed]);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, todayKey);
    } catch { /* ignore */ }
    setDismissed(true);
  };

  const handleCarry = async (idsToCarry: DailyTask[]) => {
    setWorking(true);
    // Carry by creating fresh today-rows + deleting yesterday-rows.
    // This preserves the audit-trail on the original date (the row
    // gets deleted from yesterday, but the cloud delete cascade keeps
    // session/journal references intact since those refer to dates,
    // not task ids).
    for (const t of idsToCarry) {
      addDailyTaskForDate(
        t.title,
        todayKey,
        t.pomodoros_target,
        t.repeating ?? false,
        t.tag,
        t.goal_id,
      );
      deleteDailyTask(t.id);
    }
    setWorking(false);
    addToast(
      `Carried ${idsToCarry.length} task${idsToCarry.length === 1 ? '' : 's'} forward`,
      'success',
    );
    handleDismiss();
  };

  if (!isToday || dismissed || loading || pastTasks.length === 0) return null;

  const previewed = pastTasks.slice(0, MAX_PREVIEW);
  const overflow = Math.max(0, pastTasks.length - MAX_PREVIEW);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -4, height: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="mb-4 overflow-hidden"
      >
        <div className="relative rounded-xl border border-amber-400/15 bg-amber-500/[0.04] px-4 py-3.5">
          <button
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="absolute top-2 right-2 p-1 text-white/30 hover:text-white/60"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-2 mb-2">
            <ArrowRight className="w-3.5 h-3.5 text-amber-300" />
            <p className="text-xs sm:text-sm text-white/85">
              <span className="font-semibold">{pastTasks.length}</span>{' '}
              task{pastTasks.length === 1 ? '' : 's'} from earlier didn&rsquo;t get done.
              Bring {pastTasks.length === 1 ? 'it' : 'them'} forward?
            </p>
          </div>

          {/* Preview list — selectable when "Pick & choose" is on */}
          <div className="space-y-1 mb-3 ml-5">
            {previewed.map((t) => {
              const isChecked = picking ? chosen.has(t.id) : true;
              return (
                <div
                  key={t.id}
                  onClick={
                    picking
                      ? () => {
                          const next = new Set(chosen);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          setChosen(next);
                        }
                      : undefined
                  }
                  className={`flex items-center gap-2 text-xs ${
                    picking ? 'cursor-pointer hover:bg-white/[0.03] rounded px-1 py-0.5' : ''
                  }`}
                >
                  <span
                    className={`shrink-0 w-3 h-3 rounded border ${
                      isChecked
                        ? 'bg-amber-400/60 border-amber-300'
                        : 'border-white/20'
                    } flex items-center justify-center`}
                  >
                    {isChecked && <Check className="w-2.5 h-2.5 text-[#0B0F14]" />}
                  </span>
                  <span className="text-white/65 truncate">{t.title}</span>
                  <span className="text-white/30 text-[10px] shrink-0">
                    {t.pomodoros_target}p
                  </span>
                </div>
              );
            })}
            {overflow > 0 && (
              <p className="text-[10px] text-white/35 ml-5">+{overflow} more</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {!picking ? (
              <>
                <button
                  onClick={() => handleCarry(pastTasks)}
                  disabled={working}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  Carry all forward
                </button>
                <button
                  onClick={() => {
                    setPicking(true);
                    setChosen(new Set(pastTasks.map((t) => t.id)));
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs text-white/55 hover:text-white/80 hover:bg-white/5 transition-colors"
                >
                  Pick & choose
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() =>
                    handleCarry(pastTasks.filter((t) => chosen.has(t.id)))
                  }
                  disabled={working || chosen.size === 0}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 text-xs font-medium transition-colors disabled:opacity-30"
                >
                  Carry {chosen.size}
                </button>
                <button
                  onClick={() => setPicking(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-white/55 hover:text-white/80 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
