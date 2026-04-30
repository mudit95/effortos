/**
 * Per-user data-creation caps.
 *
 * The audit flagged unbounded INSERT vectors: a scripted attacker logged
 * in with one account can create 10,000 daily_tasks, 50,000 sessions,
 * a million journal entries — all server-side blowups that retention-sweep
 * doesn't help with (these tables are user-owned and DON'T get pruned).
 *
 * These caps target abuse, not legitimate power users. Numbers chosen
 * by walking the 99th-percentile real usage:
 *
 *   goals (active+paused)  : 50    — even hardcore users keep <10
 *   daily_tasks per day    : 200   — power user 30, manic week 80
 *   sessions per day       : 50    — 25-min × 50 = 20+ wake hours/day
 *
 * Helpers return `{ ok: true }` on success, `{ ok: false, reason, status }`
 * on cap-hit. Caller translates to a 4xx response.
 *
 * Service role can bypass — the cron handlers + admin endpoints don't
 * need to hit caps for legitimate batch operations.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const DATA_CAPS = {
  // Total goals where status IN ('active','paused'). 'completed' and
  // 'abandoned' don't count — those are historical record.
  ACTIVE_GOALS_PER_USER: 50,
  // daily_tasks rows for a given (user_id, date).
  TASKS_PER_DAY: 200,
  // sessions rows where start_time falls in a single user-local day.
  SESSIONS_PER_DAY: 50,
} as const;

export interface CapOk { ok: true }
export interface CapHit {
  ok: false;
  reason: string;
  status: number;
}

/** Check active+paused goal count. Pass before INSERT into goals. */
export async function checkActiveGoalsCap(
  supabase: SupabaseClient,
  userId: string,
): Promise<CapOk | CapHit> {
  const { count, error } = await supabase
    .from('goals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['active', 'paused']);
  if (error) {
    // Fail-open on read errors — better to let one extra goal slip through
    // than to brick the user's onboarding because the count query 500'd.
    console.warn('[dataCaps] active goals count failed (allowing):', error);
    return { ok: true };
  }
  if ((count ?? 0) >= DATA_CAPS.ACTIVE_GOALS_PER_USER) {
    return {
      ok: false,
      reason: `Active goal limit reached (${DATA_CAPS.ACTIVE_GOALS_PER_USER}). Complete or abandon a goal to add a new one.`,
      status: 409,
    };
  }
  return { ok: true };
}

/** Check daily_tasks count for a given user+date. Pass before insert. */
export async function checkTasksPerDayCap(
  supabase: SupabaseClient,
  userId: string,
  date: string, // YYYY-MM-DD
): Promise<CapOk | CapHit> {
  const { count, error } = await supabase
    .from('daily_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('date', date);
  if (error) {
    console.warn('[dataCaps] tasks/day count failed (allowing):', error);
    return { ok: true };
  }
  if ((count ?? 0) >= DATA_CAPS.TASKS_PER_DAY) {
    return {
      ok: false,
      reason: `Task limit reached for ${date} (${DATA_CAPS.TASKS_PER_DAY}). Mark some complete or move them to another day.`,
      status: 409,
    };
  }
  return { ok: true };
}

/**
 * Check sessions count for the calendar day surrounding `now` in the
 * user's local zone. We pass userTodayKey explicitly (caller has it already
 * via user-date.ts) to avoid an extra DB roundtrip for the zone lookup.
 */
export async function checkSessionsPerDayCap(
  supabase: SupabaseClient,
  userId: string,
  userTodayKey: string, // YYYY-MM-DD in the user's local zone
): Promise<CapOk | CapHit> {
  // sessions.start_time is timestamptz; we filter by ISO string range
  // covering the user's local day. This matches the cron-helpers pattern
  // (see lib/cron-helpers.ts getUserDaySummary).
  const start = `${userTodayKey}T00:00:00Z`;
  const end = `${userTodayKey}T23:59:59.999Z`;
  const { count, error } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('start_time', start)
    .lt('start_time', end);
  if (error) {
    console.warn('[dataCaps] sessions/day count failed (allowing):', error);
    return { ok: true };
  }
  if ((count ?? 0) >= DATA_CAPS.SESSIONS_PER_DAY) {
    return {
      ok: false,
      reason: `Session limit reached for today (${DATA_CAPS.SESSIONS_PER_DAY}). Take a break — that's a lot.`,
      status: 409,
    };
  }
  return { ok: true };
}
