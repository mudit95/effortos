import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { userId, months } = await req.json();
  if (!userId || !months || Number.isNaN(Number(months))) {
    return NextResponse.json({ error: 'userId and months required' }, { status: 400 });
  }
  const { supabase } = check;

  // compute new period end: extend from max(now, existing period_end)
  const { data: existing } = await supabase
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
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: 'active', current_period_end: newPeriodEnd, cancelled_at: null })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('subscriptions')
      .insert({ user_id: userId, status: 'active', current_period_end: newPeriodEnd });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, current_period_end: newPeriodEnd });
}
