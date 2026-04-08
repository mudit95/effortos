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
      .single();

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

    // Check if trial has expired but status wasn't updated by webhook
    if (sub.status === 'trialing' && sub.trial_ends_at) {
      const trialEnd = new Date(sub.trial_ends_at);
      if (new Date() > trialEnd) {
        // Trial ended — check if Razorpay has charged (webhook should handle this,
        // but this is a fallback). If no payment was made, mark as expired.
        if (!sub.razorpay_payment_id) {
          await supabase
            .from('subscriptions')
            .update({ status: 'expired' })
            .eq('id', sub.id);
          return NextResponse.json({ ...sub, status: 'expired' });
        }
        // Payment exists — trial converted to active
        await supabase
          .from('subscriptions')
          .update({ status: 'active' })
          .eq('id', sub.id);
        return NextResponse.json({ ...sub, status: 'active' });
      }
    }

    return NextResponse.json(sub);
  } catch (err) {
    console.error('Subscription status error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
