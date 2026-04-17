import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { paymentFailedEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/webhooks/razorpay
 * Handles Razorpay webhook events for subscription lifecycle.
 *
 * Required env:
 * - RAZORPAY_WEBHOOK_SECRET   (hard requirement — we fail closed)
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Events handled:
 * - subscription.authenticated → first-time authorization, trial begins
 * - subscription.activated     → authorization charge went through
 * - subscription.charged       → recurring payment succeeded → active + extend period
 * - subscription.pending       → payment retry underway → past_due
 * - subscription.halted        → retries exhausted → past_due (recoverable with new card)
 * - subscription.cancelled     → user or system cancelled
 * - subscription.completed     → subscription finished naturally → expired
 *
 * Guarantees:
 * - Signature verification is mandatory; missing secret → 500, bad signature → 400
 * - Idempotent: same event.id processed twice becomes a no-op (recorded in webhook_events)
 * - Captures razorpay_payment_id on successful charges for auditability
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature') || '';
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

  // ── 1. Signature verification (fail closed) ────────────────────
  if (!webhookSecret) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    console.error('[razorpay-webhook] Signature mismatch');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // ── 2. Parse payload ───────────────────────────────────────────
  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId = event.id || `${event.event}:${event.created_at}:${event.payload?.subscription?.entity?.id ?? 'unknown'}`;
  const eventType = event.event;
  const subEntity = event.payload?.subscription?.entity;
  const paymentEntity = event.payload?.payment?.entity;
  const subscriptionId = subEntity?.id;
  const paymentId = paymentEntity?.id;

  // ── 3. Admin Supabase client ───────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[razorpay-webhook] Supabase admin credentials missing');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const supabase: SupabaseClient = createAdminClient(supabaseUrl, supabaseServiceKey);

  // ── 4. Idempotency: record the event; if it already exists, skip ─
  const { data: insertRow, error: insertErr } = await supabase
    .from('webhook_events')
    .insert({
      event_id: eventId,
      event_type: eventType,
      subscription_id: subscriptionId ?? null,
      payment_id: paymentId ?? null,
      payload: event,
      status: 'processed',
    })
    .select('event_id')
    .maybeSingle();

  if (insertErr) {
    // Unique violation on event_id → we've already seen this event
    if (insertErr.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[razorpay-webhook] Failed to record event:', insertErr);
    // Don't return 500 — Razorpay will retry and we'd loop. Log and continue.
  }

  // ── 5. If the event has no subscription id, ack and move on ────
  if (!subscriptionId) {
    return NextResponse.json({ received: true, noop: true });
  }

  try {
    await handleEvent({ supabase, eventType, subscriptionId, paymentId, subEntity });
    return NextResponse.json({ received: true, eventType });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[razorpay-webhook] Handler failed:', eventType, msg);
    // Mark the event as failed so ops can see it
    if (insertRow) {
      await supabase
        .from('webhook_events')
        .update({ status: 'failed', error: msg })
        .eq('event_id', eventId);
    }
    // Return 200 to prevent infinite retry loops; error logged for ops review.
    return NextResponse.json({ received: true, error: msg }, { status: 200 });
  }
}

// ── Handlers ──────────────────────────────────────────────────────

type SubEntity = {
  id: string;
  status?: string;
  current_end?: number;
  current_start?: number;
  charge_at?: number;
  end_at?: number;
  short_url?: string;
};

async function handleEvent({
  supabase,
  eventType,
  subscriptionId,
  paymentId,
  subEntity,
}: {
  supabase: SupabaseClient;
  eventType: string;
  subscriptionId: string;
  paymentId?: string;
  subEntity?: SubEntity;
}) {
  const periodEnd = subEntity?.current_end
    ? new Date(subEntity.current_end * 1000).toISOString()
    : null;

  switch (eventType) {
    case 'subscription.authenticated': {
      // User completed authorization — trial begins. The subscription row
      // was created in /api/subscription/create so should already be 'trialing'.
      // We just confirm the status here.
      await supabase
        .from('subscriptions')
        .update({ status: 'trialing' })
        .eq('razorpay_subscription_id', subscriptionId);
      return;
    }

    case 'subscription.activated': {
      // Subscription is active (auth charge or first paid charge succeeded).
      await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          ...(periodEnd ? { current_period_end: periodEnd } : {}),
          ...(paymentId ? { razorpay_payment_id: paymentId } : {}),
        })
        .eq('razorpay_subscription_id', subscriptionId);
      return;
    }

    case 'subscription.charged': {
      // Recurring or first-post-trial payment went through.
      await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          cancelled_at: null, // revive if previously cancelled but still charged
          ...(periodEnd ? { current_period_end: periodEnd } : {}),
          ...(paymentId ? { razorpay_payment_id: paymentId } : {}),
        })
        .eq('razorpay_subscription_id', subscriptionId);
      return;
    }

    case 'subscription.pending': {
      // Payment failed, retry underway. Flag as past_due so the UI can
      // prompt the user to update their card.
      await supabase
        .from('subscriptions')
        .update({ status: 'past_due' })
        .eq('razorpay_subscription_id', subscriptionId);
      // Best-effort payment-failed notice (idempotent per subscription + event).
      await notifyPaymentFailed({
        supabase,
        subscriptionId,
        shortUrl: subEntity?.short_url,
        isHalted: false,
      }).catch(err => console.error('[razorpay-webhook] notifyPaymentFailed (pending) failed:', err));
      return;
    }

    case 'subscription.halted': {
      // Retries exhausted. Keep as past_due (not expired) — user can still
      // recover by updating their card; we block access via gating, not
      // via data deletion.
      await supabase
        .from('subscriptions')
        .update({ status: 'past_due' })
        .eq('razorpay_subscription_id', subscriptionId);
      await notifyPaymentFailed({
        supabase,
        subscriptionId,
        shortUrl: subEntity?.short_url,
        isHalted: true,
      }).catch(err => console.error('[razorpay-webhook] notifyPaymentFailed (halted) failed:', err));
      return;
    }

    case 'subscription.cancelled': {
      await supabase
        .from('subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('razorpay_subscription_id', subscriptionId);
      return;
    }

    case 'subscription.completed': {
      // Subscription finished naturally (reached total_count or end_at).
      await supabase
        .from('subscriptions')
        .update({ status: 'expired' })
        .eq('razorpay_subscription_id', subscriptionId);
      return;
    }

    default:
      // Unhandled event — we logged it in webhook_events; no state change.
      return;
  }
}

