import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import {
  getEligibleUsers,
  getUserTasks,
  getUserGoalSummary,
  getUserDaySummary,
  logEmail,
  countOpenOtherTodosForUser,
  wasEmailSentRecently,
  getAdminSupabase,
} from '@/lib/cron-helpers';
import { nightlyEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';
import { nightlyWhatsAppMessage, sendCronNudge } from '@/lib/whatsapp-nudge';
import { concurrentMap } from '@/lib/concurrency';
import { recordCronRun } from '@/lib/cron-run-log';

/**
 * Quick check: does the user have a non-empty journal for `todayLocal`,
 * and at least one daily_task row for `tomorrowLocal`? Drives the
 * proactive prompts in the nightly WhatsApp companion message.
 */
async function getNightlyContextChecks(
  userId: string,
  todayLocal: string,
  tomorrowLocal: string,
): Promise<{ journalMissing: boolean; tomorrowPlanMissing: boolean }> {
  const supabase = getAdminSupabase();
  const [journalRes, taskRes] = await Promise.all([
    supabase
      .from('journal_entries')
      .select('content')
      .eq('user_id', userId)
      .eq('date', todayLocal)
      .maybeSingle(),
    supabase
      .from('daily_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('date', tomorrowLocal),
  ]);

  // Fail open: if either query errors, treat the gap as NOT missing
  // so we don't pester the user based on a flaky read. The next
  // nightly run will retry.
  const journalContent = (journalRes.data?.content ?? '').trim();
  const journalMissing = !journalRes.error && journalContent.length === 0;
  const tomorrowPlanMissing = !taskRes.error && (taskRes.count ?? 0) === 0;
  return { journalMissing, tomorrowPlanMissing };
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/nightly-email
 * Triggered by Vercel Cron every hour. Sends nightly recap to users
 * whose local timezone is currently 9 PM.
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  try {
    const users = await getEligibleUsers('nightly_email', 21);
    if (users.length === 0) {
      return NextResponse.json({ sent: 0, reason: 'no eligible users at this hour' });
    }

    let sent = 0;
    let waSent = 0;
    let waSendFailed = 0;
    const waSkipReasons: Record<string, number> = {};
    let skipped = 0;
    const errors: string[] = [];

    // Parallel fan-out — see morning-email and lib/concurrency.ts for rationale.
    const EMAIL_CONCURRENCY = 8;

    const results = await concurrentMap(users, EMAIL_CONCURRENCY, async (user) => {
      // Idempotency — see morning-email for rationale.
      if (await wasEmailSentRecently(user.user_id, 'nightly')) {
        return { kind: 'skipped' as const };
      }
      const now = new Date();
      const userNow = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const todayStr = userNow.toISOString().slice(0, 10);

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const tomorrow = new Date(userNow);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowDay = dayNames[tomorrow.getDay()];

      // Tomorrow's local date — UTC-noon trick to avoid DST corners.
      // Used both for the email's `tomorrowDay` label AND to detect
      // whether the user has any planned tasks for tomorrow.
      const tomorrowStr = (() => {
        const d = new Date(`${todayStr}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      })();

      const [todayTasks, daySummary, goalSummary, openOtherTodosCount, contextChecks] = await Promise.all([
        getUserTasks(user.user_id, todayStr),
        getUserDaySummary(user.user_id, todayStr),
        getUserGoalSummary(user.user_id),
        countOpenOtherTodosForUser(user.user_id),
        // Lightweight checks to drive proactive nudge copy. Both are
        // single indexed queries, ~2-3ms each on warm caches.
        getNightlyContextChecks(user.user_id, todayStr, tomorrowStr),
      ]);
      const { journalMissing, tomorrowPlanMissing } = contextChecks;

      const { subject, html } = nightlyEmail({
        userName: user.name,
        todayTasks,
        daySummary,
        activeGoal: goalSummary,
        tomorrowDay,
        openOtherTodosCount,
      });

      const result = await sendEmail({ to: user.email, subject, html, tags: [{ name: 'type', value: 'nightly' }] });

      await logEmail({
        userId: user.user_id,
        emailTo: user.email,
        emailType: 'nightly',
        subject,
        resendId: result?.id,
      });

      // Companion WhatsApp nudge — best-effort.
      const waMessage = nightlyWhatsAppMessage({
        userName: user.name,
        todayTasks,
        daySummary,
        activeGoal: goalSummary,
        tomorrowDay,
        openOtherTodosCount,
        // Smarter nightly: prompt for the missing thing(s) directly.
        // Even non-Beast users get this once-a-day proactive ask.
        journalMissing,
        tomorrowPlanMissing,
        persona: user.bot_persona,
      });
      const waOutcome = await sendCronNudge({ userId: user.user_id, nudgeType: 'nightly', message: waMessage });
      return { kind: 'sent' as const, waOutcome };
    });

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const user = users[i];
      if (!r.ok) {
        const msg = `${user.email}: ${r.error instanceof Error ? r.error.message : 'unknown'}`;
        errors.push(msg);
        await logEmail({
          userId: user.user_id,
          emailTo: user.email,
          emailType: 'nightly',
          subject: 'Nightly email (failed)',
          status: 'failed',
          error: msg,
        }).catch(() => {});
        continue;
      }
      if (r.value.kind === 'skipped') {
        skipped++;
      } else {
        sent++;
        const wa = r.value.waOutcome;
        if (wa.kind === 'sent') waSent++;
        else if (wa.kind === 'send_failed') waSendFailed++;
        else waSkipReasons[wa.reason] = (waSkipReasons[wa.reason] ?? 0) + 1;
      }
    }

    // Honest success/failure reporting — see morning-email for rationale.
    const attempted = users.length - skipped;
    const allFailed = attempted > 0 && sent === 0;
    const status: 'success' | 'failure' = allFailed ? 'failure' : 'success';
    await recordCronRun('nightly-email', status, {
      sent,
      wa_sent: waSent,
      wa_send_failed: waSendFailed,
      wa_skip_reasons: waSkipReasons,
      skipped_dedup: skipped,
      total: users.length,
      errors_count: errors.length,
      first_error: errors[0],
    });
    return NextResponse.json({ sent, wa_sent: waSent, wa_send_failed: waSendFailed, wa_skip_reasons: waSkipReasons, skipped_dedup: skipped, total: users.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[cron/nightly-email] Fatal:', err);
    await recordCronRun('nightly-email', 'failure', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
