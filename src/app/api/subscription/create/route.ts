import { NextResponse } from 'next/server';
import { getRazorpay, PLAN_ID, TRIAL_DAYS } from '@/lib/razorpay';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/subscription/create
 * Creates a Razorpay subscription with a 3-day free trial.
 * The trial is implemented via `start_at` — the first charge happens
 * 3 days after authorization.
 *
 * Optional body: { couponCode, couponId, offerId }
 *   - If couponId is provided, re-validate server-side and forward the
 *     Razorpay offer_id attached to that coupon so the discount applies.
 */
export async function POST(req: Request) {
  try {
    if (!PLAN_ID) {
      return NextResponse.json({ error: 'Payment system not configured' }, { status: 503 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse optional body (may be empty for non-coupon flow)
    const body = await req.json().catch(() => ({}));
    const couponCode: string | null = body?.couponCode ?? null;
    const couponId: string | null = body?.couponId ?? null;
    let offerId: string | null = body?.offerId ?? null;

    // Re-validate the coupon server-side if provided (never trust client)
    if (couponId) {
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('id', couponId)
        .eq('active', true)
        .single();

      if (!coupon || coupon.kind !== 'percent_off') {
        return NextResponse.json({ error: 'Invalid coupon' }, { status: 400 });
      }
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        return NextResponse.json({ error: 'Coupon expired' }, { status: 400 });
      }
      if (coupon.max_redemptions !== null && coupon.redemption_count >= coupon.max_redemptions) {
        return NextResponse.json({ error: 'Coupon fully redeemed' }, { status: 400 });
      }
      const { data: prior } = await supabase
        .from('coupon_redemptions')
        .select('id')
        .eq('coupon_id', coupon.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (prior) {
        return NextResponse.json({ error: 'Coupon already redeemed' }, { status: 400 });
      }

      // Always trust the server-stored offer_id, not the client value
      offerId = coupon.razorpay_offer_id ?? null;
      if (!offerId) {
        return NextResponse.json({ error: 'Coupon not wired to a Razorpay offer' }, { status: 400 });
      }
    }

    // Check if user already has an active subscription
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['trialing', 'active'])
      .single();

    if (existing) {
      return NextResponse.json({
        error: 'Already subscribed',
        subscription: existing,
      }, { status: 409 });
    }

    // Calculate trial end (3 days from now)
    const trialEnd = Math.floor(Date.now() / 1000) + (TRIAL_DAYS * 24 * 60 * 60);

    // Build subscription params — add offer_id only if present
    const subParams: Record<string, unknown> = {
      plan_id: PLAN_ID,
      total_count: 120, // Max 10 years of monthly billing
      quantity: 1,
      customer_notify: 1,
      start_at: trialEnd, // First charge happens after trial
      notes: {
        user_id: user.id,
        user_email: user.email || '',
        ...(couponCode ? { coupon_code: couponCode } : {}),
      },
    };
    if (offerId) subParams.offer_id = offerId;

    // Create Razorpay subscription
    const subscription = await getRazorpay().subscriptions.create(subParams as unknown as Parameters<ReturnType<typeof getRazorpay>['subscriptions']['create']>[0]);

    // Store subscription in Supabase (remember which coupon was applied,
    // but don't record redemption yet — that happens on verify)
    const trialEndsAt = new Date(trialEnd * 1000).toISOString();
    await supabase.from('subscriptions').upsert({
      user_id: user.id,
      razorpay_subscription_id: subscription.id,
      plan_id: PLAN_ID,
      status: 'trialing',
      trial_ends_at: trialEndsAt,
      created_at: new Date().toISOString(),
      ...(couponId ? { applied_coupon_id: couponId, applied_coupon_code: couponCode } : {}),
    }, { onConflict: 'user_id' });

    return NextResponse.json({
      subscription_id: subscription.id,
      key_id: process.env.RAZORPAY_KEY_ID,
      trial_ends_at: trialEndsAt,
      offer_id: offerId,
    });
  } catch (err) {
    console.error('Create subscription error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
