import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/consent
 *
 * Persists a consent decision into consent_log. Called by the cookie
 * banner client component when the user clicks Accept/Decline/Customize.
 *
 * Body: { analytics?: boolean, error_tracking?: boolean, marketing?: boolean,
 *         anonymous_id?: string, banner_version?: string }
 *
 * Authentication: optional. Pre-signup visitors send only anonymous_id;
 * authenticated users get user_id attached automatically. We never reject
 * for missing auth — a visitor's consent is itself useful evidence even
 * before they sign up.
 *
 * Idempotency: not enforced. Each call inserts a new row. The most-recent
 * row per (user_id OR anonymous_id) is the user's current state — a
 * downstream view aggregates if needed.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const analytics = !!body.analytics;
  const error_tracking = !!body.error_tracking;
  const marketing = !!body.marketing;
  const banner_version = typeof body.banner_version === 'string' ? body.banner_version.slice(0, 24) : 'v1';
  const anonymous_id = typeof body.anonymous_id === 'string' ? body.anonymous_id.slice(0, 64) : null;

  // Best-effort auth lookup — present for signed-in users, absent for visitors.
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // ignore — anonymous flow is fine
  }

  if (!userId && !anonymous_id) {
    return NextResponse.json({ error: 'anonymous_id required for unauthenticated consent' }, { status: 400 });
  }

  const xff = request.headers.get('x-forwarded-for');
  const request_ip = xff ? xff.split(',')[0].trim().slice(0, 64) : null;
  const user_agent = request.headers.get('user-agent')?.slice(0, 256) ?? null;

  const service = createServiceClient();
  const { error } = await service.from('consent_log').insert({
    user_id: userId,
    anonymous_id,
    analytics,
    error_tracking,
    marketing,
    banner_version,
    request_ip,
    user_agent,
  });

  if (error) {
    console.error('[consent] insert failed:', error);
    return NextResponse.json({ error: 'Failed to record consent' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
