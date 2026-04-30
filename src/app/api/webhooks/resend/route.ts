import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/resend
 *
 * Resend posts events about every email we send: delivered, opened,
 * clicked, bounced, complained, etc. The two we care about for
 * deliverability are:
 *
 *   - email.bounced     → recipient address is bad / mailbox full / etc.
 *   - email.complained  → recipient hit "Report spam" in their client.
 *
 * Each of those, left unaddressed, hurts our sender reputation. After ~50
 * uncorrected bounces from a single domain, Gmail starts rate-limiting our
 * sends. After ~3-5 spam complaints in a 30-day window, Microsoft / Yahoo
 * suppress us outright. Every transactional / lifecycle email after that
 * point silently lands in spam.
 *
 * The simplest correct response: when we see either event, flip
 * `email_preferences.unsubscribed_all = true` for that user so the cron
 * jobs stop addressing them. We also annotate `email_log.status` so the
 * admin email panel shows the bounce/complaint history.
 *
 * Setup (operational):
 *   1. Resend dashboard → Webhooks → Add endpoint
 *      URL: https://<your-domain>/api/webhooks/resend
 *      Events: email.bounced, email.complained
 *   2. Copy the signing secret, set RESEND_WEBHOOK_SECRET in Vercel.
 *   3. Resend signs each request with svix-style headers.
 *
 * Signature verification: Resend uses Svix. We accept either a real
 * Svix-style HMAC OR (in dev) the absence of the secret env var as a
 * permissive bypass. Production deploys MUST set RESEND_WEBHOOK_SECRET.
 */

interface ResendEvent {
  type: string;             // e.g. 'email.bounced'
  data: {
    email_id?: string;
    to?: string[];
    from?: string;
    subject?: string;
    bounce?: { type?: string; subType?: string; diagnostic_code?: string };
    [k: string]: unknown;
  };
  created_at?: string;
}

function verifySvixSignature(
  rawBody: string,
  headers: Headers,
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // Dev / unconfigured: allow but warn loudly. Production MUST set the secret.
    if (process.env.NODE_ENV === 'production') {
      console.error('[resend-webhook] RESEND_WEBHOOK_SECRET not set in production — rejecting');
      return false;
    }
    console.warn('[resend-webhook] No webhook secret set; allowing request (dev mode)');
    return true;
  }

  const svixId = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Replay-attack guard: reject signatures more than 5 minutes off wall
  // clock. Svix recommends this.
  const tsSeconds = Number(svixTimestamp);
  if (!Number.isFinite(tsSeconds)) return false;
  const drift = Math.abs(Date.now() / 1000 - tsSeconds);
  if (drift > 5 * 60) return false;

  // Resend / Svix secrets are prefixed with `whsec_` and base64-encoded.
  const trimmed = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(trimmed, 'base64');
  } catch {
    return false;
  }

  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', key).update(signedPayload).digest('base64');

  // svixSignature looks like "v1,<sig1> v1,<sig2>" — at least one must match.
  const candidates = svixSignature.split(' ').map(s => s.split(',')[1]).filter(Boolean);
  for (const candidate of candidates) {
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(candidate);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!verifySvixSignature(rawBody, request.headers)) {
    console.error('[resend-webhook] Signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
  }

  const type = event.type;
  if (type !== 'email.bounced' && type !== 'email.complained') {
    // Ignore other event types (delivered, opened, clicked) — Resend will
    // still see a 200 and stop retrying.
    return NextResponse.json({ ignored: true, type });
  }

  const recipient = event.data.to?.[0]?.toLowerCase();
  if (!recipient) {
    return NextResponse.json({ error: 'Missing recipient' }, { status: 400 });
  }

  const service = createServiceClient();

  // Resolve email → user_id via the auth admin API. We don't trust
  // profiles.email (which can drift); the auth.users source-of-truth is
  // what every other route resolves against.
  const { data: usersPage, error: listErr } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) {
    console.error('[resend-webhook] auth.admin.listUsers failed:', listErr);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  const matched = usersPage.users.find(u => u.email?.toLowerCase() === recipient);

  // Always annotate the email_log so the admin Email panel surfaces the
  // failure even when we can't resolve a user (rare, but possible if the
  // address belonged to a deleted account by the time the bounce arrived).
  if (event.data.email_id) {
    try {
      await service
        .from('email_log')
        .update({
          status: type === 'email.bounced' ? 'bounced' : 'failed',
          error: type === 'email.complained' ? 'spam_complaint' : (event.data.bounce?.diagnostic_code ?? type),
        })
        .eq('resend_id', event.data.email_id);
    } catch (err) {
      console.warn('[resend-webhook] email_log annotation failed:', err);
    }
  }

  if (!matched) {
    // No-account-for-email: silent success. Don't leak existence either way.
    return NextResponse.json({ ok: true, recipient_resolved: false });
  }

  // Flip the master kill-switch so cron jobs stop addressing this user.
  // We deliberately don't disable individual `morning_email`/`afternoon_email`
  // flags so a manual support intervention can still send a focused
  // recovery message; only the broad cron path is silenced.
  const { error: upErr } = await service
    .from('email_preferences')
    .upsert(
      {
        user_id: matched.id,
        unsubscribed_all: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (upErr) {
    console.error('[resend-webhook] email_preferences upsert failed:', upErr);
    return NextResponse.json({ error: 'Upsert failed' }, { status: 500 });
  }

  console.log(
    `[resend-webhook] Suppressed ${recipient} for ${type} (user ${matched.id})`,
  );
  return NextResponse.json({ ok: true });
}
