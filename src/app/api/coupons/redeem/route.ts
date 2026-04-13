import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/coupons/redeem
 * Body: { code: string }
 *
 * Applies a coupon on behalf of the current user. Returns
 *   { applied: 'trial_extension', days } — trial extended
 *   { applied: 'free_months', months } — premium granted
 *   { applied: 'percent_off', percent } — discount returned, caller applies at checkout
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });

  const normalizedCode = String(code).toUpperCase().trim();

  const { data: coupon, error: cErr } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', normalizedCode)
    .eq('active', true)
    .single();

  if (cErr || !coupon) {
    return NextResponse.json({ error: 'Invalid or inactive code' }, { status: 404 });
  }

  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This code has expired' }, { status: 400 });
  }

  if (coupon.max_redemptions !== null && coupon.redemption_count >= coupon.max_redemptions) {
    return NextResponse.json({ error: 'Code has reached its redemption limit' }, { status: 400 });
  }

  // Already redeemed by this user?
  const { data: prior } = await supabase
    .from('coupon_redemptions')
    .select('id')
    .eq('coupon_id', coupon.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (prior) {
    return NextResponse.json({ error: 'You have already redeemed this code' }, { status: 400 });
  }

  // For percent_off, we don't finalize — caller applies at checkout. We don't record redemption yet.
  if (coupon.kind === 'percent_off') {
    return NextResponse.json({
      applied: 'percent_off',
      percent: Number(coupon.discount_value),
      coupon_id: coupon.id,
      code: coupon.code,
    });
  }

  // For trial_extension and free_months, we apply immediately.
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (coupon.kind === 'trial_extension') {
    const days = Number(coupon.discount_value);
    const now = Date.now();
    const baseMs = existing?.trial_ends_at ? Math.max(new Date(existing.trial_ends_at).getTime(), now) : now;
    const newTrialEnd = new Date(baseMs + days * 86400000).toISOString();

    if (existing) {
      await supabase.from('subscriptions').update({ status: 'trialing', trial_ends_at: newTrialEnd }).eq('user_id', user.id);
    } else {
      await supabase.from('subscriptions').insert({ user_id: user.id, status: 'trialing', trial_ends_at: newTrialEnd });
    }
  } else if (coupon.kind === 'free_months') {
    const months = Number(coupon.discount_value);
    const now = new Date();
    const baseMs = existing?.current_period_end
      ? Math.max(new Date(existing.current_period_end).getTime(), now.getTime())
      : now.getTime();
    const end = new Date(baseMs);
    end.setMonth(end.getMonth() + months);
    const newPeriodEnd = end.toISOString();

    if (existing) {
      await supabase.from('subscriptions').update({ status: 'active', current_period_end: newPeriodEnd, cancelled_at: null }).eq('user_id', user.id);
    } else {
      await supabase.from('subscriptions').insert({ user_id: user.id, status: 'active', current_period_end: newPeriodEnd });
    }
  }

  // Record redemption + increment counter
  await supabase.from('coupon_redemptions').insert({ coupon_id: coupon.id, user_id: user.id });
  await supabase.from('coupons').update({ redemption_count: coupon.redemption_count + 1 }).eq('id', coupon.id);

  return NextResponse.json({
    applied: coupon.kind,
    value: Number(coupon.discount_value),
  });
}
