import { NextResponse } from 'next/server';
import { getRazorpay } from '@/lib/razorpay';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * POST /api/subscription/pause
 *
 * Pauses the user's Razorpay subscription. Future charges suspended
 * immediately; premium access stops on pause (paused == not-premium
 * in PremiumGate / requireActiveSub). Manual resume via
 * /api/subscription/resume.
 *
 * Why a separate endpoint instead of folding into /cancel: the cancel
 * flow lives in the cancellation modal where the user is already
 * leaning toward leaving. Pause is the save tactic — different
 * intent, different telemetry, different copy. Keeping it separate
 * also lets the SettingsModal render two distinct CTAs cleanly.
 *
 * Rules:
 *   - Only 'active' or 'trialing' users can pause. Past-due users
 *     have to fix payment first; cancelled / expired / paused users
 *     have nothing to pause.
 *   - Idempotent at the Razorpay layer: if Razorpay already has this
 *     subscription paused, we still mirror the DB state.
 *   - Audit-logged via webhook_events when the subscription.paused
 *     webhook lands (belt-and-braces — DB is updated synchronously
 *     here regardless).
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: pause/resume hit Razorpay's API. Light bucket caps
    // accidental double-clicks plus any spam attack from a logged-in
    // session.
    const blocked = await rateLimitOrNull(user.id, 'light');
    if (blocked) return blocked;

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub?.razorpay_subscription_id) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    if (sub.status === 'paused') {
      // Idempotent: already paused, return success without re-calling
      // Razorpay (which would 4xx).
      return NextResponse.json({
        success: true,
        message: 'Subscription is already paused.',
        paused_at: sub.paused_at,
        already_paused: true,
      });
    }

    if (sub.status !== 'active' && sub.status !== 'trialing') {
      // past_due, cancelled, expired, none — pause doesn't make sense.
      // Most common case here is past_due; tell the user to fix payment.
      const reason =
        sub.status === 'past_due'
          ? 'Please update your payment method first; we can\'t pause a subscription with a failed charge.'
          : `Cannot pause a ${sub.status} subscription.`;
      return NextResponse.json({ error: reason }, { status: 409 });
    }

    // Tell Razorpay to pause now. The pause_at: 'now' option suspends
    // the next billing cycle immediately; subsequent cycles are
    // skipped until resume is called.
    try {
      const rzp = getRazorpay();
      // The Razorpay SDK exposes pause/resume on subscriptions; the
      // shipped .d.ts in razorpay@2.9 does include them, so no cast
      // is required. pause_at: 'now' suspends the next billing cycle
      // immediately.
      await rzp.subscriptions.pause(sub.razorpay_subscription_id, { pause_at: 'now' });
    } catch (rzpErr) {
      console.error('[Subscription Pause] Razorpay error:', rzpErr);
      return NextResponse.json(
        { error: 'Razorpay rejected the pause. Try again, or cancel instead.' },
        { status: 502 },
      );
    }

    // Mirror in DB. Service role because RLS denies authenticated
    // mutations on subscriptions (post-mig 022).
    const service = createServiceClient();
    const { error: updateErr } = await service
      .from('subscriptions')
      .update({
        status: 'paused',
        paused_at: new Date().toISOString(),
      })
      .eq('id', sub.id)
      .eq('user_id', user.id);

    if (updateErr) {
      // We've already paused at Razorpay; don't roll back, just log
      // and report. The webhook subscription.paused event will retry
      // the DB update.
      console.error('[Subscription Pause] DB update failed:', updateErr);
      return NextResponse.json(
        { error: 'Paused at processor but couldn\'t update locally. Refresh in a minute.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Subscription paused. Resume any time from Settings.',
      paused_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Subscription Pause] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
