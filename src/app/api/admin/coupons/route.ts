import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { createServiceClient } from '@/lib/supabase/service';
import { logAdminAction } from '@/lib/adminAudit';

export async function POST(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const body = await req.json();
  const { code, kind, discount_value, description, max_redemptions, expires_at, razorpay_offer_id } = body;

  if (!code || !kind || !discount_value) {
    return NextResponse.json({ error: 'code, kind, discount_value required' }, { status: 400 });
  }
  if (!['percent_off', 'trial_extension', 'free_months'].includes(kind)) {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  }

  const normalizedCode = String(code).toUpperCase().trim();
  const { error } = await check.supabase
    .from('coupons')
    .insert({
      code: normalizedCode,
      kind,
      discount_value: Number(discount_value),
      description: description || null,
      max_redemptions: max_redemptions ? Number(max_redemptions) : null,
      expires_at: expires_at ? new Date(expires_at).toISOString() : null,
      razorpay_offer_id: kind === 'percent_off' ? (razorpay_offer_id || null) : null,
      active: true,
      created_by: check.user.id,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit: COUPON_CREATED. Compliance requires every privileged mutation
  // to leave a trail (DPDP §10, SOC 2). Without this, "who created the
  // 100% off coupon?" has no answer beyond grepping CloudWatch.
  await logAdminAction({
    service: createServiceClient(),
    actorUserId: check.user.id,
    actionType: 'COUPON_CREATED',
    payload: {
      code: normalizedCode,
      kind,
      discount_value: Number(discount_value),
      max_redemptions: max_redemptions ?? null,
      expires_at: expires_at ?? null,
    },
    request: req,
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { id, active } = await req.json();
  if (!id || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'id and active required' }, { status: 400 });
  }
  const { error } = await check.supabase.from('coupons').update({ active }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit: COUPON_TOGGLED_ACTIVE. Disabling an active coupon is a
  // monetarily-relevant action; flag who flipped it and when.
  await logAdminAction({
    service: createServiceClient(),
    actorUserId: check.user.id,
    actionType: 'COUPON_TOGGLED_ACTIVE',
    payload: { coupon_id: id, active },
    request: req,
  });

  return NextResponse.json({ ok: true });
}
