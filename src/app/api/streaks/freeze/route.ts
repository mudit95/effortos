import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rateLimitOrNull } from '@/lib/ratelimit';
import { getUserTimezone, todayKeyInTz, dateKeyInTz } from '@/lib/user-date';

/**
 * POST /api/streaks/freeze
 *
 * Manually freeze a calendar day to protect the user's streak.
 *
 * Body: { date?: 'today' | 'yesterday' }  (default: 'today')
 *
 * Behaviour:
 *   - Validates the user has at least one freeze token remaining.
 *   - Resolves the target date in the user's local timezone — never
 *     UTC, because streaks are always evaluated in the user's frame.
 *   - Honours the 24-hour retroactive window: yesterday is allowed
 *     as long as the request lands within the user's local "today."
 *     ('day before yesterday' or earlier is rejected — beyond the
 *     window the streak is gone and we keep the system honest.)
 *   - Calls the claim_freeze_token RPC for atomic insert + decrement.
 *     The function handles the UNIQUE-constraint race ("already
 *     frozen this day" → 23505 → friendly 409) and the no-tokens
 *     race (CHECK violation → 409).
 *
 * Response: { success: true, date, remaining_tokens, source: 'manual' }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: freeze writes hit a Postgres function. Light bucket
    // covers double-clicks + low-effort abuse without locking out a
    // user who's recovering from a slow connection.
    const blocked = await rateLimitOrNull(user.id, 'light');
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    // Whitelist the date selector. Anything else (typos, attempts to
    // pass arbitrary YYYY-MM-DD via this field) falls back to 'today'.
    // The retroactive window is exactly 24h; we don't expose deeper
    // backdating to keep the streak system trustworthy.
    const dateSelector: 'today' | 'yesterday' =
      body?.date === 'yesterday' ? 'yesterday' : 'today';

    // Resolve to a concrete YYYY-MM-DD in the user's local timezone.
    const tz = await getUserTimezone(supabase, user.id);
    const today = todayKeyInTz(tz);
    // dateKeyInTz signature is (tz, date) — argument order matters.
    // Yesterday in user-local time = now - 24h, then bucket into their zone.
    const targetDate = dateSelector === 'today'
      ? today
      : dateKeyInTz(tz, new Date(Date.now() - 24 * 60 * 60 * 1000));

    // Atomic claim via the migration-035 RPC. Service role because
    // (a) the RPC is SECURITY DEFINER but only granted to authenticated
    // + service_role; and (b) the audit trail in admin_actions (if we
    // add one later) is service-role-write.
    const service = createServiceClient();
    const { data, error } = await service.rpc('claim_freeze_token', {
      p_user_id: user.id,
      p_date: targetDate,
      p_source: 'manual',
    });

    if (error) {
      // RPC raises with HINT='no_tokens' when the bucket is exhausted.
      const hint = (error.hint || '').toLowerCase();
      const message = (error.message || '').toLowerCase();
      if (hint === 'no_tokens' || message.includes('no freeze tokens')) {
        return NextResponse.json(
          { error: 'No freeze tokens remaining. They replenish monthly.' },
          { status: 409 },
        );
      }
      // RPC raises with HINT='already_frozen' when (user, date) already
      // exists in streak_freezes — the user (or the cron) already
      // covered this day.
      if (hint === 'already_frozen' || message.includes('already frozen')) {
        return NextResponse.json(
          { error: 'That day is already frozen.' },
          { status: 409 },
        );
      }
      console.error('[Streaks Freeze] RPC error:', error);
      return NextResponse.json(
        { error: 'Could not freeze that day. Try again in a minute.' },
        { status: 500 },
      );
    }

    // RPC returns { freeze_id, remaining_tokens } as a single-row TABLE.
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      success: true,
      date: targetDate,
      remaining_tokens: row?.remaining_tokens ?? null,
      source: 'manual',
    });
  } catch (err) {
    console.error('[Streaks Freeze] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
