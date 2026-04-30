import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { createServiceClient } from '@/lib/supabase/service';
import { logAdminAction } from '@/lib/adminAudit';

export async function POST(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { userId, months, tier } = await req.json();
  if (!userId || !months || Number.isNaN(Number(months))) {
    return NextResponse.json({ error: 'userId and months required' }, { status: 400 });
  }
  const planTier = tier === 'pro' ? 'pro' : 'starter';
  const actorId = check.user.id;

  // Writes to `subscriptions` MUST go through the service-role client
  // (post-migration 022, the auth-bound client has no INSERT/UPDATE policy).
  const service = createServiceClient();

  // compute new period end: extend from max(now, existing period_end)
  const { data: existing } = await service
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = new Date();
  const baseMs = existing?.current_period_end
    ? Math.max(new Date(existing.current_period_end).getTime(), now.getTime())
    : now.getTime();
  const end = new Date(baseMs);
  end.setMonth(end.getMonth() + Number(months));
  const newPeriodEnd = end.toISOString();

  if (existing) {
    const { error } = await service
      .from('subscriptions')
      .update({ status: 'active', current_period_end: newPeriodEnd, cancelled_at: null, plan_tier: planTier })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await service
      .from('subscriptions')
      .insert({ user_id: userId, status: 'active', current_period_end: newPeriodEnd, plan_tier: planTier });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction({
    service,
    actorUserId: actorId,
    actionType: 'USER_PREMIUM_GRANTED',
    targetUserId: userId,
    payload: { months: Number(months), plan_tier: planTier, new_period_end: newPeriodEnd },
    request: req,
  });

  return NextResponse.json({ ok: true, current_period_end: newPeriodEnd });
}
