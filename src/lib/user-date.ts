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
