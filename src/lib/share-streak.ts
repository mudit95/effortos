/**
 * Server-only helpers for resolving streak share tokens.
 *
 * The public page at /share/streak/[token] and the OG image generator
 * at /share/streak/[token]/opengraph-image both need the same data:
 * given a token, look up the owner, compute their freeze-aware streaks
 * and basic display fields. Centralised here so the two callers stay
 * in lockstep — divergence between the rendered page and the OG card
 * is the kind of bug that ships unnoticed for weeks.
 *
 * Privacy:
 *   - Only the OWNER's first name is exposed publicly. Email is never
 *     sent to the client / OG renderer.
 *   - We never expose task titles, journal content, goal names — only
 *     the streak counts. Streaks are the most-shareable Pomodoro
 *     artefact precisely because they leak nothing about WHAT the user
 *     was working on.
 *
 * Caching:
 *   - The page is statically rendered with `dynamic = 'force-dynamic'`
 *     so each request hits this code; we deliberately don't cache here
 *     because (a) streaks change daily and (b) revocation needs to be
 *     immediate. Tokens are 32-char crypto-random so guess-resistance
 *     does the heavy lifting; a short response time matters more than
 *     edge caching for this path.
 */

import { createServiceClient } from '@/lib/supabase/service';
import { getStreaksWithFreezes } from '@/lib/utils';

export interface StreakShareData {
  /** First name of the share owner — what we display publicly. */
  firstName: string;
  /** Current streak (freeze-aware). */
  currentStreak: number;
  /** Longest streak (freeze-aware). */
  longestStreak: number;
  /** ISO date the user joined (their first session, or profile creation if no sessions). */
  joinedDate: string;
  /** Total focus minutes lifetime. Big-number flex; never per-day breakdown. */
  totalFocusMinutes: number;
}

export type StreakShareResult =
  | { status: 'ok'; data: StreakShareData }
  | { status: 'not_found' }
  | { status: 'revoked' };

/**
 * Resolve a streak share token to public-safe display data.
 *
 * @param token Opaque 32-char share token from the URL.
 * @returns ok + data, not_found (token doesn't exist), or revoked.
 */
export async function resolveStreakShareToken(
  token: string,
): Promise<StreakShareResult> {
  if (!token || typeof token !== 'string' || token.length < 16 || token.length > 96) {
    return { status: 'not_found' };
  }

  const service = createServiceClient();

  // Look up the token. Service role bypasses RLS so we can read
  // revoked rows too — needed to distinguish "doesn't exist" from
  // "was active, now revoked" so the public page can show the right
  // empty-state copy.
  const { data: tokenRow } = await service
    .from('share_tokens')
    .select('user_id, kind, revoked_at')
    .eq('token', token)
    .eq('kind', 'streak')
    .maybeSingle();

  if (!tokenRow) return { status: 'not_found' };
  if (tokenRow.revoked_at) return { status: 'revoked' };

  const userId = tokenRow.user_id as string;

  // Owner's display name — first name only.
  const { data: profile } = await service
    .from('profiles')
    .select('name, created_at')
    .eq('id', userId)
    .maybeSingle();

  const fullName: string = (profile?.name as string | undefined) || 'Someone';
  const firstName = fullName.split(' ')[0] || fullName;

  // Sessions — pull all completed sessions in the last ~3 years to
  // compute streak counts. Sessions far older than that don't affect
  // CURRENT streak (would have been broken long ago) and the longest
  // streak runs through whatever range we hand it; 3 years is a
  // generous ceiling that keeps the query small even for power users.
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const [sessionsRes, freezesRes] = await Promise.all([
    service
      .from('sessions')
      .select('start_time, duration')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('start_time', threeYearsAgo)
      .order('start_time', { ascending: true }),
    service
      .from('streak_freezes')
      .select('date')
      .eq('user_id', userId),
  ]);

  type Session = { start_time: string; duration: number | null };
  type Freeze = { date: string };

  const sessions: Session[] = (sessionsRes.data ?? []) as Session[];
  const freezes: Freeze[] = (freezesRes.data ?? []) as Freeze[];

  // Group sessions by local-date for streak math. We use UTC date as a
  // pragmatic approximation here — the public page can't know the
  // owner's timezone without exposing it, and most streak boundaries
  // align well enough with UTC for the +/- 24-hour user bases we serve.
  // The owner's own dashboard uses true user-local dates; this page is
  // a public read of approximate counts, not an accounting record.
  const dailyCounts = new Map<string, number>();
  for (const s of sessions) {
    const d = new Date(s.start_time).toISOString().slice(0, 10);
    dailyCounts.set(d, (dailyCounts.get(d) ?? 0) + 1);
  }
  const dailySessions = Array.from(dailyCounts.entries()).map(([date, count]) => ({
    date,
    count,
  }));
  const freezeDates = new Set(freezes.map((f) => f.date));

  const streaks = getStreaksWithFreezes(dailySessions, freezeDates);

  const totalFocusSeconds = sessions.reduce(
    (a, s) => a + (typeof s.duration === 'number' ? s.duration : 0),
    0,
  );
  const totalFocusMinutes = Math.round(totalFocusSeconds / 60);

  // Joined date: earliest session, falling back to profile.created_at
  // if the user has never run a session (rare on a public share, but
  // defensive — we'd otherwise NPE on the page).
  const firstSession = sessions[0];
  const joinedDate =
    firstSession?.start_time?.slice(0, 10) ??
    ((profile?.created_at as string | undefined) ?? new Date().toISOString()).slice(0, 10);

  return {
    status: 'ok',
    data: {
      firstName,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      joinedDate,
      totalFocusMinutes,
    },
  };
}

/** "May 2026" — for "started in {month year}" copy. */
export function formatJoinedMonth(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
