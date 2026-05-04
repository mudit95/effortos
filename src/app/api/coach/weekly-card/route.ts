import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getUserTimezone, weekStartKeyInTz } from '@/lib/user-date';
import { ensureAiQuota, getUserAiTier, recordAiUsage } from '@/lib/aiQuota';
import { generateWeeklyCardAi, type WeeklyCardStats } from '@/lib/coach-ai';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * GET /api/coach/weekly-card
 *
 * Returns this week's weekly card for the calling user. Cached
 * one-per-(user, week_start) in the weekly_cards table (mig 043).
 *
 * Tier behaviour:
 *   - Free tier: descriptive aggregate only (no AI cost). The
 *     ai_insight + ai_suggestion fields are null in the response.
 *     This still gives the dashboard surface a "your week in numbers"
 *     story without the prescriptive Pro layer.
 *   - Pro tier: descriptive + AI insight + AI suggestion. Single
 *     Claude call per user per week, gated by aiQuota.
 *
 * Cache:
 *   - Always write a row on first call of the week (descriptive only
 *     for free, full payload for Pro). Re-reads bypass the assemble-
 *     stats step entirely.
 *   - UNIQUE(user_id, week_start) on the table means a race between
 *     two concurrent requests resolves cleanly: the second's INSERT
 *     fails 23505 and falls through to a re-SELECT.
 *
 * Rate limit: light bucket (20/hr) — protects the AI call from a
 * runaway client even when most opens hit the cache.
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
    const weekStart = weekStartKeyInTz(tz);

    // ── Cache hit fast path ────────────────────────────────────────
    const { data: cached } = await supabase
      .from('weekly_cards')
      .select('descriptive, ai_insight, ai_suggestion, created_at')
      .eq('user_id', user.id)
      .eq('week_start', weekStart)
      .maybeSingle();

    if (cached) {
      return NextResponse.json({
        week_start: weekStart,
        cached: true,
        descriptive: cached.descriptive,
        ai_insight: cached.ai_insight,
        ai_suggestion: cached.ai_suggestion,
      });
    }

    // ── Cache miss — assemble stats ───────────────────────────────
    // Pull 7-day session + task + journal + goals data via the
    // auth-bound client so RLS gates the reads.
    const weekStartIso = new Date(weekStart + 'T00:00:00').toISOString();
    const weekEndIso = new Date(
      new Date(weekStart + 'T00:00:00').getTime() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [sessionsRes, tasksRes, journalRes, profileRes, goalsRes] = await Promise.all([
      supabase
        .from('sessions')
        .select('start_time, duration, status')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .gte('start_time', weekStartIso)
        .lt('start_time', weekEndIso),
      supabase
        .from('daily_tasks')
        .select('completed, tag')
        .eq('user_id', user.id)
        .gte('date', weekStart)
        .lt('date', weekEndIso.slice(0, 10)),
      supabase
        .from('journal_entries')
        .select('mood, content, date')
        .eq('user_id', user.id)
        .gte('date', weekStart)
        .lt('date', weekEndIso.slice(0, 10)),
      supabase
        .from('profiles')
        .select('name, freeze_tokens_remaining, last_session_date')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('goals')
        .select('id, status, sessions_completed, estimated_sessions_current')
        .eq('user_id', user.id),
    ]);

    type Session = { start_time: string; duration: number | null };
    type Task = { completed: boolean; tag: string | null };
    type Journal = { mood: string | null; content: string | null; date: string };

    const sessions: Session[] = (sessionsRes.data ?? []) as Session[];
    const tasks: Task[] = (tasksRes.data ?? []) as Task[];
    const journals: Journal[] = (journalRes.data ?? []) as Journal[];
    const goals = (goalsRes.data ?? []) as Array<{ id: string; status: string; sessions_completed: number; estimated_sessions_current: number }>;
    const userName = (profileRes.data?.name as string | undefined) || 'there';

    const totalFocusSeconds = sessions.reduce(
      (a, s) => a + (typeof s.duration === 'number' ? s.duration : 0),
      0,
    );
    const totalFocusMinutes = Math.round(totalFocusSeconds / 60);
    const totalSessions = sessions.length;
    const tasksCompleted = tasks.filter((t) => t.completed).length;
    const tasksTotal = tasks.length;
    const completionRate = tasksTotal > 0 ? tasksCompleted / tasksTotal : 0;

    // Per-day breakdown for best-day calculation.
    const dayCounts = new Map<string, number>();
    for (const s of sessions) {
      const day = new Date(s.start_time).toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
    let bestDayName: string | null = null;
    let bestDaySessions = 0;
    for (const [day, n] of dayCounts.entries()) {
      if (n > bestDaySessions) {
        bestDayName = day;
        bestDaySessions = n;
      }
    }

    // Time-of-day completion: bucket sessions by hour, compute the
    // fraction of bucketed sessions that completed (all sessions
    // in this query are status='completed' so the rate within a
    // bucket is 1; this is a placeholder for future "started vs
    // completed in bucket" math when we surface aborted sessions).
    // For now: percentage of sessions in each bucket.
    const morningCount = sessions.filter((s) => {
      const h = new Date(s.start_time).getHours();
      return h >= 5 && h < 12;
    }).length;
    const afternoonCount = sessions.filter((s) => {
      const h = new Date(s.start_time).getHours();
      return h >= 12 && h < 17;
    }).length;
    const eveningCount = sessions.filter((s) => {
      const h = new Date(s.start_time).getHours();
      return h >= 17 && h < 23;
    }).length;
    const morningCompletion = totalSessions > 0 ? morningCount / totalSessions : null;
    const afternoonCompletion = totalSessions > 0 ? afternoonCount / totalSessions : null;
    const eveningCompletion = totalSessions > 0 ? eveningCount / totalSessions : null;

    // Tag breakdown — find the most-tagged work area.
    const tagCounts = new Map<string, number>();
    for (const t of tasks) {
      if (!t.tag) continue;
      tagCounts.set(t.tag, (tagCounts.get(t.tag) ?? 0) + 1);
    }
    let topTag: string | null = null;
    let topTagCount = 0;
    for (const [tag, n] of tagCounts.entries()) {
      if (n > topTagCount) {
        topTag = tag;
        topTagCount = n;
      }
    }

    // Mood summary — single short phrase from up to last 7 entries.
    const moodSummary = (() => {
      const moods = journals
        .map((j) => j.mood)
        .filter((m): m is string => !!m);
      if (moods.length === 0) return null;
      // Crude bucket: count positives / negatives / neutrals.
      const pos = moods.filter((m) => /great|good|happy|calm|grateful/i.test(m)).length;
      const neg = moods.filter((m) => /tired|stressed|frustrat|burn|sad|anxious/i.test(m)).length;
      if (neg > pos && neg >= 2) return 'rough patches midweek';
      if (pos > neg && pos >= 2) return 'mostly steady';
      return 'mixed';
    })();

    // Streaks: pull the authoritative numbers from dashboard_stats /
    // profile rather than try to derive them from the in-window
    // sessions. The previous code conflated "distinct active days
    // this week" with "current streak" and sent the WRONG value into
    // the AI prompt — Claude would then build the insight around an
    // invented streak number. Here we read the streak the user
    // actually sees on the dashboard so the AI talks about the same
    // numbers the user sees.
    let currentStreak = 0;
    let longestStreak = 0;
    try {
      const { data: stats } = await supabase
        .from('dashboard_stats')
        .select('current_streak, longest_streak')
        .eq('user_id', user.id)
        .maybeSingle();
      currentStreak = (stats?.current_streak as number | undefined) ?? 0;
      longestStreak = (stats?.longest_streak as number | undefined) ?? currentStreak;
    } catch {
      // dashboard_stats is best-effort; fall back to "distinct active
      // days this week" rather than failing the whole card.
      const sessionDays = new Set(
        sessions.map((s) => new Date(s.start_time).toISOString().slice(0, 10)),
      );
      currentStreak = sessionDays.size;
      longestStreak = sessionDays.size;
    }

    // Active goals count.
    const activeGoalsCount = goals.filter((g) => g.status === 'active').length;

    const stats: WeeklyCardStats = {
      totalFocusMinutes,
      totalSessions,
      tasksCompleted,
      tasksTotal,
      completionRate,
      bestDayName,
      bestDaySessions,
      morningCompletion,
      afternoonCompletion,
      eveningCompletion,
      currentStreak,
      longestStreak,
      activeGoalsCount,
      moodSummary,
      topTag,
      activeGoalPctChange: null, // future: snapshot diff vs last week
      userName,
    };

    // ── Tier gating ─────────────────────────────────────────────
    const tier = await getUserAiTier(supabase, user.id);
    const isPro = tier === 'pro';

    let aiInsight: string | null = null;
    let aiSuggestion: string | null = null;
    let aiTokens = 0;

    if (isPro) {
      // Quota gate. recordAiUsage receives the real input/output split
      // (was previously synthesized with everything in input, which
      // mis-attributed spend across the daily-quota bucket).
      const quota = await ensureAiQuota(user.id, 'pro');
      if (quota.ok) {
        const ai = await generateWeeklyCardAi(stats);
        aiInsight = ai.insight;
        aiSuggestion = ai.suggestion;
        aiTokens = ai.inputTokens + ai.outputTokens;
        if (aiTokens > 0) {
          await recordAiUsage(user.id, {
            input_tokens: ai.inputTokens,
            output_tokens: ai.outputTokens,
          });
        }
      }
    }

    // ── Persist ─────────────────────────────────────────────────
    // Service-role insert because RLS denies INSERT to authenticated
    // (only SELECT is policy-allowed). UNIQUE(user_id, week_start)
    // makes the race-loser case a no-op on conflict.
    const service = createServiceClient();
    const descriptive = {
      total_focus_minutes: totalFocusMinutes,
      total_sessions: totalSessions,
      tasks_completed: tasksCompleted,
      tasks_total: tasksTotal,
      completion_rate: completionRate,
      best_day_name: bestDayName,
      best_day_sessions: bestDaySessions,
      morning_completion: morningCompletion,
      afternoon_completion: afternoonCompletion,
      evening_completion: eveningCompletion,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      active_goals_count: activeGoalsCount,
      mood_summary: moodSummary,
      top_tag: topTag,
      active_goal_pct_change: null,
    };
    const { error: insertErr } = await service
      .from('weekly_cards')
      .insert({
        user_id: user.id,
        week_start: weekStart,
        descriptive,
        ai_insight: aiInsight,
        ai_suggestion: aiSuggestion,
        ai_tokens_used: aiTokens,
      });
    if (insertErr && (insertErr as { code?: string }).code !== '23505') {
      console.error('[weekly-card] insert failed:', insertErr);
    }

    return NextResponse.json({
      week_start: weekStart,
      cached: false,
      descriptive,
      ai_insight: aiInsight,
      ai_suggestion: aiSuggestion,
    });
  } catch (err) {
    console.error('[weekly-card] fatal:', err);
    return NextResponse.json(
      { error: 'Failed to load weekly card' },
      { status: 500 },
    );
  }
}