// ── Payment-failed notification ───────────────────────────────────

/**
 * Sends a payment-failed email, with per-(subscription, halted/pending) idempotency
 * enforced via email_log. Called fire-and-forget from the webhook handlers so a
 * transient Resend blip never fails the whole webhook — Razorpay's retry would
 * then double-update subscription state.
 */
async function notifyPaymentFailed({
  supabase,
  subscriptionId,
  shortUrl,
  isHalted,
}: {
  supabase: SupabaseClient;
  subscriptionId: string;
  shortUrl?: string;
  isHalted: boolean;
}) {
  // Resolve the local subscription row \u2192 user.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, user_id')
    .eq('razorpay_subscription_id', subscriptionId)
    .maybeSingle();
  if (!sub) return;

  // Respect unsubscribed_all.
  const { data: prefs } = await supabase
    .from('email_preferences')
    .select('unsubscribed_all')
    .eq('user_id', sub.user_id)
    .maybeSingle();
  if (prefs?.unsubscribed_all) return;

  const logType = isHalted ? 'payment_failed_halted' : 'payment_failed_pending';

  // Don't spam: only one email per (sub, halted flag).
  const { data: prior } = await supabase
    .from('email_log')
    .select('id')
    .eq('user_id', sub.user_id)
    .eq('email_type', logType)
    .contains('metadata', { subscription_id: sub.id })
    .limit(1)
    .maybeSingle();
  if (prior) return;

  // Look up email + name for rendering.
  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', sub.user_id)
    .maybeSingle();

  const { data: authUser } = await supabase.auth.admin.getUserById(sub.user_id);
  const email = authUser?.user?.email;
  if (!email) return;

  const { subject, html } = paymentFailedEmail({
    userName: (profile?.name as string | undefined) || 'there',
    subscriptionShortUrl: shortUrl || null,
    isHalted,
  });

  const { data: sendResult, error: sendErr } = await (async () => {
    try {
      const r = await sendEmail({
        to: email,
        subject,
        html,
        tags: [
          { name: 'type', value: logType },
          { name: 'subscription_id', value: sub.id },
        ],
      });
      return { data: r, error: null as unknown };
    } catch (err) {
      return { data: null, error: err };
    }
  })();

  if (sendErr) {
    console.error('[razorpay-webhook] payment-failed email send failed:', sendErr);
    return;
  }

  await supabase.from('email_log').insert({
    user_id: sub.user_id,
    email_to: email,
    email_type: logType,
    subject,
    resend_id: sendResult?.id ?? null,
    status: 'sent',
    metadata: { subscription_id: sub.id, halted: isHalted },
  });
}

// ── Types ─────────────────────────────────────────────────────────

type RazorpayEvent = {
  id?: string;
  event: string;
  created_at?: number;
  payload?: {
    subscription?: { entity?: SubEntity };
    payment?: { entity?: { id?: string; status?: string; amount?: number; currency?: string } };
  };
};
