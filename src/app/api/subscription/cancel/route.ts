import { NextResponse } from 'next/server';
import { getRazorpay } from '@/lib/razorpay';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * POST /api/subscription/cancel
 * Cancels the user's subscription at end of current billing cycle.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate-limit: cancellation hits Razorpay's API. The light bucket caps
    // accidental double-clicks and stops a logged-in attacker from spamming
    // Razorpay on a victim's behalf.
    const blocked = await rateLimitOrNull(user.id, 'light');
    if (blocked) return blocked;

    // `maybeSingle` with order+limit — `.single()` would 500 if the
    // user ends up with zero or multiple active rows. Take the newest.
    // Read can use the auth-bound client (SELECT policy permits own rows).
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['trialing', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sub?.razorpay_subscription_id) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    // Cancel at end of cycle so user keeps access until period ends
    await getRazorpay().subscriptions.cancel(sub.razorpay_subscription_id, true);

    // Writes to `subscriptions` go through the service-role client
    // (post-migration 022, RLS denies authenticated UPDATEs).
    const service = createServiceClient();
    await service
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', sub.id)
      .eq('user_id', user.id);

    return NextResponse.json({
      success: true,
      message: 'Subscription cancelled. You have access until the end of your current period.',
      current_period_end: sub.current_period_end || sub.trial_ends_at,
    });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
