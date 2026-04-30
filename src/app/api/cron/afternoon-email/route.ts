import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getEligibleUsers, getUserTasks, getUserDaySummary, logEmail, wasEmailSentRecently } from '@/lib/cron-helpers';
import { afternoonEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';
import { afternoonWhatsAppMessage, sendCronNudge } from '@/lib/whatsapp-nudge';
import { concurrentMap } from '@/lib/concurrency';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/afternoon-email
 * Triggered by Vercel Cron every hour. Sends afternoon check-in to users
 * whose local timezone is currently 2 PM.
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  try {
    const users = await getEligibleUsers('afternoon_email', 14);
    if (users.length === 0) {
      return NextResponse.json({ sent: 0, reason: 'no eligible users at this hour' });
    }

    let sent = 0;
    let waSent = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Parallel fan-out — see morning-email and lib/concurrency.ts for rationale.
    const EMAIL_CONCURRENCY = 8;

    const results = await concurrentMap(users, EMAIL_CONCURRENCY, async (user) => {
      // Idempotency — see morning-email for rationale.
      if (await wasEmailSentRecently(user.user_id, 'afternoon')) {
        return { kind: 'skipped' as const };
      }
      const now = new Date();
      const userNow = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const todayStr = userNow.toISOString().slice(0, 10);

      const [todayTasks, daySummary] = await Promise.all([
        getUserTasks(user.user_id, todayStr),
        getUserDaySummary(user.user_id, todayStr),
      ]);

      const { subject, html } = afternoonEmail({
        userName: user.name,
        todayTasks,
        sessionsToday: daySummary.total_sessions,
        focusMinutesToday: daySummary.total_focus_minutes,
      });

      const result = await sendEmail({ to: user.email, subject, html, tags: [{ name: 'type', value: 'afternoon' }] });

      await logEmail({
        userId: user.user_id,
        emailTo: user.email,
        emailType: 'afternoon',
        subject,
        resendId: result?.id,
      });

      // Companion WhatsApp nudge — best-effort.
      const waMessage = afternoonWhatsAppMessage({
        userName: user.name,
        todayTasks,
        sessionsToday: daySummary.total_sessions,
        focusMinutesToday: daySummary.total_focus_minutes,
        persona: user.bot_persona,
      });
      const waOk = await sendCronNudge({ userId: user.user_id, nudgeType: 'afternoon', message: waMessage });
      return { kind: 'sent' as const, waOk };
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
          emailType: 'afternoon',
          subject: 'Afternoon email (failed)',
          status: 'failed',
          error: msg,
        }).catch(() => {});
        continue;
      }
      if (r.value.kind === 'skipped') {
        skipped++;
      } else {
        sent++;
        if (r.value.waOk) waSent++;
      }
    }

    await recordCronRun('afternoon-email', 'success', { sent, wa_sent: waSent, skipped_dedup: skipped, total: users.length });
    return NextResponse.json({ sent, wa_sent: waSent, skipped_dedup: skipped, total: users.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[cron/afternoon-email] Fatal:', err);
    await recordCronRun('afternoon-email', 'failure', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
