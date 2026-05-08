/**
 * Beast Mode — pro-gated, opt-in evening escalation.
 *
 * Goal: until the user has (a) journaled today and (b) planned at least
 * one task for tomorrow, ping them on WhatsApp every 30 minutes between
 * 20:00 and 23:30 local time. Once both conditions are satisfied, stop
 * pinging until tomorrow.
 *
 * This module exposes the pure functions; the actual cron loop lives at
 * /api/cron/beast-mode/route.ts.
 *
 * Why per-kind rather than a single "you're behind" nudge:
 * users react differently to "you haven't journaled" vs "you haven't
 * planned tomorrow". The two prompts have different verbs, and bundling
 * them risks the user dismissing one while ignoring the other. We send
 * them as separate WA messages with their own 30-minute cadence each.
 */

import { todayKeyInTz, dateKeyInTz } from '@/lib/user-date';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export type BeastNudgeKind = 'plan_tomorrow' | 'journal_today';

export interface BeastUser {
  id: string;
  name: string;
  phone_number: string;
  timezone: string;
  coaching_paused_until: string | null;
  /** Pro tier check happens upstream — this list is already filtered. */
}

/** Hard window: don't ping outside 20:00–23:30 local. Quiet-hour rules
 *  keep beast mode from waking the user. The morning re-window (07:00+)
 *  is intentionally NOT covered — beast is an EVENING enforcement loop;
 *  if the user wants morning planning, the morning email already nags. */
export const BEAST_WINDOW_START_HOUR = 20;
/** Window end is 23:30 — we encode this as a half-hour by checking
 *  hour === 23 && minutes < 30 separately in shouldFireForUser. */
export const BEAST_WINDOW_END_HOUR = 23;
export const BEAST_WINDOW_END_MINUTE = 30;

/** Minimum gap between two beast nudges of the SAME kind for the same
 *  user. The cron itself runs every 30 min, so this is "send each tick
 *  unless we already sent in the prior tick" — which is what we want. */
export const BEAST_DEBOUNCE_MINUTES = 25;

/**
 * Compute the user's local hour + minute. Returns null if the timezone
 * string is malformed (we treat that as "skip this user" rather than
 * pinging at the wrong wall-clock time).
 */
export function localHourMinute(
  tz: string,
  now: Date = new Date(),
): { hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
    const minutePart = parts.find((p) => p.type === 'minute')?.value ?? '0';
    const hour = parseInt(hourPart, 10);
    const minute = parseInt(minutePart, 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return { hour, minute };
  } catch {
    return null;
  }
}

/**
 * Is `now` inside the user's beast-mode evening window? (20:00–23:30 local)
 * Returns false outside the window, on bad timezone, or while coaching
 * is explicitly paused via the in-chat "shh" command.
 */
export function shouldFireForUser(
  user: BeastUser,
  now: Date = new Date(),
): boolean {
  if (user.coaching_paused_until) {
    const pausedUntil = new Date(user.coaching_paused_until).getTime();
    if (pausedUntil > now.getTime()) return false;
  }
  const lhm = localHourMinute(user.timezone, now);
  if (!lhm) return false;
  const { hour, minute } = lhm;
  if (hour < BEAST_WINDOW_START_HOUR) return false;
  if (hour > BEAST_WINDOW_END_HOUR) return false;
  // 23:30 is the hard cap — encode the minute boundary on the last hour.
  if (hour === BEAST_WINDOW_END_HOUR && minute >= BEAST_WINDOW_END_MINUTE) {
    return false;
  }
  return true;
}

/**
 * For a given user, figure out which conditions are unsatisfied right
 * now: tomorrow has 0 tasks → 'plan_tomorrow' is missing; today has no
 * journal entry with non-empty content → 'journal_today' is missing.
 */
