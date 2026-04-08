import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient as createAdminClient } from '@supabase/supabase-js';

/**
 * POST /api/webhooks/razorpay
 * Handles Razorpay webhook events for subscription lifecycle.
 *
 * Events handled:
 * - subscription.authenticated → trial started
 * - subscription.charged → payment successful, extend period
 * - subscription.completed → subscription ended naturally
 * - subscription.cancelled → user or system cancelled
 * - subscription.halted → payment failures exhausted
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-razorpay-signature');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

    // Verify webhook signature
    if (webhookSecret && signature) {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

      if (expectedSignature !== signature) {
        console.error('Invalid Razorpay webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
      }
    }

    const event = JSON.parse(body);
    const eventType = event.event;
    const payload = event.payload?.subscription?.entity;

    if (!payload?.id) {
      return NextResponse.json({ received: true });
    }

    // Use admin client (no auth needed for webhooks)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase admin credentials not configured for webhooks');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const supabase = createAdminClient(supabaseUrl, supabaseServiceKey);
    const subscriptionId = payload.id;

    switch (eventType) {
      case 'subscription.authenticated': {
        // Authorization payment successful — trial begins
        await supabase
          .from('subscriptions')
          .update({ status: 'trialing' })
          .eq('razorpay_subscription_id', subscriptionId);
        break;
      }

      case 'subscription.charged': {
        // Recurring payment successful
        const currentPeriodEnd = payload.current_end
          ? new Date(payload.current_end * 1000).toISOString()
          : null;

        await supabase
          .from('subscriptions')
          .update({
            status: 'active',
            current_period_end: currentPeriodEnd,
          })
          .eq('razorpay_subscription_id', subscriptionId);
        break;
      }

      case 'subscription.completed': {
        await supabase
          .from('subscriptions')
          .update({ status: 'expired' })
          .eq('razorpay_subscription_id', subscriptionId);
        break;
      }

      case 'subscription.cancelled': {
        await supabase
          .from('subscriptions')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
          })
          .eq('razorpay_subscription_id', subscriptionId);
        break;
      }

      case 'subscription.halted': {
        // Payment failures exhausted — subscription halted
        await supabase
          .from('subscriptions')
          .update({ status: 'expired' })
          .eq('razorpay_subscription_id', subscriptionId);
        break;
      }

      default:
        console.log(`Unhandled Razorpay event: ${eventType}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Razorpay webhook error:', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
