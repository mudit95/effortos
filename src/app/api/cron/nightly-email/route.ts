import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getEligibleUsers, getUserTasks, getUserGoalSummary, getUserDaySummary, logEmail } from '@/lib/cron-helpers';
import { nightlyEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';

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
    const errors: string[] = [];

    for (const user of users) {
      try {
        const now = new Date();
        const userNow = new Date(now.toLocaleString('en-US', { timeZone: user.timezone }));
        const todayStr = userNow.toISOString().slice(0, 10);

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const tomorrow = new Date(userNow);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDay = dayNames[tomorrow.getDay()];

        const [todayTasks, daySummary, goalSummary] = await Promise.all([
          getUserTasks(user.user_id, todayStr),
          getUserDaySummary(user.user_id, todayStr),
          getUserGoalSummary(user.user_id),
        ]);

        const { subject, html } = nightlyEmail({
          userName: user.name,
          todayTasks,
          daySummary,
          activeGoal: goalSummary,
          tomorrowDay,
        });

        const result = await sendEmail({ to: user.email, subject, html, tags: [{ name: 'type', value: 'nightly' }] });

        await logEmail({
          userId: user.user_id,
          emailTo: user.email,
          emailType: 'nightly',
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
          emailType: 'nightly',
          subject: 'Nightly email (failed)',
          status: 'failed',
          error: msg,
        });
      }
    }

    return NextResponse.json({ sent, total: users.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[cron/nightly-email] Fatal:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
