import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { rateLimitByIpOrNull } from '@/lib/ratelimit';

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

/**
 * Public GET — anyone can read site content (used by frontend to hydrate text).
 *
 * This stays public by design (the landing page calls it pre-auth), but we
 * harden it three ways:
 *
 *   1. Per-IP rate limit so a single client can't scrape-amplify against us.
 *   2. CDN/edge cache headers — Vercel's CDN absorbs ~all traffic so legitimate
 *      page loads never reach the function.
 *   3. Projection limited to (key, value); never return updater identifiers,
 *      timestamps, or descriptions.
 */
export async function GET(req: Request) {
  const blocked = await rateLimitByIpOrNull(req, 'content');
  if (blocked) return blocked;

  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const { data } = await supabase.from('site_content').select('key, value').limit(500);
  const map: Record<string, string> = {};
  (data ?? []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });

  return NextResponse.json(map, {
    headers: {
      // Cache aggressively at the edge; site content changes rarely and admins
      // can purge by re-deploying or hitting PUT (which is uncacheable).
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      'Vary': 'Accept-Encoding',
    },
  });
}
