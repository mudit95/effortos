import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getAdminSupabase, logEmail } from '@/lib/cron-helpers';
import { trialEndingEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/trial-ending
 *
 * Runs once daily. Finds subscriptions that are still `trialing` and whose
 * `current_period_end` falls in the next 24\u201348 hour window, then sends a
 * heads-up email so the user isn't surprised by the first charge.
 *
 * Idempotency: we insert a row into `email_log` with email_type='trial_ending'
 * and a metadata.subscription_id key. Before sending we check whether such
 * a row already exists for the current subscription — skip if yes.
 *
 * Scheduled from vercel.json. Expects Authorization: Bearer CRON_SECRET.
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = getAdminSupabase();

  // ── 1. Find trialing subscriptions ending in the next 24\u201348h window ──
  const now = new Date();
  const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { data: subs, error: subsErr } = await supabase
    .from('subscriptions')
    .select('id, user_id, current_period_end, razorpay_subscription_id')
    .eq('status', 'trialing')
    .gte('current_period_end', windowStart.toISOString())
    .lt('current_period_end', windowEnd.toISOString());

  if (subsErr) {
    console.error('[trial-ending] Subs query failed:', subsErr);
    return NextResponse.json({ error: 'Subscription query failed' }, { status: 500 });
  }
  if (!subs || subs.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no trialing subs ending in window' });
  }

  // ── 2. Pull profile + email prefs + auth email in one pass ─────
  const userIds = subs.map(s => s.user_id);

  const [{ data: profiles }, { data: prefs }, { data: { users: authUsers } }] = await Promise.all([
    supabase.from('profiles').select('id, name').in('id', userIds),
    supabase
      .from('email_preferences')
      .select('user_id, unsubscribed_all')
      .in('user_id', userIds),
    supabase.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const profileMap = new Map(profiles?.map(p => [p.id, p.name]) || []);
  const unsubSet = new Set(
    (prefs || []).filter(p => p.unsubscribed_all).map(p => p.user_id),
  );
  const emailMap = new Map(
    (authUsers || []).map(u => [u.id, u.email]),
  );

  // ── 3. Send, with per-subscription idempotency via email_log ───
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const sub of subs) {
    try {
      if (unsubSet.has(sub.user_id)) { skipped++; continue; }
      const email = emailMap.get(sub.user_id);
      if (!email) { skipped++; continue; }

      // Idempotency: already mailed for this subscription?
      const { data: prior } = await supabase
        .from('email_log')
        .select('id')
        .eq('user_id', sub.user_id)
        .eq('email_type', 'trial_ending')
        .contains('metadata', { subscription_id: sub.id })
        .limit(1)
        .maybeSingle();
      if (prior) { skipped++; continue; }

      const userName = profileMap.get(sub.user_id) || 'there';
      const { subject, html } = trialEndingEmail({
        userName: userName as string,
        trialEndsAt: new Date(sub.current_period_end),
      });

      const result = await sendEmail({
        to: email,
        subject,
        html,
        tags: [
          { name: 'type', value: 'trial_ending' },
          { name: 'subscription_id', value: sub.id },
        ],
      });

      await logEmail({
        userId: sub.user_id,
        emailTo: email,
        emailType: 'trial_ending',
        subject,
        resendId: result?.id,
        metadata: { subscription_id: sub.id, trial_ends_at: sub.current_period_end },
      });

      sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      errors.push(`${sub.id}: ${msg}`);
      console.error('[trial-ending] Send failed for sub', sub.id, msg);
    }
  }

  return NextResponse.json({
    sent,
    skipped,
    considered: subs.length,
    errors: errors.length ? errors : undefined,
  });
}
