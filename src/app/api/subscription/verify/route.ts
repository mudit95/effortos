import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';

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

    const {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    } = await request.json();

    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 });
    }

    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Update subscription status — verified, trial is active
    await supabase
      .from('subscriptions')
      .update({
        status: 'trialing',
        razorpay_payment_id,
        verified_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('razorpay_subscription_id', razorpay_subscription_id);

    return NextResponse.json({ success: true, status: 'trialing' });
  } catch (err) {
    console.error('Verify subscription error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
