import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getEligibleUsers, getUserTasks, getUserGoalSummary, logEmail } from '@/lib/cron-helpers';
import { morningEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';

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
    const errors: string[] = [];

    for (const user of users) {
      try {
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

        sent++;
      } catch (err) {
        const msg = `${user.email}: ${err instanceof Error ? err.message : 'unknown'}`;
        errors.push(msg);
        await logEmail({
          userId: user.user_id,
          emailTo: user.email,
          emailType: 'morning',
          subject: 'Morning email (failed)',
          status: 'failed',
          error: msg,
        });
      }
    }

    return NextResponse.json({ sent, total: users.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('[cron/morning-email] Fatal:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
