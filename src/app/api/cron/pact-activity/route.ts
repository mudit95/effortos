import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getAdminSupabase, listAllAuthUsers, logEmail } from '@/lib/cron-helpers';
import { sendEmail, emailLayout, APP_URL } from '@/lib/email';
import { sendTextMessage } from '@/lib/whatsapp';
import { concurrentMap } from '@/lib/concurrency';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 60s on Vercel Hobby. Each pact yields 2 notifications; with concurrency
// 6 and ~3s per send, fits ~120 pact-pairs per run. At higher scale,
// upgrade to Pro or add per-page batching.
export const maxDuration = 60;

/**
 * GET /api/cron/pact-activity
 *
 * Daily nudge for accountability-pact partners. Pacts surface each
 * other's stats inside the app, but partners only see them when they
 * actually log in — which most pact-partners don't do daily. A short
 * nightly "Aanya did 3 sessions yesterday · 32m focused" reminder keeps
 * the social pressure live and is the highest-leverage retention
 * touch we have for engaged users.
 *
 * Sent only when the partner actually did something yesterday (a "0
 * sessions" notification would be the worst possible vibe). Idempotent
 * via email_log type='pact_activity' + per-(pact_id, recipient_user_id)
 * dedup window of 22 hours.
 *
 * Channel: WhatsApp if the recipient has linked a phone, email otherwise.
 * Whichever channel they preferred for the bot is the right one for this.
 *
 * Scheduled daily at 07:30 UTC. Auth via standard CRON_SECRET bearer.
 */

interface ActivePact {
  id: string;
  user_id: string;
  partner_user_id: string;
}

interface RecipientProfile {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  whatsapp_linked: boolean;
}

interface ActivityStats {
  sessionsYesterday: number;
  focusMinutesYesterday: number;
}

const COOLDOWN_HOURS = 22;
const PACT_ACTIVITY_CONCURRENCY = 6;

// ── Helpers ─────────────────────────────────────────────────────────

function partnerActivityEmail(opts: {
  recipientName: string;
  partnerName: string;
  sessions: number;
  focusMinutes: number;
}): { subject: string; html: string } {
  const firstName = (opts.recipientName || 'there').split(' ')[0];
  const partnerFirst = (opts.partnerName || 'your pact partner').split(' ')[0];
  const hours = Math.floor(opts.focusMinutes / 60);
  const mins = opts.focusMinutes % 60;
  const focusStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  let body = `<h1>${partnerFirst} put in the work yesterday</h1>`;
  body += `<p>Hey ${firstName} — quick pact check-in.</p>`;
  body += `<p><strong style="color:#e2e8f0;">${partnerFirst}</strong> ran <strong style="color:#e2e8f0;">${opts.sessions} session${opts.sessions === 1 ? '' : 's'}</strong> yesterday and logged <strong style="color:#e2e8f0;">${focusStr}</strong> of focused work.</p>`;
  body += `<p>Your turn today.</p>`;
  body += `<a href="${APP_URL}/dashboard" class="btn">Open EffortOS &rarr;</a>`;
  return {
    subject: `${partnerFirst} did ${opts.sessions} session${opts.sessions === 1 ? '' : 's'} yesterday`,
    html: emailLayout(body, { preheader: `${focusStr} of focused work. Your move.` }),
  };
}

function partnerActivityWhatsApp(opts: {
  recipientName: string;
  partnerName: string;
  sessions: number;
  focusMinutes: number;
}): string {
  const firstName = (opts.recipientName || 'there').split(' ')[0];
  const partnerFirst = (opts.partnerName || 'your partner').split(' ')[0];
  const hours = Math.floor(opts.focusMinutes / 60);
  const mins = opts.focusMinutes % 60;
  const focusStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return `🤝 *Pact check-in, ${firstName}.*\n\n${partnerFirst} ran ${opts.sessions} session${opts.sessions === 1 ? '' : 's'} yesterday · ${focusStr} focused.\n\nYour turn today.`;
}