export async function evaluateMissingChecks(
  supabase: SupabaseClient,
  user: BeastUser,
  now: Date = new Date(),
): Promise<BeastNudgeKind[]> {
  const tz = user.timezone || 'Asia/Kolkata';
  const todayLocal = todayKeyInTz(tz, now);
  const tomorrowLocal = (() => {
    // Step one calendar day forward AT NOON LOCAL to avoid DST edges.
    // Take the user's local "today" as a Date in local-noon, add 24h,
    // re-render in tz. Cheaper to just bump the date string than do
    // tz-aware arithmetic.
    const d = new Date(`${todayLocal}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return dateKeyInTz('UTC', d); // d is at UTC noon of tomorrow.
  })();

  const missing: BeastNudgeKind[] = [];

  // ── Tomorrow's plan ────────────────────────────────────────────
  // We just need to know "is the count > 0?" — head:true + count:'exact'
  // returns a count without pulling rows. Cheap.
  const { count: tomorrowTaskCount, error: taskErr } = await supabase
    .from('daily_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('date', tomorrowLocal);
  if (taskErr) {
    console.error('[beast-mode] tomorrow_plan check failed', { userId: user.id, taskErr });
    // Fail closed: we'd rather skip the nudge than ping based on a
    // false-missing read. The next 30-min tick will retry.
  } else if ((tomorrowTaskCount ?? 0) === 0) {
    missing.push('plan_tomorrow');
  }

  // ── Today's journal ────────────────────────────────────────────
  // The journal_entries unique constraint guarantees at most one row
  // per user-day, so .maybeSingle() is correct here. We treat an empty
  // content string ('') the same as no entry — the user creating a
  // blank entry shouldn't satisfy beast mode.
  const { data: journalRow, error: journalErr } = await supabase
    .from('journal_entries')
    .select('content')
    .eq('user_id', user.id)
    .eq('date', todayLocal)
    .maybeSingle();
  if (journalErr) {
    console.error('[beast-mode] journal check failed', { userId: user.id, journalErr });
  } else {
    const content = (journalRow?.content ?? '').trim();
    if (content.length === 0) missing.push('journal_today');
  }

  return missing;
}

/**
 * Has the same beast nudge-kind been sent to this user in the last
 * BEAST_DEBOUNCE_MINUTES? If yes, the caller should skip — beast mode
 * pings every 30 minutes by design, but we never want a runaway double-
 * fire when the cron retries within the same window.
 */
export async function recentBeastNudgeExists(
  supabase: SupabaseClient,
  userId: string,
  nudgeKind: BeastNudgeKind,
  now: Date = new Date(),
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - BEAST_DEBOUNCE_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('beast_nudge_log')
    .select('id')
    .eq('user_id', userId)
    .eq('nudge_kind', nudgeKind)
    .gte('created_at', cutoff)
    .limit(1)
    .maybeSingle();
  if (error) {
    // Fail closed — assume already-sent so we don't spam. A truly broken
    // table is bigger than one missed nudge.
    console.error('[beast-mode] dedup query failed', { userId, nudgeKind, error });
    return true;
  }
  return data !== null;
}

/**
 * Persist a beast nudge attempt. Called AFTER the WhatsApp send
 * regardless of success — we want the audit trail to show "we tried"
 * even if Meta rejected.
 */
export async function recordBeastNudge(
  supabase: SupabaseClient,
  opts: { userId: string; nudgeKind: BeastNudgeKind; messageSent: string; delivered: boolean },
): Promise<void> {
  const { error } = await supabase.from('beast_nudge_log').insert({
    user_id: opts.userId,
    nudge_kind: opts.nudgeKind,
    message_sent: opts.messageSent,
    delivered: opts.delivered,
  });
  if (error) {
    console.error('[beast-mode] log insert failed', { userId: opts.userId, error });
  }
}

// ── Message copy ────────────────────────────────────────────────────

/** First-line emoji + label per kind. Persona-aware copy lives in the
 *  cron route — these are the always-the-same intro lines. */
export function beastMessage(kind: BeastNudgeKind, name: string): string {
  const fn = name.split(' ')[0] || 'you';
  if (kind === 'plan_tomorrow') {
    return [
      `🛡️ Beast mode — ${fn}, tomorrow is empty.`,
      `Reply with the 1-3 things you want to ship tomorrow and I'll add them. Even one is enough to break the nag.`,
      `(I'll keep checking every 30 min until 23:30.)`,
    ].join('\n');
  }
  return [
    `🛡️ Beast mode — ${fn}, no journal entry yet for today.`,
    `Reply with even one line about how today went. A score (great/good/meh/rough/hard) + a sentence is plenty.`,
    `(I'll keep checking every 30 min until 23:30.)`,
  ].join('\n');
}
