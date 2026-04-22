import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { evaluateNudges } from '@/lib/coach-engine';
import { generateCoachMessage } from '@/lib/coach-ai';
import { sendTextMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 minutes — processing multiple users

/**
 * GET /api/cron/coach
 *
 * Runs every hour via Vercel Cron. For each Pro-tier user with a linked
 * WhatsApp number, the coach engine decides if a nudge is due, generates
 * a personalized message via AI, and sends it.
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = createServiceClient();

  try {
    // ── 1. Find all Pro users with linked WhatsApp ──
    // Join subscriptions (for tier) with profiles (for phone + preferences)
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
        coaching_paused_until
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

    // ── 2. Evaluate and send nudges ──
    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const user of eligibleUsers) {
      try {
        const decision = await evaluateNudges(supabase, user);

        if (!decision) {
          skipped++;
          continue;
        }

        // Generate personalized message
        const message = await generateCoachMessage(decision.nudge_type, decision.context);

        // Send via WhatsApp
        const phone = user.phone_number.replace(/^\+/, ''); // strip leading +
        const delivered = await sendTextMessage(phone, message);

        // Log to coach_log
        await supabase.from('coach_log').insert({
          user_id: user.id,
          nudge_type: decision.nudge_type,
          message_sent: message,
          delivered,
          context_json: {
            total_tasks: decision.context.totalTasks,
            completed_tasks: decision.context.completedTasks,
            streak: decision.context.currentStreak,
            local_hour: decision.context.localHour,
            milestone_pct: decision.context.activeGoal?.pct,
          },
        });

        if (delivered) sent++;
        else errors.push(`Failed to deliver to ${user.id}`);

        console.log(
          `[Coach Cron] ${decision.nudge_type} → ${user.name} (${delivered ? 'sent' : 'failed'})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${user.id}: ${msg}`);
        console.error(`[Coach Cron] Error for user ${user.id}:`, err);
      }
    }

    return NextResponse.json({
      eligible: eligibleUsers.length,
      sent,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[Coach Cron] Fatal error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
