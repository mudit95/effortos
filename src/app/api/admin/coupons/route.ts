import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';

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

  const { error } = await check.supabase
    .from('coupons')
    .insert({
      code: String(code).toUpperCase().trim(),
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
  return NextResponse.json({ ok: true });
}
