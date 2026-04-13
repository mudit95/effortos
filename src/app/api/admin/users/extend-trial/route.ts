import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';

export async function POST(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { userId, days } = await req.json();
  if (!userId || !days || Number.isNaN(Number(days))) {
    return NextResponse.json({ error: 'userId and days required' }, { status: 400 });
  }
  const addMs = Number(days) * 24 * 60 * 60 * 1000;
  const { supabase } = check;

  // Get existing sub
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  const now = Date.now();
  const baseMs = existing?.trial_ends_at ? Math.max(new Date(existing.trial_ends_at).getTime(), now) : now;
  const newTrialEnd = new Date(baseMs + addMs).toISOString();

  if (existing) {
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: 'trialing', trial_ends_at: newTrialEnd })
      .eq('user_id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('subscriptions')
      .insert({ user_id: userId, status: 'trialing', trial_ends_at: newTrialEnd });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, trial_ends_at: newTrialEnd });
}