// ── Main ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = getAdminSupabase();
  const now = new Date();
  // We use UTC "yesterday" as the window. Pacts cross timezones; using
  // UTC keeps "yesterday" a stable definition for both sides. Partners
  // in the same zone get an intuitive reading; far-apart zones get a
  // ~24h-rolling read which is still useful.
  const yesterdayStart = new Date(now);
  yesterdayStart.setUTCHours(0, 0, 0, 0);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  const yesterdayEnd = new Date(yesterdayStart);
  yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() + 1);

  // ── 1. Active pacts ─────────────────────────────────────────────
  const { data: pacts, error: pactsErr } = await supabase
    .from('pacts')
    .select('id, user_id, partner_user_id')
    .eq('status', 'active')
    .not('partner_user_id', 'is', null);

  if (pactsErr) {
    console.error('[pact-activity] pacts query failed:', pactsErr);
    await recordCronRun('pact-activity', 'failure', { reason: 'pacts_query_failed' });
    return NextResponse.json({ error: 'Pacts query failed' }, { status: 500 });
  }
  const activePacts: ActivePact[] = (pacts ?? []).filter(
    (p): p is ActivePact => !!p.partner_user_id,
  );
  if (activePacts.length === 0) {
    await recordCronRun('pact-activity', 'success', { sent: 0, reason: 'no_active_pacts' });
    return NextResponse.json({ sent: 0, reason: 'no active pacts' });
  }

  // ── 2. Build recipient × subject pairs ─────────────────────────
  // Each pact yields TWO notifications: A→B and B→A. We dedup
  // recipients later via the email_log cooldown.
  interface Pair { pactId: string; recipientId: string; subjectId: string }
  const pairs: Pair[] = [];
  for (const p of activePacts) {
    pairs.push({ pactId: p.id, recipientId: p.user_id, subjectId: p.partner_user_id });
    pairs.push({ pactId: p.id, recipientId: p.partner_user_id, subjectId: p.user_id });
  }

  const allUserIds = Array.from(new Set(pairs.flatMap((pa) => [pa.recipientId, pa.subjectId])));

  // ── 3. Pre-fetch profiles, auth emails, recent send-log ────────
  const cooldownCutoff = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  const [{ data: profiles }, { data: prefs }, authUsers, { data: recentSent }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, phone_number, whatsapp_linked, deleted_at')
      .in('id', allUserIds),
    supabase
      .from('email_preferences')
      .select('user_id, unsubscribed_all')
      .in('user_id', allUserIds),
    listAllAuthUsers(supabase),
    supabase
      .from('email_log')
      .select('user_id, metadata')
      .eq('email_type', 'pact_activity')
      .gte('created_at', cooldownCutoff),
  ]);

  const profileMap = new Map<string, RecipientProfile>();
  for (const p of profiles ?? []) {
    if (p.deleted_at) continue;
    profileMap.set(p.id, {
      id: p.id,
      name: p.name || 'there',
      email: null,
      phone_number: p.phone_number ?? null,
      whatsapp_linked: !!p.whatsapp_linked,
    });
  }
  for (const u of authUsers) {
    const entry = profileMap.get(u.id);
    if (entry) entry.email = u.email ?? null;
  }
  const unsubscribed = new Set(
    (prefs ?? []).filter((p) => p.unsubscribed_all).map((p) => p.user_id),
  );

  // pact_id+recipient combo → already nudged within cooldown window.
  const cooledOff = new Set(
    (recentSent ?? [])
      .map((r) => {
        const meta = r.metadata as { pact_id?: string } | null;
        return meta?.pact_id && r.user_id ? `${meta.pact_id}:${r.user_id}` : null;
      })
      .filter((k): k is string => k != null),
  );

  // ── 4. Compute yesterday's session activity per subject ────────
  const subjectIds = Array.from(new Set(pairs.map((pa) => pa.subjectId)));
  const { data: sessionsYesterday } = await supabase
    .from('sessions')
    .select('user_id, duration')
    .in('user_id', subjectIds)
    .eq('status', 'completed')
    .gte('start_time', yesterdayStart.toISOString())
    .lt('start_time', yesterdayEnd.toISOString());

  const activityBySubject = new Map<string, ActivityStats>();
  for (const s of sessionsYesterday ?? []) {
    const cur = activityBySubject.get(s.user_id) || { sessionsYesterday: 0, focusMinutesYesterday: 0 };
    cur.sessionsYesterday += 1;
    cur.focusMinutesYesterday += Math.round(((s.duration as number) ?? 0) / 60);
    activityBySubject.set(s.user_id, cur);
  }

  // ── 5. Send (parallel, concurrency-bounded) ────────────────────
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  const results = await concurrentMap(pairs, PACT_ACTIVITY_CONCURRENCY, async (pair) => {
    const subjectActivity = activityBySubject.get(pair.subjectId);
    // Don't send if the partner did literally nothing yesterday — that's
    // the wrong vibe for an accountability nudge.
    if (!subjectActivity || subjectActivity.sessionsYesterday === 0) {
      return { kind: 'skipped' as const, reason: 'no_activity' };
    }
    if (cooledOff.has(`${pair.pactId}:${pair.recipientId}`)) {
      return { kind: 'skipped' as const, reason: 'cooldown' };
    }
    if (unsubscribed.has(pair.recipientId)) {
      return { kind: 'skipped' as const, reason: 'unsubscribed' };
    }
    const recipient = profileMap.get(pair.recipientId);
    const subject = profileMap.get(pair.subjectId);
    if (!recipient || !subject) {
      return { kind: 'skipped' as const, reason: 'profile_missing' };
    }

    // WhatsApp if the recipient is linked, else email.
    if (recipient.whatsapp_linked && recipient.phone_number) {
      const message = partnerActivityWhatsApp({
        recipientName: recipient.name,
        partnerName: subject.name,
        sessions: subjectActivity.sessionsYesterday,
        focusMinutes: subjectActivity.focusMinutesYesterday,
      });
      const phone = recipient.phone_number.replace(/^\+/, '');
      await sendTextMessage(phone, message);
      // Still log to email_log for the cooldown dedup — `email_log` has
      // become our generic "we nudged this user via X" log.
      await logEmail({
        userId: pair.recipientId,
        emailTo: recipient.email ?? '',
        emailType: 'pact_activity',
        subject: 'WhatsApp pact_activity',
        metadata: { pact_id: pair.pactId, channel: 'whatsapp' },
      });
      return { kind: 'sent' as const, channel: 'whatsapp' };
    }

    if (!recipient.email) {
      return { kind: 'skipped' as const, reason: 'no_channel' };
    }
    const { subject: subjectLine, html } = partnerActivityEmail({
      recipientName: recipient.name,
      partnerName: subject.name,
      sessions: subjectActivity.sessionsYesterday,
      focusMinutes: subjectActivity.focusMinutesYesterday,
    });
    const r = await sendEmail({
      to: recipient.email,
      subject: subjectLine,
      html,
      tags: [{ name: 'type', value: 'pact_activity' }],
    });
    await logEmail({
      userId: pair.recipientId,
      emailTo: recipient.email,
      emailType: 'pact_activity',
      subject: subjectLine,
      resendId: r?.id,
      metadata: { pact_id: pair.pactId, channel: 'email' },
    });
    return { kind: 'sent' as const, channel: 'email' };
  });

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok) {
      errors.push(
        `${pairs[i].pactId}:${pairs[i].recipientId}: ${r.error instanceof Error ? r.error.message : 'unknown'}`,
      );
      continue;
    }
    if (r.value.kind === 'sent') sent++;
    else skipped++;
  }

  await recordCronRun('pact-activity', 'success', {
    sent,
    skipped,
    pairs: pairs.length,
    errorCount: errors.length,
  });
  return NextResponse.json({
    sent,
    skipped,
    pairs: pairs.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
