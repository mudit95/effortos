import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * POST /api/push/subscribe
 *
 * Body: { subscription: PushSubscriptionJSON, userAgent?: string }
 *
 * Persists a Web Push subscription for the calling user. Idempotent:
 * if the same endpoint already exists, we update last_used_at and
 * return ok. New endpoints are inserted.
 *
 * The browser passes the subscription JSON it gets from
 * `pushManager.subscribe(...)` — we only need endpoint + keys.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const blocked = await rateLimitOrNull(user.id, 'light');
  if (blocked) return blocked;

  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; userAgent?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'subscription.endpoint and keys are required' }, { status: 400 });
  }

  const service = createServiceClient();
  // Upsert by endpoint (UNIQUE in mig 042). On conflict, bump
  // last_used_at and refresh keys (the browser may rotate them).
  const { error } = await service
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 200) : null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    console.error('[push/subscribe] upsert failed:', error);
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/push/subscribe
 *
 * Body: { endpoint: string }
 *
 * Removes a single subscription (e.g., after browser-side unsubscribe).
 */
export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { endpoint?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  }

  const service = createServiceClient();
  await service
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', body.endpoint);

  return NextResponse.json({ ok: true });
}
