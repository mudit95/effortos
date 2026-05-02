import { NextResponse } from 'next/server';
import { getRazorpay, TRIAL_DAYS, getPlanIdForTier, type BillingCycle } from '@/lib/razorpay';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rateLimitOrNull } from '@/lib/ratelimit';
import type { PlanTier, BillingCadence } from '@/types';

/**
 * POST /api/subscription/create
 * Creates a Razorpay subscription with a 3-day free trial.
 * The trial is implemented via `start_at` — the first charge happens
 * 3 days after authorization.
 *
 * Body: { tier?: 'starter' | 'pro', cadence?: 'monthly' | 'annual',
 *         couponCode?, couponId?, offerId? }
 *   - tier: which plan tier to subscribe to (default: 'starter')
 *   - cadence: billing frequency (default: 'monthly'). Annual unlocks the
 *     ~33% discount priced at ₹3,999 (Starter) / ₹7,999 (Pro). Cadence
 *     is persisted in subscriptions.billing_cadence (migration 031) and
 *     fixed for the lifetime of the subscription — switching requires
 *     cancel + re-subscribe so we don't have to mid-cycle prorate.
 *   - If couponId is provided, re-validate server-side and forward the
 *     Razorpay offer_id attached to that coupon so the discount applies.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate-limit: each call hits Razorpay's subscriptions.create — costly
    // and rate-limited upstream. The light bucket (20/hour) lets a confused
    // user retry after a card-decline without locking them out, while
    // capping a runaway client that triggers retries in a tight loop.
    const blocked = await rateLimitOrNull(user.id, 'light');
    if (blocked) return blocked;

    // Parse body
    const body = await req.json().catch(() => ({}));
    const tier: PlanTier = (body?.tier === 'pro') ? 'pro' : 'starter';
    // Whitelist cadence — anything other than 'annual' falls back to monthly.
    // Never trust client values verbatim: a typo or an old build sending
    // {cadence: 'yearly'} would otherwise silently route to a wrong plan.
    const cadence: BillingCadence = (body?.cadence === 'annual') ? 'annual' : 'monthly';
    const couponCode: string | null = body?.couponCode ?? null;
    const couponId: string | null = body?.couponId ?? null;
    let offerId: string | null = body?.offerId ?? null;

    // Resolve the correct Razorpay plan ID for tier × cadence
    const planId = getPlanIdForTier(tier, cadence as BillingCycle);
    if (!planId) {
      return NextResponse.json(
        { error: `Payment plan not configured for ${tier} ${cadence}` },
        { status: 503 },
      );
    }

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

    // Check if user already has an active subscription. .maybeSingle() — a
    // missing row is the common case (no subscription yet) and shouldn't throw.
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['trialing', 'active'])
      .maybeSingle();

    // Existing-subscription rules. We allow two kinds of "swap":
    //   (1) Tier upgrade   — starter → pro, any cadence. Existing flow.
    //   (2) Cadence upgrade — monthly → annual, same or higher tier.
    //                         Lets a happy monthly customer lock in the
    //                         annual discount without contacting support.
    // Anything else (downgrade, same-cadence/same-tier duplicate) is
    // rejected with 409 — switching the other direction needs a
    // proration story we don't have yet, and "already subscribed"
    // is the safe default that surfaces the error to the user.
    const existingCadence: BillingCadence =
      existing?.billing_cadence === 'annual' ? 'annual' : 'monthly';
    const isTierUpgrade = existing?.plan_tier === 'starter' && tier === 'pro';
    const isCadenceUpgrade = existingCadence === 'monthly' && cadence === 'annual';
    const isUpgrade = Boolean(existing) && (isTierUpgrade || isCadenceUpgrade);

    if (existing) {
      if (isUpgrade) {
        // Cancel the old subscription at Razorpay if it exists. We use the
        // immediate-cancel form (no `cancel_at_cycle_end`) because we're
        // about to create its successor — leaving the old one billable
        // until period-end would double-charge the user during overlap.
        if (existing.razorpay_subscription_id) {
          try {
            await getRazorpay().subscriptions.cancel(existing.razorpay_subscription_id);
          } catch (e) {
            console.warn('[Subscription] Failed to cancel old sub before upgrade:', e);
          }
        }
        // Continue to create new (upgraded) subscription below
      } else {
        return NextResponse.json({
          error: 'Already subscribed',
          subscription: existing,
        }, { status: 409 });
      }
    }

    // Calculate trial end (3 days from now) — skip trial if upgrading.
    // Tier OR cadence upgrades both skip: the user already trialed once.
    const trialEnd = isUpgrade
      ? Math.floor(Date.now() / 1000) + 60 // charge almost immediately for upgrades
      : Math.floor(Date.now() / 1000) + (TRIAL_DAYS * 24 * 60 * 60);

    // Build subscription params.
    //
    // total_count caps the number of billing cycles the subscription can
    // run for. We pick a value that gives roughly 10+ years of runway
    // (well past the practical lifetime of any subscription) without
    // colliding with Razorpay's per-period maxima:
    //   monthly: 156 max → 120 = 10 yrs
    //   annual:   99 max →  12 = 12 yrs
    // If a customer ever reaches the cap, Razorpay sends
    // `subscription.completed` and the cron-driven re-engagement path
    // surfaces the renewal — far preferable to silently cutting off.
    const totalCount = cadence === 'annual' ? 12 : 120;
    const subParams: Record<string, unknown> = {
      plan_id: planId,
      total_count: totalCount,
      quantity: 1,
      customer_notify: 1,
      start_at: trialEnd,
      notes: {
        user_id: user.id,
        user_email: user.email || '',
        plan_tier: tier,
        billing_cadence: cadence,
        ...(couponCode ? { coupon_code: couponCode } : {}),
      },
    };
    if (offerId) subParams.offer_id = offerId;

    // Create Razorpay subscription
    const subscription = await getRazorpay().subscriptions.create(subParams as unknown as Parameters<ReturnType<typeof getRazorpay>['subscriptions']['create']>[0]);

    // Store subscription in Supabase. Race-safety: between the existence
    // check above and this upsert, a concurrent request from the same user
    // (e.g. a double-click) could have created its own Razorpay subscription
    // and won the upsert. After upserting we read back the row; if the
    // razorpay_subscription_id doesn't match the one we just created, the
    // other request won — cancel ours at Razorpay and return its row.
    //
    // Writes to `subscriptions` go through the service-role client
    // (post-migration 022, RLS denies authenticated INSERT/UPDATE).
    const service = createServiceClient();
    const trialEndsAt = new Date(trialEnd * 1000).toISOString();
    await service.from('subscriptions').upsert({
      user_id: user.id,
      razorpay_subscription_id: subscription.id,
      plan_id: planId,
      plan_tier: tier,
      billing_cadence: cadence,
      status: isUpgrade ? 'active' : 'trialing',
      trial_ends_at: isUpgrade ? existing?.trial_ends_at : trialEndsAt,
      created_at: new Date().toISOString(),
      ...(couponId ? { applied_coupon_id: couponId, applied_coupon_code: couponCode } : {}),
    }, { onConflict: 'user_id' });

    const { data: settled } = await service
      .from('subscriptions')
      .select('razorpay_subscription_id, plan_tier, billing_cadence, status, trial_ends_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settled && settled.razorpay_subscription_id !== subscription.id) {
      // Lost the race. Cancel the orphaned Razorpay subscription so we
      // don't leave duplicates on the Razorpay side.
      try {
        await getRazorpay().subscriptions.cancel(subscription.id);
      } catch (e) {
        console.warn('[Subscription] Failed to cancel orphan after race:', e);
      }
      return NextResponse.json({
        subscription_id: settled.razorpay_subscription_id,
        key_id: process.env.RAZORPAY_KEY_ID,
        trial_ends_at: settled.trial_ends_at,
        offer_id: null,
        plan_tier: settled.plan_tier,
        billing_cadence: settled.billing_cadence ?? cadence,
        deduplicated: true,
      });
    }

    return NextResponse.json({
      subscription_id: subscription.id,
      key_id: process.env.RAZORPAY_KEY_ID,
      trial_ends_at: trialEndsAt,
      offer_id: offerId,
      plan_tier: tier,
      billing_cadence: cadence,
    });
  } catch (err) {
    console.error('Create subscription error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
