import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { SubscriptionStatus } from '@/types';

/**
 * GET /api/subscription/status
 * Returns the current user's subscription status.
 * Handles trial expiry check on read.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub) {
      // No subscription record — check if user is within the implicit
      // 3-day trial from signup (for users who signed up before payments were added)
      const createdAt = new Date(user.created_at);
      const trialEnd = new Date(createdAt.getTime() + 3 * 24 * 60 * 60 * 1000);
      const now = new Date();

      if (now < trialEnd) {
        return NextResponse.json({
          status: 'trialing' as SubscriptionStatus,
          trial_ends_at: trialEnd.toISOString(),
          implicit: true, // no payment method on file yet
        });
      }

      return NextResponse.json({
        status: 'expired' as SubscriptionStatus,
        trial_ends_at: trialEnd.toISOString(),
      });
    }

    const now = new Date();

    // PRIORITY 1: Premium (active with period end in the future) takes precedence
    // over everything else. If admin granted premium OR Razorpay charged the card,
    // the user is premium — even if they also have a future trial_ends_at.
    if (sub.current_period_end && new Date(sub.current_period_end) > now) {
      // Normalise status to 'active' on read if the DB hasn't caught up
      // (e.g. admin extended trial after granting premium and left status='trialing')
      if (sub.status !== 'active' && sub.status !== 'past_due' && sub.status !== 'cancelled') {
        await supabase
          .from('subscriptions')
          .update({ status: 'active' })
          .eq('id', sub.id);
        return NextResponse.json({ ...sub, status: 'active' });
      }
      return NextResponse.json(sub);
    }

    // PRIORITY 2: Trialing with a future trial_ends_at → still in trial
    if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) > now) {
      return NextResponse.json(sub);
    }

    // PRIORITY 3: Trial has expired — resolve the final state
    if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) <= now) {
      // No future period end reached the first check, so no payment.
      // Mark as expired.
      await supabase
        .from('subscriptions')
        .update({ status: 'expired' })
        .eq('id', sub.id);
      return NextResponse.json({ ...sub, status: 'expired' });
    }

    // Everything else (cancelled, expired, past_due without future period) → return as-is
    return NextResponse.json(sub);
  } catch (err) {
    console.error('Subscription status error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
