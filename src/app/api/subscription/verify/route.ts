import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendProWelcome } from '@/lib/coach-welcome';
import { track } from '@/lib/analytics';

/**
 * POST /api/subscription/verify
 * Verifies Razorpay payment signature after checkout.
 * Activates the subscription (trial starts).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
      plan_tier,
    } = body;

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 });
    }

    // Verify signature.
    //
    // We compare with crypto.timingSafeEqual to avoid leaking secrets via
    // string-comparison side channels. Both buffers must be the same
    // length or Node throws, so we validate length before comparing.
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    let signatureValid = false;
    try {
      const a = Buffer.from(generatedSignature, 'hex');
      const b = Buffer.from(String(razorpay_signature), 'hex');
      signatureValid = a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Validate plan_tier — but never trust the client. We will only use this
    // as a fallback when the existing row has no plan_tier. The authoritative
    // tier is whatever `subscription/create` wrote at checkout-time.
    const fallbackPlanTier: 'starter' | 'pro' =
      plan_tier === 'pro' ? 'pro' : 'starter';

    // Writes to `subscriptions`/`coupon_redemptions`/`coupons` go through
    // the service-role client (post-migration 022, RLS denies authenticated
    // mutations). We intentionally re-read the existing row first so we can
    // (a) avoid downgrading a webhook-set 'active' back to 'trialing' and
    // (b) preserve the server-stored plan_tier instead of trusting the body.
    const service = createServiceClient();

    const { data: existing } = await service
      .from('subscriptions')
      .select('id, status, plan_tier, current_period_end, applied_coupon_id')
      .eq('user_id', user.id)
      .eq('razorpay_subscription_id', razorpay_subscription_id)
      .maybeSingle();

    const authoritativeTier: 'starter' | 'pro' =
      (existing?.plan_tier === 'pro' || existing?.plan_tier === 'starter')
        ? existing.plan_tier
        : fallbackPlanTier;

    // Status precedence: never write a "lower" status over a higher one.
    //   active (premium)  > past_due > trialing > cancelled > expired
    // If the webhook already promoted the row to active/past_due before
    // verify ran (or admin already granted), keep that.
    const PRECEDENCE: Record<string, number> = {
      active:    5,
      past_due:  4,
      trialing:  3,
      cancelled: 2,
      expired:   1,
      none:      0,
    };
    const currentPrecedence = PRECEDENCE[existing?.status ?? 'none'] ?? 0;
    const trialingPrecedence = PRECEDENCE.trialing;
    const nextStatus =
      currentPrecedence > trialingPrecedence ? existing!.status : 'trialing';

    // Update subscription — verified payment, persist signed payment id.
    // Don't clobber status unless we're moving up the precedence ladder.
    await service
      .from('subscriptions')
      .update({
        status: nextStatus,
        plan_tier: authoritativeTier,
        razorpay_payment_id,
        verified_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('razorpay_subscription_id', razorpay_subscription_id);

    // If a coupon was applied at subscribe time, record the redemption now.
    // .maybeSingle() because a verify replay (idempotency) could leave us
    // querying a row that's already been processed; treat missing as no-op.
    if (existing?.applied_coupon_id) {
      const { data: alreadyRedeemed } = await service
        .from('coupon_redemptions')
        .select('id')
        .eq('coupon_id', existing.applied_coupon_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!alreadyRedeemed) {
        const { error: insertErr } = await service
          .from('coupon_redemptions')
          .insert({
            coupon_id: existing.applied_coupon_id,
            user_id: user.id,
          });
        // Only bump the counter if the redemption was actually inserted —
        // a race-loser sees a unique-constraint error and we must NOT count
        // it (otherwise the counter overshoots).
        if (!insertErr) {
          const { data: coupon } = await service
            .from('coupons')
            .select('redemption_count')
            .eq('id', existing.applied_coupon_id)
            .maybeSingle();
          if (coupon) {
            await service
              .from('coupons')
              .update({ redemption_count: (coupon.redemption_count ?? 0) + 1 })
              .eq('id', existing.applied_coupon_id);
          }
        }
      }
    }

    // If this is a Pro tier subscription, send the welcome message
    if (authoritativeTier === 'pro') {
      // Fire and forget — don't block the verify response
      sendProWelcome(user.id).catch((err) =>
        console.error('[Coach] Welcome message failed:', err),
      );
    }

    // Funnel: trial started or upgrade landed. The first-charge event
    // fires later in the Razorpay webhook 'subscription.charged' handler.
    void track({
      distinctId: user.id,
      event: 'subscription_started',
      properties: {
        plan_tier: authoritativeTier,
        status: nextStatus,
        razorpay_subscription_id,
      },
    });

    return NextResponse.json({
      success: true,
      status: nextStatus,
      plan_tier: authoritativeTier,
    });
  } catch (err) {
    console.error('Verify subscription error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
