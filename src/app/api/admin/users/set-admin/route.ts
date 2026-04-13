import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';

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

  const { error } = await check.supabase
    .from('profiles')
    .update({ is_admin: isAdmin })
    .eq('id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
