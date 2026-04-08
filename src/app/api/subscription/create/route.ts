import { NextResponse } from 'next/server';
import { razorpay, PLAN_ID, TRIAL_DAYS } from '@/lib/razorpay';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/subscription/create
 * Creates a Razorpay subscription with a 3-day free trial.
 * The trial is implemented via `start_at` — the first charge happens
 * 3 days after authorization.
 */
export async function POST() {
  try {
    if (!PLAN_ID) {
      return NextResponse.json({ error: 'Payment system not configured' }, { status: 503 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Create Razorpay subscription with trial via start_at
    const subscription = await razorpay.subscriptions.create({
      plan_id: PLAN_ID,
      total_count: 120, // Max 10 years of monthly billing
      quantity: 1,
      customer_notify: 1,
      start_at: trialEnd, // First charge happens after trial
      notes: {
        user_id: user.id,
        user_email: user.email || '',
      },
    });

    // Store subscription in Supabase
    const trialEndsAt = new Date(trialEnd * 1000).toISOString();
    await supabase.from('subscriptions').upsert({
      user_id: user.id,
      razorpay_subscription_id: subscription.id,
      plan_id: PLAN_ID,
      status: 'trialing',
      trial_ends_at: trialEndsAt,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    return NextResponse.json({
      subscription_id: subscription.id,
      key_id: process.env.RAZORPAY_KEY_ID,
      trial_ends_at: trialEndsAt,
    });
  } catch (err) {
    console.error('Create subscription error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
