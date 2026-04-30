import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getAdminSupabase, logEmail, listAllAuthUsers } from '@/lib/cron-helpers';
import { sendEmail } from '@/lib/email';
import { emailLayout, APP_URL } from '@/lib/email';
import { concurrentMap } from '@/lib/concurrency';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 60s on Vercel Hobby. With concurrency 8, each batch processes ~95
// users in 60s. If you see timeouts at scale, either upgrade to Pro
// (300s ceiling) or move the heavy batch to a queue-driven worker.
export const maxDuration = 60;

/**
 * GET /api/cron/re-engagement
 *
 * Daily sweep that emails users who've gone quiet. Lazy churn is
 * invisible until it isn't — at the small-product scale a single email
 * to a user 14 days into silence saves a meaningful fraction of subs.
 *
 * Eligibility:
 *   - subscription.status IN ('active', 'past_due', 'trialing')   (paying-ish)
 *   - last completed session > 14 days ago
 *   - last re-engagement email > 30 days ago (don't be annoying)
 *   - email_preferences.unsubscribed_all = false
 *   - account NOT soft-deleted (deleted_at IS NULL)
 *
 * Idempotency: an email_log row of type='re_engagement' is what guards
 * the 30-day cool-down. Same shape as morning/afternoon/nightly.
 *
 * Cost: this fires once per day. Each user's email is ~500 tokens of
 * Resend bandwidth. At 1000 dormant users, ~$0.50 per cron run on Resend
 * paid tier — easily worth it for retention.
 *
 * Scheduled daily at 06:00 UTC (after morning-email so we don't compete
 * for inbox space with same-day digest sends).
 */

const QUIET_DAYS_THRESHOLD = 14;
const RE_ENGAGEMENT_COOLDOWN_DAYS = 30;
const RE_ENGAGEMENT_CONCURRENCY = 8;

interface Candidate {
  user_id: string;
  email: string;
  name: string;
}

function reEngagementEmail(opts: { userName: string; daysQuiet: number }): { subject: string; html: string } {
  const firstName = (opts.userName || 'there').split(' ')[0];
  const days = opts.daysQuiet;
  let body = `<h1>Still planning to come back?</h1>`;
  body += `<p>Hey ${firstName} — it&rsquo;s been ${days} days since your last focus session in EffortOS. No judgement; we&rsquo;ve all had weeks like that.</p>`;
  body += `<p>If you&rsquo;ve drifted off because the app got in the way, I&rsquo;d love to hear what didn&rsquo;t work. Hit reply — I read every email.</p>`;
  body += `<p>If you&rsquo;re ready to get back, the easiest start is one small thing today:</p>`;
  body += `<p><a href="${APP_URL}/dashboard" class="btn">Run a 25-minute session &rarr;</a></p>`;
  body += `<p style="margin-top:24px;color:#64748b;font-size:12px;">If you&rsquo;d rather not hear from me, the link below stops these emails right away. &mdash; Mudit</p>`;
  return {
    subject: `EffortOS — still here when you&rsquo;re ready`,
    html: emailLayout(body, { preheader: `It's been ${days} days. One small thing today is enough.` }),
  };
}

