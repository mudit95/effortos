import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getEligibleUsers, getUserTasks, getUserDaySummary, logEmail } from '@/lib/cron-helpers';
import { afternoonEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';

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
    const errors: string[] = [];

    for (const user of users) {
      try {
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

        sent++;
      } catch (err) {
        const msg = `${user.email}: ${err instanceof Error ? err.message : 'unknown'}`;
        errors.push(msg);
        await logEmail({
          userId: user.user_id,
          emailTo: user.email,
          emailType: 'afternoon',
          subject: 'Afternoon email (failed)',
          status: 'failed',
          error: msg,
        });
      }
    }

    return NextResponse.json({ sent, total: users.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[cron/afternoon-email] Fatal:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
