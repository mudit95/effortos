import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';

// Upsert
export async function PUT(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { key, value, description } = await req.json();
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  const { error } = await check.supabase
    .from('site_content')
    .upsert({ key, value: value ?? '', description: description ?? null, updated_by: check.user.id, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { key } = await req.json();
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  const { error } = await check.supabase.from('site_content').delete().eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Public GET — anyone can read site content (used by frontend to hydrate text)
export async function GET() {
  // Use a server client with anon key (public reads are allowed by RLS)
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const { data } = await supabase.from('site_content').select('key, value').limit(500);
  const map: Record<string, string> = {};
  (data ?? []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
  return NextResponse.json(map);
}
