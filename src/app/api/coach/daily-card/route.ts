import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getUserTimezone, todayKeyInTz } from '@/lib/user-date';
import { ensureAiQuota, getUserAiTier, recordAiUsage } from '@/lib/aiQuota';
import { generateDailyCardAi, type DailyCardStats } from '@/lib/coach-ai';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * GET /api/coach/daily-card
 *
 * Returns today's daily card for the calling user. Cached one-per-(user,
 * date) in the daily_cards table (mig 037).
 *
 * Behaviour:
 *   - Free tier: descriptive stats only. No AI call. ai_suggestion = null.
 *   - Pro tier: descriptive + an AI-generated one-line suggestion. Single
 *     Claude call per user per day, gated by aiQuota. Subsequent loads
 *     same day read from the cache.
 *
 * Cache:
 *   - We always write a row on first call of the day (descriptive only
 *     for free, descriptive + ai_suggestion for Pro). Re-reads bypass
 *     the assemble-stats step entirely.
 *   - UNIQUE(user_id, date) on the table (mig 037) means a race between
 *     two concurrent requests resolves cleanly: the second's INSERT
 *     fails 23505 and falls through to a re-SELECT.
 *
 * Rate limit:
 *   - Light bucket on this endpoint (20/hr) — protects the AI call from
 *     a runaway client even when most opens hit the cache.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const blocked = await rateLimitOrNull(user.id, 'light');
    if (blocked) return blocked;

    const tz = await getUserTimezone(supabase, user.id);
    const today = todayKeyInTz(tz);

    // ── Cache hit fast path ────────────────────────────────────────
    const { data: cached } = await supabase
      .from('daily_cards')
      .select('descriptive, ai_suggestion, created_at')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle();

    if (cached) {
      return NextResponse.json({
        date: today,
        cached: true,
        descriptive: cached.descriptive,
        ai_suggestion: cached.ai_suggestion,
      });
    }

    // ── Cache miss — assemble stats ───────────────────────────────
    // Pull the data we need to build the descriptive object. All
    // queries are user-scoped via RLS; we use the auth-bound client
    // so the user sees only their own data.
    const startOfDay = new Date(today + 'T00:00:00').toISOString();
    const endOfDay = new Date(
      new Date(today + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();

    const [sessionsRes, tasksRes, journalRes, statsRes, goalsRes] = await Promise.all([
      supabase
        .from('sessions')
        .select('duration')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('start_time', startOfDay)
        .lt('start_time', endOfDay),
      supabase
        .from('daily_tasks')
        .select('completed')
        .eq('user_id', user.id)
        .eq('date', today),
      supabase
        .from('journal_entries')
        .select('mood')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle(),
      // current_streak: cheapest source is the dashboardStats row that
      // refreshDashboard already maintains, but server-side we'd have
      // to compute it. For the daily card we use a quick approximation:
      // count distinct days with completed sessions in the past 30
      // days, walked back from today. Same as getStreaks() does in
      // lib/utils.
      supabase
        .from('sessions')
        .select('start_time')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('start_time', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from('goals')
        .select('id, sessions_completed, estimated_sessions_current, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // Focus minutes: sessions.duration is stored in seconds.
    const focusSeconds = (sessionsRes.data ?? []).reduce(
      (a, s) => a + ((s.duration as number) || 0),
      0,
    );
    const focusMinutes = Math.round(focusSeconds / 60);
    const sessionsCompleted = sessionsRes.data?.length ?? 0;

    const tasks = tasksRes.data ?? [];
    const tasksTotal = tasks.length;
    const tasksCompleted = tasks.filter((t) => t.completed).length;
    const completionRate = tasksTotal > 0 ? tasksCompleted / tasksTotal : NaN;

    const mood = (journalRes.data?.mood as string | null) ?? null;

    // Streak: walk back from today, +1 for each consecutive
    // user-local-day with at least one completed session. Stop on
    // first day with zero. Cheap O(days_with_activity) approximation.
    const dayKeys = new Set<string>();
    for (const s of statsRes.data ?? []) {
      const d = new Date(s.start_time as string);
      // Bucket by user-local YYYY-MM-DD.
      dayKeys.add(
        new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d),
      );
    }
    let currentStreak = 0;
    {
      const probe = new Date(today + 'T00:00:00');
      for (let i = 0; i < 30; i++) {
        const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(probe);
        if (dayKeys.has(key)) {
          currentStreak += 1;
          probe.setDate(probe.getDate() - 1);
        } else {
          break;
        }
      }
    }

    const goal = goalsRes.data;
    const activeGoalPct =
      goal && (goal.estimated_sessions_current as number) > 0
        ? Math.round(
            ((goal.sessions_completed as number) /
              (goal.estimated_sessions_current as number)) *
              100,
          )
        : null;

    const descriptive = {
      focus_minutes: focusMinutes,
      sessions_completed: sessionsCompleted,
      tasks_completed: tasksCompleted,
      tasks_total: tasksTotal,
      completion_rate: isNaN(completionRate) ? null : completionRate,
      mood,
      current_streak: currentStreak,
      active_goal_pct: activeGoalPct,
    };

    // ── AI suggestion — Pro only ──────────────────────────────────
    let aiSuggestion: string | null = null;
    let tokensUsed = 0;

    const aiTier = await getUserAiTier(supabase, user.id);
    const isProTier = aiTier === 'pro';

    if (isProTier) {
      // Quota check before the AI call. If exhausted, we still write
      // the descriptive row — the dashboard renders it without the
      // suggestion line for the rest of the day.
      const quota = await ensureAiQuota(user.id, 'pro');
      if (quota.ok) {
        // Build the user's first name once.
        const { data: profile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .maybeSingle();
        const userName = (profile?.name as string | null) ?? 'there';

        const stats: DailyCardStats = {
          focusMinutes,
          sessionsCompleted,
          tasksCompleted,
          tasksTotal,
          completionRate: isNaN(completionRate) ? 0 : completionRate,
          mood,
          currentStreak,
          activeGoalPct,
          userName,
        };

        const ai = await generateDailyCardAi(stats);
        aiSuggestion = ai.suggestion;
        tokensUsed = ai.inputTokens + ai.outputTokens;

        // Record token usage in the per-user daily bucket. Previously
        // we passed `output_tokens: tokensUsed` (the SUM), which under-
        // counted spend by the input portion — quota math drifted.
        // Now we pass the real input/output split.
        if (tokensUsed > 0) {
          await recordAiUsage(user.id, {
            input_tokens: ai.inputTokens,
            output_tokens: ai.outputTokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          });
        }
      }
    }

    // ── Write the card via service role (table is service-role-write) ──
    const service = createServiceClient();
    const { error: insertErr } = await service.from('daily_cards').insert({
      user_id: user.id,
      date: today,
      descriptive,
      ai_suggestion: aiSuggestion,
      ai_tokens_used: tokensUsed,
    });

    // 23505 = UNIQUE collision (race with a parallel request).
    // Re-read and return the winning row's contents.
    if (insertErr && insertErr.code === '23505') {
      const { data: settled } = await supabase
        .from('daily_cards')
        .select('descriptive, ai_suggestion')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle();
      if (settled) {
        return NextResponse.json({
          date: today,
          cached: true,
          descriptive: settled.descriptive,
          ai_suggestion: settled.ai_suggestion,
        });
      }
    } else if (insertErr) {
      // Non-unique error — log and return the just-computed values
      // anyway so the user sees today's card even if persistence failed.
      console.error('[daily-card] insert failed:', insertErr);
    }

    return NextResponse.json({
      date: today,
      cached: false,
      descriptive,
      ai_suggestion: aiSuggestion,
    });
  } catch (err) {
    console.error('[daily-card] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
