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

// Two thresholds, two templates, two cooldowns. Re-engagement is the
// existing 14-day "still planning to come back?" send. Welcome-back is
// the gentler 7-day nudge added in Wave 2 — pairs with the in-app
// LapseRecoveryModal so users get both an email AND a friendlier prompt
// when they next open the app. A user who hits the 7-day window first
// gets welcome-back; if they're still gone at 14 days they then get the
// stronger re-engagement (separate email_log type, separate cooldown).
const WELCOME_BACK_THRESHOLD = 7;
const WELCOME_BACK_COOLDOWN_DAYS = 60;
const QUIET_DAYS_THRESHOLD = 14;
const RE_ENGAGEMENT_COOLDOWN_DAYS = 30;
const RE_ENGAGEMENT_CONCURRENCY = 8;

interface Candidate {
  user_id: string;
  email: string;
  name: string;
  /** Days since the user's most recent completed session, computed
   *  in the candidate-build step so the send loop doesn't need to
   *  re-derive it. -1 = no sessions ever (treated as quiet). */
  daysQuiet: number;
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
    // Real Unicode apostrophe — &rsquo; renders as literal HTML in subject lines
    subject: `Still here whenever you're ready`,
    html: emailLayout(body, { preheader: `It's been ${days} days. One small thing today is enough.` }),
  };
}

/**
 * Welcome-back template — gentler than re-engagement. Sent at 7 days
 * dormant. Tone is "we noticed you stepped away, no pressure" rather
 * than "still planning to come back?" The aim is to catch the lapse
 * early and offer a quick re-entry, not to apply social pressure.
 */
function welcomeBackEmail(opts: { userName: string; daysQuiet: number }): { subject: string; html: string } {
  const firstName = (opts.userName || 'there').split(' ')[0];
  const days = opts.daysQuiet;
  let body = `<h1>Your seat&rsquo;s still warm</h1>`;
  body += `<p>Hi ${firstName} — it&rsquo;s been ${days} day${days === 1 ? '' : 's'} since your last focus session. That&rsquo;s a perfectly normal break.</p>`;
  body += `<p>If you&rsquo;d like to ease back in, one 25-minute session is all it takes. No streak math required.</p>`;
  body += `<p><a href="${APP_URL}/dashboard" class="btn">Start a quick 25 min &rarr;</a></p>`;
  body += `<p style="margin-top:24px;color:#64748b;font-size:12px;">No follow-up unless you ask for one. &mdash; Mudit</p>`;
  return {
    subject: `${firstName}, want to ease back in with one 25-minute block?`,
    html: emailLayout(body, { preheader: `Easing back in is one tap. No streak pressure.` }),
  };
}

