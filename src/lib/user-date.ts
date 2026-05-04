import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Timezone-correct date helpers for server-side code.
 *
 * The WhatsApp bot, cron jobs, and anywhere else we need to bucket rows
 * under "today" must use the USER'S local date, not the server's UTC date.
 * If you call `new Date().toISOString().split('T')[0]` from a Vercel server
 * at 12:30 AM IST, you get "yesterday" in UTC and tasks get filed under the
 * wrong day — the exact bug this module fixes.
 */

const DEFAULT_TZ = 'Asia/Kolkata';

/**
 * Format a Date as YYYY-MM-DD in the given IANA timezone.
 * Uses the `en-CA` locale because it prints ISO-style dates natively
 * (`2026-04-17` instead of `4/17/2026`).
 */
export function todayKeyInTz(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  } catch {
    // Invalid timezone string — fall back to the default rather than UTC.
    return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ }).format(now);
  }
}

/**
 * Returns the offset of `date` in the given timezone, as a YYYY-MM-DD string.
 * Useful for "N days ago in user's local time" — pass a shifted Date and get
 * back the right date key in their zone.
 */
export function dateKeyInTz(tz: string, date: Date): string {
  return todayKeyInTz(tz, date);
}

/**
 * Fetches the user's timezone from their profile row, with a sane default.
 * Cached-friendly: callers are expected to call this once per request and
 * reuse the result for all subsequent date math.
 */
export async function getUserTimezone(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle();
  return data?.timezone || DEFAULT_TZ;
}

/**
 * Convenience: look up the user's timezone and compute today's date key in it.
 * One-call wrapper for the most common case.
 */
export async function getUserTodayKey(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const tz = await getUserTimezone(supabase, userId);
  return todayKeyInTz(tz);
}

/**
 * Returns the ISO-style YYYY-MM-DD for the Monday of the week containing
 * `now`, in the given IANA timezone.
 *
 * "Week" here is Monday-start (ISO 8601), not Sunday-start. Most of our
 * dashboard copy implicitly assumes a Mon-Sun work-week (Sunday is the
 * weekly recap day). Callers wanting a Sunday-start week can roll their
 * own — this helper exists for the canonical case.
 *
 * Implementation note: Intl.DateTimeFormat doesn't expose day-of-week
 * in a single call, so we format the parts and walk back to Monday in
 * the SAME timezone the format used. Doing the math in JS Date space
 * (with subtractions) breaks across DST boundaries because JS Date
 * arithmetic is in UTC and the user's local "Monday" might be a
 * different UTC date than ours.
 */
export function weekStartKeyInTz(tz: string, now: Date = new Date()): string {
  // Resolve the user-local date parts directly via Intl. This sidesteps
  // any DST / offset surprises from Date arithmetic in JS.
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TZ,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  }
  const weekdayMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const yearPart = parts.find((p) => p.type === 'year')?.value ?? '';
  const monthPart = parts.find((p) => p.type === 'month')?.value ?? '';
  const dayPart = parts.find((p) => p.type === 'day')?.value ?? '';
  const daysSinceMonday = weekdayMap[weekdayPart] ?? 0;

  // Construct a Date at noon on the user-local day (noon is safely
  // inside the user-local calendar day on every timezone, so any
  // arithmetic stays on-day). Then subtract daysSinceMonday and re-
  // format in the user's timezone.
  const userLocalNoon = new Date(`${yearPart}-${monthPart}-${dayPart}T12:00:00Z`);
  const monday = new Date(userLocalNoon.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(monday);
}