export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = getAdminSupabase();
  const now = Date.now();
  const quietCutoff = new Date(now - QUIET_DAYS_THRESHOLD * 24 * 60 * 60 * 1000).toISOString();
  const cooldownCutoff = new Date(now - RE_ENGAGEMENT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Active-ish subscribers (paying or trialing) ─────────────────
  const { data: activeSubs, error: subsErr } = await supabase
    .from('subscriptions')
    .select('user_id, status')
    .in('status', ['active', 'past_due', 'trialing']);

  if (subsErr) {
    console.error('[re-engagement] subs query failed:', subsErr);
    await recordCronRun('re-engagement', 'failure', { reason: 'subs_query_failed' });
    return NextResponse.json({ error: 'Subs query failed' }, { status: 500 });
  }
  if (!activeSubs || activeSubs.length === 0) {
    await recordCronRun('re-engagement', 'success', { sent: 0, reason: 'no_active_subs' });
    return NextResponse.json({ sent: 0, reason: 'no active subs' });
  }
  const candidateIds = activeSubs.map((s) => s.user_id);

  // ── 2. Filter to those with no recent session ──────────────────────
  // We look up the most recent completed session per user. A user with
  // ZERO sessions ever (newly trialed, never used) also qualifies — the
  // "no row" case is exactly what we want to nudge.
  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('user_id, end_time')
    .in('user_id', candidateIds)
    .eq('status', 'completed')
    .gte('end_time', quietCutoff);

  const activeRecently = new Set((recentSessions ?? []).map((s) => s.user_id));
  const quietIds = candidateIds.filter((id) => !activeRecently.has(id));
  if (quietIds.length === 0) {
    await recordCronRun('re-engagement', 'success', { sent: 0, reason: 'no_quiet_users' });
    return NextResponse.json({ sent: 0, reason: 'no quiet users' });
  }

  // ── 3. Filter out users we've already nudged in the last 30 days ──
  const { data: recentEmails } = await supabase
    .from('email_log')
    .select('user_id')
    .in('user_id', quietIds)
    .eq('email_type', 're_engagement')
    .gte('created_at', cooldownCutoff);

  const inCooldown = new Set((recentEmails ?? []).map((e) => e.user_id));
  const targetIds = quietIds.filter((id) => !inCooldown.has(id));
  if (targetIds.length === 0) {
    await recordCronRun('re-engagement', 'success', { sent: 0, reason: 'all_in_cooldown' });
    return NextResponse.json({ sent: 0, reason: 'all in 30d cooldown' });
  }

  // ── 4. Filter out unsubscribers + soft-deleted ──────────────────────
  const [{ data: prefs }, { data: profiles }] = await Promise.all([
    supabase
      .from('email_preferences')
      .select('user_id, unsubscribed_all')
      .in('user_id', targetIds),
    supabase
      .from('profiles')
      .select('id, name, deleted_at')
      .in('id', targetIds),
  ]);

  const unsubscribed = new Set(
    (prefs ?? []).filter((p) => p.unsubscribed_all).map((p) => p.user_id),
  );
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const authUsers = await listAllAuthUsers(supabase);
  const emailMap = new Map(authUsers.map((u) => [u.id, u.email]));

  const candidates: Candidate[] = targetIds
    .map((id) => {
      if (unsubscribed.has(id)) return null;
      const profile = profileMap.get(id);
      if (!profile || profile.deleted_at) return null;
      const email = emailMap.get(id);
      if (!email) return null;
      return { user_id: id, email, name: profile.name || 'there' };
    })
    .filter((c): c is Candidate => c !== null);

  if (candidates.length === 0) {
    await recordCronRun('re-engagement', 'success', { sent: 0, reason: 'all_filtered_out' });
    return NextResponse.json({ sent: 0, reason: 'all filtered out' });
  }

  // ── 5. Fan-out send ────────────────────────────────────────────────
  const errors: string[] = [];
  let sent = 0;

  const results = await concurrentMap(candidates, RE_ENGAGEMENT_CONCURRENCY, async (c) => {
    const { subject, html } = reEngagementEmail({
      userName: c.name,
      daysQuiet: QUIET_DAYS_THRESHOLD,
    });
    const r = await sendEmail({
      to: c.email,
      subject,
      html,
      tags: [{ name: 'type', value: 're_engagement' }],
    });
    await logEmail({
      userId: c.user_id,
      emailTo: c.email,
      emailType: 're_engagement',
      subject,
      resendId: r?.id,
    });
    return true;
  });

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok) {
      errors.push(
        `${candidates[i].email}: ${r.error instanceof Error ? r.error.message : 'unknown'}`,
      );
    } else {
      sent++;
    }
  }

  await recordCronRun('re-engagement', 'success', {
    sent,
    considered: candidates.length,
    errorCount: errors.length,
  });
  return NextResponse.json({
    sent,
    considered: candidates.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
