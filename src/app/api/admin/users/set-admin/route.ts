import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { createServiceClient } from '@/lib/supabase/service';
import { logAdminAction } from '@/lib/adminAudit';

export async function POST(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { userId, isAdmin } = await req.json();
  if (!userId || typeof isAdmin !== 'boolean') {
    return NextResponse.json({ error: 'userId and isAdmin required' }, { status: 400 });
  }

  // Don't allow admins to de-admin themselves if they're the only admin
  if (!isAdmin && userId === check.user.id) {
    const { count } = await check.supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_admin', true);
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last admin.' }, { status: 400 });
    }
  }

  // The is_admin flip is privileged enough that going through service
  // role here is consistent with extend-trial / grant-premium. Auth-bound
  // updates may also work via the existing profiles policies, but using
  // service-role keeps the audit-with-elevated-write story uniform.
  const service = createServiceClient();
  const { error } = await service
    .from('profiles')
    .update({ is_admin: isAdmin })
    .eq('id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    service,
    actorUserId: check.user.id,
    actionType: 'USER_ADMIN_TOGGLED',
    targetUserId: userId,
    payload: { is_admin: isAdmin },
    request: req,
  });

  return NextResponse.json({ ok: true });
}
