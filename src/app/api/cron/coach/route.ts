import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { evaluateNudges } from '@/lib/coach-engine';
import { generateCoachMessage } from '@/lib/coach-ai';
import { sendTextMessage } from '@/lib/whatsapp';
import { concurrentMap } from '@/lib/concurrency';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
// 60s ceiling on Vercel Hobby (Pro allows 300). With concurrentMap at
// concurrency 10 and ~3-5s per user, this fits ~120-200 eligible users
// per run. At higher scale either upgrade to Pro or split eligible users
// across multiple invocations of this same endpoint.
export const maxDuration = 60;

/**
 * GET /api/cron/coach
 *
 * Runs once daily at 02:00 UTC via Vercel Cron (Hobby plan limitation).
 *
 * Since we can't run hourly, the approach is:
 *   1. For each Pro user, check their LOCAL hour right now.
 *   2. If it matches a nudge window (8 AM, 1 PM, 6 PM, 8 PM, etc.),
 *      send the nudge immediately.
 *   3. For timezone coverage, this cron also supports being called
 *      manually or via an external scheduler (e.g. cron-job.org)
 *      multiple times per day for better coverage.
 *
 * To get hourly coverage without Vercel Pro, set up a free external
 * cron service (cron-job.org, EasyCron, etc.) to hit:
 *   GET https://your-domain.vercel.app/api/cron/coach
 *   Header: Authorization: Bearer <your-CRON_SECRET>
 *   Schedule: Every hour
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = createServiceClient();

  try {
    // ── 1. Find all Pro users with linked WhatsApp ──
    const { data: proUsers, error: queryErr } = await supabase
      .from('profiles')
      .select(`
        id,
        name,
        phone_number,
        timezone,
        coaching_intensity,
        coaching_quiet_start,
        coaching_quiet_end,
        coaching_paused_until,
        bot_persona
      `)
      .eq('whatsapp_linked', true)
      .not('phone_number', 'is', null);

    if (queryErr) {
      console.error('[Coach Cron] Failed to query profiles:', queryErr);
      return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
    }

    if (!proUsers || proUsers.length === 0) {
      return NextResponse.json({ sent: 0, reason: 'no eligible users' });
    }

    // Filter to Pro-tier subscribers only
    const userIds = proUsers.map((u) => u.id);
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('user_id, plan_tier, status')
      .in('user_id', userIds)
      .eq('plan_tier', 'pro')
      .in('status', ['trialing', 'active']);

    const proUserIds = new Set((subs || []).map((s: { user_id: string }) => s.user_id));
    const eligibleUsers = proUsers.filter((u) => proUserIds.has(u.id));

    if (eligibleUsers.length === 0) {
      return NextResponse.json({ sent: 0, reason: 'no pro-tier users with whatsapp' });
    }

    // ── 2. Evaluate and send nudges (parallel, concurrency-bounded) ──
    //
    // Earlier this loop was strictly serial — at 500 eligible users a
    // single cron run could exceed Vercel's 5-minute function cap because
    // every user did Anthropic + DB + Meta sequentially. concurrentMap
    // runs N users in parallel up to a fixed cap, which keeps the wall
    // clock bounded by ~max-per-user-time × (eligible / concurrency).
    //
    // Concurrency = 10 because each task touches Anthropic (rate-limited
    // ~5 RPM/key on default tier — beyond that gets 429s), Supabase, and
    // Meta. Overshooting Anthropic's RPM is the expensive failure mode;
    // 10 in flight × ~3-4s per user keeps us comfortably under 5 RPM.
    const COACH_CONCURRENCY = 10;
    const errorMsgs: string[] = [];

    const perUserResults = await concurrentMap(eligibleUsers, COACH_CONCURRENCY, async (user) => {
      const decision = await evaluateNudges(supabase, user);
      if (!decision) return { kind: 'skipped' as const };

      // Generate personalized message
      const message = await generateCoachMessage(decision.nudge_type, decision.context);

      // ── Atomic claim via unique-per-UTC-day index ──
      // Insert the coach_log row BEFORE sending. The unique partial index
      // (migration 025) on (user_id, nudge_type, day-UTC) makes a
      // concurrent retry's insert fail with 23505; we treat that as
      // "another invocation already claimed this nudge" and skip the
      // outbound send entirely.
      const { data: insertedRow, error: insertErr } = await supabase
        .from('coach_log')
        .insert({
          user_id: user.id,
          nudge_type: decision.nudge_type,
          message_sent: message,
          delivered: false,
          context_json: {
            total_tasks: decision.context.totalTasks,
            completed_tasks: decision.context.completedTasks,
            streak: decision.context.currentStreak,
            local_hour: decision.context.localHour,
            milestone_pct: decision.context.activeGoal?.pct,
          },
        })
        .select('id')
        .single();

      if (insertErr) {
        if (insertErr.code === '23505') {
          // Race-loser — already claimed today.
          return { kind: 'skipped' as const, reason: 'already_claimed' };
        }
        throw new Error(`claim insert failed: ${insertErr.message}`);
      }
      const claimedId = insertedRow.id as string;

      // Send via WhatsApp now that we hold the claim.
      const phone = user.phone_number.replace(/^\+/, '');
      const delivered = await sendTextMessage(phone, message);

      if (delivered) {
        await supabase
          .from('coach_log')
          .update({ delivered: true })
          .eq('id', claimedId);
        return { kind: 'sent' as const, nudgeType: decision.nudge_type, name: user.name };
      }
      return { kind: 'failed_delivery' as const };
    });

    let sent = 0;
    let skipped = 0;
    perUserResults.forEach((r, i) => {
      const user = eligibleUsers[i];
      if (!r.ok) {
        const msg = r.error instanceof Error ? r.error.message : String(r.error);
        errorMsgs.push(`${user.id}: ${msg}`);
        console.error(`[Coach Cron] Error for user ${user.id}:`, r.error);
        return;
      }
      const v = r.value;
      if (v.kind === 'skipped') {
        skipped++;
      } else if (v.kind === 'sent') {
        sent++;
        console.log(`[Coach Cron] ${v.nudgeType} → ${v.name} (sent)`);
      } else if (v.kind === 'failed_delivery') {
        errorMsgs.push(`Failed to deliver to ${user.id}`);
      }
    });

    await recordCronRun('coach', 'success', { eligible: eligibleUsers.length, sent, skipped });
    return NextResponse.json({
      eligible: eligibleUsers.length,
      sent,
      skipped,
      errors: errorMsgs.length > 0 ? errorMsgs : undefined,
    });
  } catch (err) {
    console.error('[Coach Cron] Fatal error:', err);
    await recordCronRun('coach', 'failure', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
