import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { createServiceClient } from '@/lib/supabase/service';
import { logAdminAction } from '@/lib/adminAudit';

export async function POST(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { userId, days } = await req.json();
  if (!userId || !days || Number.isNaN(Number(days))) {
    return NextResponse.json({ error: 'userId and days required' }, { status: 400 });
  }
  const addMs = Number(days) * 24 * 60 * 60 * 1000;
  const actorId = check.user.id;

  // Writes to `subscriptions` MUST go through the service-role client
  // (post-migration 022, the auth-bound client has no INSERT/UPDATE policy).
  const service = createServiceClient();

  // Get most-recent sub (user may have multiple rows from older test cycles)
  const { data: existing } = await service
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = Date.now();
  const baseMs = existing?.trial_ends_at ? Math.max(new Date(existing.trial_ends_at).getTime(), now) : now;
  const newTrialEnd = new Date(baseMs + addMs).toISOString();

  if (existing) {
    // Don't downgrade premium/paid users to 'trialing' — if they have a future
    // period end, they're premium. Just bump trial_ends_at in case it's ever needed.
    const hasFuturePeriodEnd =
      existing.current_period_end && new Date(existing.current_period_end).getTime() > now;
    const nextStatus =
      hasFuturePeriodEnd && (existing.status === 'active' || existing.status === 'past_due')
        ? existing.status
        : 'trialing';

    const { error } = await service
      .from('subscriptions')
      .update({ status: nextStatus, trial_ends_at: newTrialEnd })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await service
      .from('subscriptions')
      .insert({ user_id: userId, status: 'trialing', trial_ends_at: newTrialEnd });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Append-only audit log — see lib/adminAudit.ts. Best-effort insert
  // after the mutation succeeds; on failure we log loudly but do NOT
  // roll back the trial extension that already happened.
  await logAdminAction({
    service,
    actorUserId: actorId,
    actionType: 'USER_TRIAL_EXTENDED',
    targetUserId: userId,
    payload: { days: Number(days), new_trial_ends_at: newTrialEnd },
    request: req,
  });

  return NextResponse.json({ ok: true, trial_ends_at: newTrialEnd });
}