export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = getAdminSupabase();
  const now = Date.now();
  // Welcome-back (7d) is the broader window — anything 7+ days dormant
  // qualifies for at least the welcome-back template. The 14d
  // re-engagement is a strict subset chosen later.
  const welcomeBackCutoff = new Date(now - WELCOME_BACK_THRESHOLD * 24 * 60 * 60 * 1000).toISOString();
  const reEngagementCooldownCutoff = new Date(now - RE_ENGAGEMENT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const welcomeBackCooldownCutoff = new Date(now - WELCOME_BACK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

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

  // ── 2. Find recent sessions per candidate ──────────────────────────
  // Pull the latest completed session for each candidate so we can
  // compute days-quiet per user (drives both threshold checks +
  // template variable). Users with NO completed sessions ever get
  // daysQuiet=Infinity (treated as max-quiet — nudge them).
  const { data: recentSessions } = await supabase
    .from('sessions')
    .select('user_id, end_time')
    .in('user_id', candidateIds)
    .eq('status', 'completed')
    .gte('end_time', welcomeBackCutoff);

  // Anyone with a session in the last 7 days is engaged enough — skip.
  const activeRecently = new Set((recentSessions ?? []).map((s) => s.user_id));
  const quietIds = candidateIds.filter((id) => !activeRecently.has(id));
  if (quietIds.length === 0) {
    await recordCronRun('re-engagement', 'success', { sent: 0, reason: 'no_quiet_users' });
    return NextResponse.json({ sent: 0, reason: 'no quiet users' });
  }

  // For each quiet candidate, fetch their most-recent completed session
  // (could be older than 7 days, just outside the welcomeBackCutoff
  // window). One query, ordered desc, then max-per-user in code.
  const { data: latestSessions } = await supabase
    .from('sessions')
    .select('user_id, end_time')
    .in('user_id', quietIds)
    .eq('status', 'completed')
    .order('end_time', { ascending: false });

  const lastSessionMs = new Map<string, number>();
  for (const s of latestSessions ?? []) {
    if (!lastSessionMs.has(s.user_id as string)) {
      lastSessionMs.set(s.user_id as string, new Date(s.end_time as string).getTime());
    }
  }

  // ── 3. Cooldown filtering — separate per email type ────────────────
  // A user who got welcome-back 30 days ago is fresh for re-engagement
  // but NOT for another welcome-back (60d cooldown). Two separate
  // queries so the windows don't bleed.
  const [reEngagementCooldownRows, welcomeBackCooldownRows] = await Promise.all([
    supabase
      .from('email_log')
      .select('user_id')
      .in('user_id', quietIds)
      .eq('email_type', 're_engagement')
      .gte('created_at', reEngagementCooldownCutoff),
    supabase
      .from('email_log')
      .select('user_id')
      .in('user_id', quietIds)
      .eq('email_type', 'welcome_back')
      .gte('created_at', welcomeBackCooldownCutoff),
  ]);

  const inReEngagementCooldown = new Set(
    (reEngagementCooldownRows.data ?? []).map((e) => e.user_id),
  );
  const inWelcomeBackCooldown = new Set(
    (welcomeBackCooldownRows.data ?? []).map((e) => e.user_id),
  );

  // ── 4. Filter out unsubscribers + soft-deleted ──────────────────────
  const [{ data: prefs }, { data: profiles }] = await Promise.all([
    supabase
      .from('email_preferences')
      .select('user_id, unsubscribed_all')
      .in('user_id', quietIds),
    supabase
      .from('profiles')
      .select('id, name, deleted_at')
      .in('id', quietIds),
  ]);

  const unsubscribed = new Set(
    (prefs ?? []).filter((p) => p.unsubscribed_all).map((p) => p.user_id),
  );
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const authUsers = await listAllAuthUsers(supabase);
  const emailMap = new Map(authUsers.map((u) => [u.id, u.email]));

  const allCandidates: Candidate[] = quietIds
    .map((id) => {
      if (unsubscribed.has(id)) return null;
      const profile = profileMap.get(id);
      if (!profile || profile.deleted_at) return null;
      const email = emailMap.get(id);
      if (!email) return null;
      const lastMs = lastSessionMs.get(id);
      const daysQuiet = lastMs
        ? Math.floor((now - lastMs) / (24 * 60 * 60 * 1000))
        : Number.POSITIVE_INFINITY;
      return {
        user_id: id,
        email,
        name: profile.name || 'there',
        daysQuiet,
      };
    })
    .filter((c): c is Candidate => c !== null);

  // ── 5. Bucket into welcome-back vs re-engagement ───────────────────
  // 14+ days dormant → re-engagement (strong nudge, gated by 30d cooldown).
  // 7-13 days dormant → welcome-back (gentle nudge, gated by 60d cooldown).
  // 14+ users who are in re-engagement cooldown SKIP entirely (don't
  // downgrade them to welcome-back — they already heard from us).
  const reEngagementCandidates = allCandidates.filter(
    (c) => c.daysQuiet >= QUIET_DAYS_THRESHOLD && !inReEngagementCooldown.has(c.user_id),
  );
  const welcomeBackCandidates = allCandidates.filter(
    (c) =>
      c.daysQuiet >= WELCOME_BACK_THRESHOLD &&
      c.daysQuiet < QUIET_DAYS_THRESHOLD &&
      !inWelcomeBackCooldown.has(c.user_id),
  );

  if (reEngagementCandidates.length === 0 && welcomeBackCandidates.length === 0) {
    await recordCronRun('re-engagement', 'success', { sent: 0, reason: 'all_in_cooldown_or_filtered' });
    return NextResponse.json({ sent: 0, reason: 'all in cooldown or filtered' });
  }

  // ── 6. Fan-out send (both buckets concurrently) ────────────────────
  const errors: string[] = [];
  let sentReEngagement = 0;
  let sentWelcomeBack = 0;

  type EmailJob = {
    candidate: Candidate;
    template: 're_engagement' | 'welcome_back';
  };
  const jobs: EmailJob[] = [
    ...reEngagementCandidates.map((c) => ({ candidate: c, template: 're_engagement' as const })),
    ...welcomeBackCandidates.map((c) => ({ candidate: c, template: 'welcome_back' as const })),
  ];

  const results = await concurrentMap(jobs, RE_ENGAGEMENT_CONCURRENCY, async (job) => {
    const c = job.candidate;
    const { subject, html } = job.template === 'welcome_back'
      ? welcomeBackEmail({ userName: c.name, daysQuiet: c.daysQuiet })
      : reEngagementEmail({ userName: c.name, daysQuiet: c.daysQuiet });
    const r = await sendEmail({
      to: c.email,
      subject,
      html,
      tags: [{ name: 'type', value: job.template }],
    });
    await logEmail({
      userId: c.user_id,
      emailTo: c.email,
      emailType: job.template,
      subject,
      resendId: r?.id,
    });
    return job.template;
  });

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok) {
      errors.push(
        `${jobs[i].candidate.email}: ${r.error instanceof Error ? r.error.message : 'unknown'}`,
      );
    } else if (r.value === 'welcome_back') {
      sentWelcomeBack++;
    } else {
      sentReEngagement++;
    }
  }

  const sent = sentReEngagement + sentWelcomeBack;
  await recordCronRun('re-engagement', 'success', {
    sent,
    sentReEngagement,
    sentWelcomeBack,
    consideredReEngagement: reEngagementCandidates.length,
    consideredWelcomeBack: welcomeBackCandidates.length,
    errorCount: errors.length,
  });
  return NextResponse.json({
    sent,
    sent_re_engagement: sentReEngagement,
    sent_welcome_back: sentWelcomeBack,
    considered_re_engagement: reEngagementCandidates.length,
    considered_welcome_back: welcomeBackCandidates.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
