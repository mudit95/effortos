import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyHumanish } from '@/lib/turnstile';
import { rateLimitByIpOrNull } from '@/lib/ratelimit';
import { track } from '@/lib/analytics';

export const runtime = 'nodejs';

/**
 * POST /api/auth/signup
 *
 * Bot-protected signup. Wraps Supabase Auth so we can:
 *   1. Honeypot + Cloudflare Turnstile check before we touch Supabase.
 *      ProductHunt traffic ships a meaningful fraction of signup bots
 *      that test-run free trials and burn AI credits without converting.
 *   2. Per-IP rate limit (separate from the per-user buckets used elsewhere).
 *
 * Why a server-side wrapper instead of calling supabase.auth.signUp from
 * the client: we need a non-bypassable verification step. A client-side
 * Turnstile check is trivially skipped by anyone hitting Supabase Auth's
 * REST API directly. Doing this server-side lets us put the check in
 * front of the actual user creation.
 *
 * The previous client-side flow remains as a fallback path for environments
 * where Turnstile / honeypot aren't configured — see the public AuthScreen.
 *
 * Body: { email, password, name, honeypot, turnstileToken }
 */
export async function POST(request: Request) {
  // Per-IP rate limit. The "health" tier (60/min) is generous enough for
  // legitimate users (one signup per 10 sec is fine) and brick-walls
  // bot-net floods.
  const ipBlocked = await rateLimitByIpOrNull(request, 'health');
  if (ipBlocked) return ipBlocked;

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const honeypot = typeof body.honeypot === 'string' ? body.honeypot : '';
  const turnstileToken = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';

  if (!email || !password || !name) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  // Bot-detection gate.
  const xff = request.headers.get('x-forwarded-for');
  const remoteIp = xff ? xff.split(',')[0].trim() : null;
  const bot = await verifyHumanish({ honeypot, turnstileToken, remoteIp });
  if (!bot.ok) {
    // Don't leak which check failed — both responses look the same to a
    // probing bot. Internal logs (in verifyHumanish) record the reason.
    return NextResponse.json({ error: 'Could not verify request' }, { status: 400 });
  }

  // Funnel: passed bot check, about to attempt user creation. Anonymous
  // distinct id (the visitor doesn't have a user_id yet); PostHog will
  // alias this to user_id once signup_completed fires below.
  const anonId = body.anonymous_id || `pre-signup:${remoteIp ?? 'unknown'}:${Date.now()}`;
  void track({ distinctId: anonId, event: 'signup_started', properties: { has_turnstile: !!turnstileToken } });

  // Create the auth.users row via service-role admin API. We use this
  // instead of supabase.auth.signUp because admin.createUser lets us
  // continue without auto-confirmation flow — the existing email-confirm
  // pipeline (Supabase project settings) still fires its own email.
  const service = createServiceClient();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    user_metadata: { name, full_name: name },
    // email_confirm: false → Supabase sends the confirmation email.
    email_confirm: false,
  });

  if (error) {
    // Translate the most common Supabase admin error to a friendly response.
    const msg = error.message?.toLowerCase() ?? '';
    if (msg.includes('already')) {
      // Mirror the AuthScreen's "account exists" UX — surface a 409 the
      // client can interpret cleanly.
      return NextResponse.json(
        { error: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 },
      );
    }
    console.error('[auth/signup] createUser failed:', error);
    return NextResponse.json({ error: 'Could not create account' }, { status: 500 });
  }

  // Funnel: identity created. Use the new auth user id as distinct_id
  // and stitch the prior anonymous id via $set.
  if (data.user?.id) {
    void track({
      distinctId: data.user.id,
      event: 'signup_completed',
      properties: { $set: { name, anon_id: anonId } },
    });
  }

  return NextResponse.json({ ok: true, user_id: data.user?.id });
}
