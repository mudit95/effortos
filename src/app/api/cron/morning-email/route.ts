import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getEligibleUsers, getUserTasks, getUserGoalSummary, logEmail, wasEmailSentRecently } from '@/lib/cron-helpers';
import { morningEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';
import { morningWhatsAppMessage, sendCronNudge } from '@/lib/whatsapp-nudge';
import { concurrentMap } from '@/lib/concurrency';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds

/**
 * GET /api/cron/morning-email
 * Triggered by Vercel Cron every hour. Sends morning email to users
 * whose local timezone is currently 8 AM.
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  try {
    const users = await getEligibleUsers('morning_email', 8);
    if (users.length === 0) {
      return NextResponse.json({ sent: 0, reason: 'no eligible users at this hour' });
    }

    let sent = 0;
    let waSent = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Parallel fan-out at concurrency 8 — see lib/concurrency.ts. The
    // earlier serial loop took ~1-3 s per user; at 500 eligible users the
    // run blew past Vercel's 60 s default. Capped at 8 to stay within
    // Resend's free-tier rate limit (10 sends/sec) with headroom.
    const EMAIL_CONCURRENCY = 8;

    const results = await concurrentMap(users, EMAIL_CONCURRENCY, async (user) => {
      // Idempotency: if this user already got a morning send in the last
      // 18 hours, skip. Protects against duplicate-send bugs from cron
      // retries, mis-scheduled cron firing every 15 mins, or deploy
      // cutovers. See wasEmailSentRecently for full rationale.
      if (await wasEmailSentRecently(user.user_id, 'morning')) {
        return { kind: 'skipped' as const };
      }
      // Yesterday's date in user's timezone
      const now = new Date();
      const userNow = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
      const yesterday = new Date(userNow);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayOfWeek = dayNames[userNow.getDay()];

      const [yesterdayTasks, goalSummary] = await Promise.all([
        getUserTasks(user.user_id, yesterdayStr),
        getUserGoalSummary(user.user_id),
      ]);

      const { subject, html } = morningEmail({
        userName: user.name,
        yesterdayTasks,
        activeGoal: goalSummary,
        dayOfWeek,
      });

      const result = await sendEmail({ to: user.email, subject, html, tags: [{ name: 'type', value: 'morning' }] });

      await logEmail({
        userId: user.user_id,
        emailTo: user.email,
        emailType: 'morning',
        subject,
        resendId: result?.id,
      });

      // Companion WhatsApp nudge — best-effort, never blocks the cron.
      // Pass bot_persona so the nudge matches the user's chosen voice.
      const waMessage = morningWhatsAppMessage({
        userName: user.name,
        yesterdayTasks,
        activeGoal: goalSummary,
        dayOfWeek,
        persona: user.bot_persona,
      });
      const waOk = await sendCronNudge({ userId: user.user_id, nudgeType: 'morning', message: waMessage });
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
          emailType: 'morning',
          subject: 'Morning email (failed)',
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

    await recordCronRun('morning-email', 'success', { sent, wa_sent: waSent, skipped_dedup: skipped, total: users.length });
    return NextResponse.json({ sent, wa_sent: waSent, skipped_dedup: skipped, total: users.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[cron/morning-email] Fatal:', err);
    await recordCronRun('morning-email', 'failure', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
