import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { todayKeyInTz, dateKeyInTz } from '@/lib/user-date';
import { recordCronRun } from '@/lib/cron-run-log';
import { concurrentMap } from '@/lib/concurrency';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/apply-streak-freezes
 *
 * Runs hourly. For each user whose local clock is currently in the
 * 23:00-00:59 window (catches the midnight transition), checks whether
 * their streak is at risk and consumes a freeze token to protect it.
 *
 * The atomic claim_freeze_token RPC (mig 035) handles the
 * insert+decrement+UNIQUE-race in a single transaction, so concurrent
 * runs of this cron and a user's manual /api/streaks/freeze can't
 * double-spend a token or double-cover a date.
 *
 * Auto-apply rules (per STREAK_FREEZES_DESIGN.md sign-offs):
 *   - Streak ≥ 3 days: protecting a 1-2 day streak masks the
 *     activation problem we'd rather solve at the source.
 *   - User has at least 1 freeze token remaining.
 *   - User has NO completed session today (user-local date) — if
 *     they completed a session, the streak isn't at risk.
 *   - The user's local time falls in the midnight transition window.
 *     We define that as 23:00-00:59 user-local; running hourly with
 *     this 2-hour window catches everyone exactly once per day even
 *     if a cron tick gets dropped.
 *   - Cap inside the cap: at most 1 auto-applied freeze per user per
 *     7-day rolling window. Pro users still have 3/month tokens
 *     available; this cap stops the cron from burning all 3 in week 1
 *     and leaving them defenceless for the rest of the month.
 *
 * Failure modes:
 *   - claim_freeze_token raises HINT='no_tokens' or 'already_frozen' →
 *     log and skip, those are expected race outcomes.
 *   - getUserTimezone returns the default (Asia/Kolkata) for a user
 *     with NULL timezone — fine; their nominal midnight is just
 *     anchored to IST until they pick one.
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = createServiceClient();
  const startedAt = Date.now();

  try {
    // ── 1. Fetch all candidates: users with timezone + tokens > 0 ──
    //
    // We pre-filter to freeze_tokens_remaining > 0 to avoid pulling
    // the whole user table. The streak math + per-user activity check
    // happens in-process below — moving it into SQL would be cleaner
    // but the join across (sessions, streak_freezes, profiles) gets
    // gnarly enough that the in-process pass is more readable.
    const { data: candidates, error: candidatesErr } = await supabase
      .from('profiles')
      .select('id, name, timezone, freeze_tokens_remaining, last_session_date')
      .gt('freeze_tokens_remaining', 0)
      .not('timezone', 'is', null);

    if (candidatesErr) {
      console.error('[apply-streak-freezes] candidates query failed:', candidatesErr);
      await recordCronRun('apply-streak-freezes', 'failure', {
        error: candidatesErr.message,
      });
      return NextResponse.json({ error: 'query failed' }, { status: 500 });
    }

    if (!candidates || candidates.length === 0) {
      await recordCronRun('apply-streak-freezes', 'success', { applied: 0, candidates: 0 });
      return NextResponse.json({ applied: 0, reason: 'no candidates' });
    }

    // Concurrency-bounded fan-out. Each per-user check does:
    //   - timezone arithmetic (Intl.DateTimeFormat — cheap)
    //   - 1-2 DB reads (sessions today, recent freezes)
    //   - optional 1 RPC call (claim_freeze_token)
    // Bounded at 8 to stay within Postgres connection limits without
    // throttling the wall clock unnecessarily.
    const APPLY_CONCURRENCY = 8;
    const MIDNIGHT_WINDOW_HOURS = [23, 0]; // 23:00-00:59 local
    const STREAK_FLOOR = 3;
    const RECENT_FREEZE_DAYS = 7;

    const results = await concurrentMap(candidates, APPLY_CONCURRENCY, async (user) => {
      const tz = user.timezone as string;
      const now = new Date();
      const todayLocal = todayKeyInTz(tz, now);

      // Local hour check: only proceed if this user is currently inside
      // the midnight transition window in their local timezone.
      const localHourStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      }).format(now);
      const localHour = parseInt(localHourStr, 10);
      if (!MIDNIGHT_WINDOW_HOURS.includes(localHour)) {
        return { kind: 'skipped' as const, reason: 'wrong-hour' };
      }

      // Has the user already completed a session today (local)?
      // If yes, the streak isn't at risk — nothing to do.
      // We use last_session_date as a fast path; if it equals today
      // we know there's a session. Otherwise we double-check sessions
      // table to handle users whose last_session_date may be stale.
      if (user.last_session_date === todayLocal) {
        return { kind: 'skipped' as const, reason: 'session-today' };
      }
      const yesterdayLocal = dateKeyInTz(tz, new Date(now.getTime() - 24 * 60 * 60 * 1000));

      // Compute the current streak length looking backward from
      // YESTERDAY (we know today is empty). We count consecutive days
      // with at least one completed session OR a covered freeze.
      // Cheap version: pull last 30 days of session-day buckets +
      // freeze-day rows for this user, then walk back day-by-day.
      const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [sessionsRes, freezesRes] = await Promise.all([
        supabase
          .from('sessions')
          .select('start_time')
          .eq('user_id', user.id)
          .eq('status', 'completed')
          .gte('start_time', since),
        supabase
          .from('streak_freezes')
          .select('date')
          .eq('user_id', user.id)
          .gte('date', dateKeyInTz(tz, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))),
      ]);

      const sessionDays = new Set<string>(
        (sessionsRes.data || []).map((s) =>
          dateKeyInTz(tz, new Date(s.start_time as string)),
        ),
      );
      const freezeDays = new Set<string>(
        (freezesRes.data || []).map((f) => f.date as string),
      );

      // Cap inside the cap: skip if a freeze was already auto-applied
      // for this user within the recent window. Prevents Pro users
      // from burning all 3 monthly tokens via the cron.
      const recentFreezeCutoff = dateKeyInTz(
        tz,
        new Date(now.getTime() - RECENT_FREEZE_DAYS * 24 * 60 * 60 * 1000),
      );
      let recentFreezeCount = 0;
      for (const d of freezeDays) {
        if (d >= recentFreezeCutoff) recentFreezeCount += 1;
      }
      if (recentFreezeCount >= 1) {
        return { kind: 'skipped' as const, reason: 'recent-freeze-cap' };
      }

      // Walk back from yesterday to count the streak. Stop on the
      // first day with neither a session nor a freeze.
      let streakLength = 0;
      let probeDate = yesterdayLocal;
      for (let i = 0; i < 365; i++) {
        if (sessionDays.has(probeDate) || freezeDays.has(probeDate)) {
          streakLength += 1;
          // walk back one more day
          const d = new Date(probeDate + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() - 1);
          probeDate = d.toISOString().slice(0, 10);
        } else {
          break;
        }
      }

      if (streakLength < STREAK_FLOOR) {
        return { kind: 'skipped' as const, reason: `streak-below-floor (${streakLength})` };
      }

      // Atomic claim: insert into streak_freezes + decrement
      // freeze_tokens_remaining as a single transaction. RPC handles
      // both races (UNIQUE collision, no-tokens collision).
      const { data: claimRes, error: claimErr } = await supabase.rpc(
        'claim_freeze_token',
        {
          p_user_id: user.id,
          p_date: todayLocal,
          p_source: 'auto',
        },
      );

      if (claimErr) {
        const hint = (claimErr.hint || '').toLowerCase();
        if (hint === 'no_tokens' || hint === 'already_frozen') {
          // Race-loss outcomes — expected, not fatal.
          return { kind: 'skipped' as const, reason: hint };
        }
        console.error('[apply-streak-freezes] claim error:', user.id, claimErr);
        return { kind: 'failed' as const, error: claimErr.message };
      }

      const remaining = Array.isArray(claimRes)
        ? claimRes[0]?.remaining_tokens
        : (claimRes as { remaining_tokens?: number } | null)?.remaining_tokens;

      return {
        kind: 'applied' as const,
        userId: user.id,
        streakLength,
        remainingTokens: remaining ?? null,
      };
    });

    let applied = 0;
    let skipped = 0;
    let failed = 0;
    for (const r of results) {
      if (!r.ok) {
        failed += 1;
        continue;
      }
      const v = r.value;
      if (v.kind === 'applied') applied += 1;
      else if (v.kind === 'skipped') skipped += 1;
      else failed += 1;
    }

    const elapsedMs = Date.now() - startedAt;
    await recordCronRun('apply-streak-freezes', failed === 0 ? 'success' : 'failure', {
      candidates: candidates.length,
      applied,
      skipped,
      failed,
      elapsedMs,
    });

    return NextResponse.json({
      candidates: candidates.length,
      applied,
      skipped,
      failed,
      elapsedMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[apply-streak-freezes] threw:', err);
    await recordCronRun('apply-streak-freezes', 'failure', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
