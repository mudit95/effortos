import { NextResponse } from 'next/server';
import { getRazorpay } from '@/lib/razorpay';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * POST /api/subscription/resume
 *
 * Resumes a paused Razorpay subscription. Works only when status =
 * 'paused' — anything else returns 409 (active needs no resume,
 * cancelled needs a brand-new checkout, etc.).
 *
 * Razorpay's resume_at: 'now' option restarts the billing cycle from
 * the call moment. The next charge happens at the regular cadence
 * relative to resume time, NOT relative to the original cycle (i.e.,
 * a 30-day pause becomes a 30-day shift in the renewal date).
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }

    if (sub.status === 'active' || sub.status === 'trialing') {
      // Idempotent: already running, return success.
      return NextResponse.json({
        success: true,
        message: 'Subscription is already active.',
        already_active: true,
      });
    }

    if (sub.status !== 'paused') {
      return NextResponse.json(
        { error: `Cannot resume a ${sub.status} subscription. Subscribe again to renew.` },
        { status: 409 },
      );
    }

    try {
      const rzp = getRazorpay();
      // resume_at: 'now' restarts the billing cycle from this moment;
      // the next charge happens at the regular cadence relative to
      // resume time (so a 30-day pause shifts the renewal date by 30
      // days). Razorpay handles cycle bookkeeping internally.
      await rzp.subscriptions.resume(sub.razorpay_subscription_id, { resume_at: 'now' });
    } catch (rzpErr) {
      console.error('[Subscription Resume] Razorpay error:', rzpErr);
      return NextResponse.json(
        { error: 'Razorpay rejected the resume. Try again in a minute.' },
        { status: 502 },
      );
    }

    const service = createServiceClient();
    const { error: updateErr } = await service
      .from('subscriptions')
      .update({
        status: 'active',
        paused_at: null,
      })
      .eq('id', sub.id)
      .eq('user_id', user.id);

    if (updateErr) {
      console.error('[Subscription Resume] DB update failed:', updateErr);
      return NextResponse.json(
        { error: 'Resumed at processor but couldn\'t update locally. Refresh in a minute.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Subscription resumed. Welcome back.',
    });
  } catch (err) {
    console.error('[Subscription Resume] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
