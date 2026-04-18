import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/coupons/redeem
 * Body: { code: string }
 *
 * Applies a coupon on behalf of the current user. Returns
 *   { applied: 'trial_extension', value: <days> }    — trial extended
 *   { applied: 'free_months',     value: <months> }  — premium granted
 *   { applied: 'percent_off',     percent, razorpay_offer_id, ... }
 *                                                     — discount returned,
 *                                                       caller applies at checkout
 *
 * All gating (active? expired? cap reached? already redeemed?) happens
 * inside the SECURITY DEFINER Postgres function `redeem_coupon_atomic`.
 * That function row-locks the coupon with FOR UPDATE, so concurrent
 * redemptions serialise and max_redemptions can no longer be overshot.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await req.json();
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });

  // ── Atomic reservation/redemption ─────────────────────────────────
  const { data: result, error: rpcErr } = await supabase.rpc('redeem_coupon_atomic', {
    p_user_id: user.id,
    p_code: String(code),
  });

  if (rpcErr) {
    console.error('[coupons/redeem] RPC failed:', rpcErr);
    return NextResponse.json({ error: 'Failed to redeem code' }, { status: 500 });
  }

  type RedeemResult =
    | { ok: false; code: 'not_found' | 'expired' | 'max_reached' | 'already_redeemed'; message: string }
    | { ok: true; kind: 'percent_off'; percent: number; coupon_id: string; code: string; razorpay_offer_id: string | null }
    | { ok: true; kind: 'trial_extension' | 'free_months'; value: number; coupon_id: string; code: string };

  const r = result as RedeemResult | null;
  if (!r) {
    return NextResponse.json({ error: 'Unexpected empty result' }, { status: 500 });
  }

  if (!r.ok) {
    const statusCode =
      r.code === 'not_found' ? 404 :
      r.code === 'expired' ? 400 :
      r.code === 'max_reached' ? 400 :
      r.code === 'already_redeemed' ? 400 : 400;
    return NextResponse.json({ error: r.message }, { status: statusCode });
  }

  // percent_off: nothing to apply yet; checkout layer uses offer_id.
  if (r.kind === 'percent_off') {
    return NextResponse.json({
      applied: 'percent_off',
      percent: Number(r.percent),
      coupon_id: r.coupon_id,
      code: r.code,
      razorpay_offer_id: r.razorpay_offer_id ?? null,
    });
  }

  // ── Apply the subscription-side effect for trial_extension / free_months ─
  //
  // The redemption counter and coupon_redemptions row are already committed
  // by the RPC. If this subscription update fails, the coupon is "spent"
  // without the user getting their perk — which is a soft concern for
  // admin-created coupons but shouldn't happen in practice (same DB, same
  // connection). We log loudly so ops can spot the rare drift and refund
  // by hand. Wrapping both into a single transaction would require moving
  // the subscription update into the RPC too — a worthwhile future step.
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (r.kind === 'trial_extension') {
    const days = Number(r.value);
    const now = Date.now();
    const baseMs = existing?.trial_ends_at
      ? Math.max(new Date(existing.trial_ends_at).getTime(), now)
      : now;
    const newTrialEnd = new Date(baseMs + days * 86400000).toISOString();

    const { error: subErr } = existing
      ? await supabase.from('subscriptions')
          .update({ status: 'trialing', trial_ends_at: newTrialEnd })
          .eq('user_id', user.id)
      : await supabase.from('subscriptions')
          .insert({ user_id: user.id, status: 'trialing', trial_ends_at: newTrialEnd });

    if (subErr) {
      console.error('[coupons/redeem] trial_extension subscription write failed AFTER coupon was burned:', {
        user_id: user.id,
        coupon_id: r.coupon_id,
        code: r.code,
        error: subErr.message,
      });
      return NextResponse.json({ error: 'Failed to apply trial extension' }, { status: 500 });
    }
  } else if (r.kind === 'free_months') {
    const months = Number(r.value);
    const now = new Date();
    const baseMs = existing?.current_period_end
      ? Math.max(new Date(existing.current_period_end).getTime(), now.getTime())
      : now.getTime();
    const end = new Date(baseMs);
    end.setMonth(end.getMonth() + months);
    const newPeriodEnd = end.toISOString();

    const { error: subErr } = existing
      ? await supabase.from('subscriptions')
          .update({ status: 'active', current_period_end: newPeriodEnd, cancelled_at: null })
          .eq('user_id', user.id)
      : await supabase.from('subscriptions')
          .insert({ user_id: user.id, status: 'active', current_period_end: newPeriodEnd });

    if (subErr) {
      console.error('[coupons/redeem] free_months subscription write failed AFTER coupon was burned:', {
        user_id: user.id,
        coupon_id: r.coupon_id,
        code: r.code,
        error: subErr.message,
      });
      return NextResponse.json({ error: 'Failed to apply free months' }, { status: 500 });
    }
  }

  return NextResponse.json({
    applied: r.kind,
    value: Number(r.value),
  });
}
