import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns today's date as YYYY-MM-DD in the user's LOCAL timezone.
 * Using toISOString().split('T')[0] returns UTC which is wrong
 * for users east of UTC after midnight local time.
 */
export function getLocalTodayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Converts a Date to YYYY-MM-DD in the user's LOCAL timezone.
 */
export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeDate(date: string | Date): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
  if (diffDays <= 7) return `${diffDays} days`;
  if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks`;
  return `${Math.ceil(diffDays / 30)} months`;
}

export function sessionsToHours(sessions: number): number {
  return Math.round((sessions * 25 / 60) * 10) / 10;
}

export function hoursToSessions(hours: number): number {
  return Math.round(hours * 60 / 25);
}

export function clampBias(value: number): number {
  return Math.max(-2, Math.min(2, value));
}

export function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

export function getStreaks(dailySessions: { date: string; count: number }[]): { current: number; longest: number } {
  if (!dailySessions.length) return { current: 0, longest: 0 };

  const sorted = [...dailySessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  let current = 0;
  let longest = 0;
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < sorted.length; i++) {
    const sessionDate = new Date(sorted[i].date);
    sessionDate.setHours(0, 0, 0, 0);
    const expectedDate = new Date(today);
    expectedDate.setDate(expectedDate.getDate() - i);
    expectedDate.setHours(0, 0, 0, 0);

    if (sessionDate.getTime() === expectedDate.getTime() && sorted[i].count > 0) {
      streak++;
      if (i === 0 || streak > 0) current = streak;
    } else {
      break;
    }
  }

  // Calculate longest streak
  streak = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].count > 0) {
      streak++;
      longest = Math.max(longest, streak);
    } else {
      streak = 0;
    }
  }

  return { current, longest };
}

/**
 * Freeze-aware streak math. Same return shape as getStreaks but walks
 * the calendar treating freeze dates as "covered" instead of breaking
 * the streak. See `STREAK_FREEZES_DESIGN.md` for the contract.
 *
 * Inputs:
 *   - dailySessions: array of `{ date: 'YYYY-MM-DD', count: number }`.
 *     Same shape getStreaks uses, but THIS function tolerates a sparse
 *     array (only days with count > 0 need to appear) — internally we
 *     project to a Set so day-i lookups are O(1).
 *   - freezeDates: Set of 'YYYY-MM-DD' strings. Each entry covers a
 *     single calendar day; the streak walks past it as if the user
 *     had logged a session.
 *   - todayLocal (optional): override for testing — pass an explicit
 *     'YYYY-MM-DD' string to anchor the walk. Defaults to today's
 *     local date via toLocaleDateString. Tests need this because
 *     `new Date()` is impure; production callers can omit.
 *
 * Behaviour:
 *   - Current streak: walk back from today; +1 for each day that has
 *     either a session OR a freeze; break on the first day that has
 *     neither.
 *   - Longest streak: scan all known days (sessions ∪ freezes) sorted
 *     ascending; track the longest contiguous run.
 *   - A freeze on a day that ALREADY has a session is a no-op (the
 *     day was covered anyway). Doesn't double-count.
 *   - A freeze BEFORE the first session day in history doesn't start
 *     a new streak by itself — streaks need at least one real session
 *     somewhere in the run, otherwise we'd hand out 30-day "streaks"
 *     to users who only used freeze tokens.
 */
export function getStreaksWithFreezes(
  dailySessions: { date: string; count: number }[],
  freezeDates: ReadonlySet<string>,
  todayLocal?: string,
): { current: number; longest: number } {
  // Build O(1) lookups. Sessions with count > 0 are "real" days;
  // anything else is treated as no-session even if the row exists
  // (matches existing getStreaks semantics).
  const realSessionDays = new Set(
    dailySessions.filter((d) => d.count > 0).map((d) => d.date),
  );
  if (realSessionDays.size === 0 && freezeDates.size === 0) {
    return { current: 0, longest: 0 };
  }

  // Anchor: today's local-calendar date as 'YYYY-MM-DD'. We rely on
  // the caller's local frame because streaks are always evaluated
  // there; UTC-anchored math would mis-bucket sessions logged near
  // midnight in non-UTC zones.
  const today = todayLocal ?? localDateKey(new Date());

  // ── Current streak: walk back from today. ───────────────────────
  // First, the "no break yet" check at i=0: today must be either a
  // session day OR a freeze day to have any current streak at all.
  let current = 0;
  // Track whether the run we're building has at least one real
  // session — pure-freeze runs don't qualify as streaks.
  let runHasRealSession = realSessionDays.has(today);
  for (let i = 0; ; i++) {
    const probe = addDaysIso(today, -i);
    const isReal = realSessionDays.has(probe);
    const isFreeze = freezeDates.has(probe);
    if (isReal || isFreeze) {
      current += 1;
      if (isReal) runHasRealSession = true;
    } else {
      break;
    }
    // Safety: cap at 10 years in the past so a corrupt freeze table
    // can't loop forever.
    if (i > 365 * 10) break;
  }
  // If the entire run was freezes only, no current streak.
  if (!runHasRealSession) current = 0;

  // ── Longest streak: scan sessions ∪ freezes ascending. ──────────
  // Build the union as a sorted ISO-date array. Walk and track
  // contiguous-run length. A run that contains zero real sessions
  // is discarded — same "freeze-only doesn't count" rule.
  const allDays = Array.from(new Set<string>([...realSessionDays, ...freezeDates])).sort();
  let longest = 0;
  let runLength = 0;
  let runReal = false;
  let prev: string | null = null;
  for (const day of allDays) {
    if (prev === null || addDaysIso(prev, 1) === day) {
      runLength += 1;
      if (realSessionDays.has(day)) runReal = true;
    } else {
      // Gap. Close out the previous run (if it had a real session)
      // and start a new one.
      if (runReal) longest = Math.max(longest, runLength);
      runLength = 1;
      runReal = realSessionDays.has(day);
    }
    prev = day;
  }
  if (runReal) longest = Math.max(longest, runLength);
  // Also fold in `current` — the walk-back loop captures runs that
  // extend up to today, which the ascending pass also handles, but
  // belt-and-braces guards against any edge case (e.g., today's
  // freeze with the union scan ending one day prior).
  longest = Math.max(longest, current);

  return { current, longest };
}

/** Format a Date as 'YYYY-MM-DD' in local time. Used by streak math
 *  and the lapse-recovery flow to consistently key by local-calendar
 *  day regardless of the JS Date's underlying UTC offset. */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add `delta` days to an ISO-date string ('YYYY-MM-DD'). Negative
 *  delta walks backward. Stays in local-calendar frame so DST
 *  transitions don't cause day-skipping. */
function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + delta);
  return localDateKey(dt);
}
