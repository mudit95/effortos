/**
 * GET    /api/share/streak  — return the caller's active share token
 *                              (creates one on first call).
 * DELETE /api/share/streak  — revoke the active token.
 *
 * Response shape (both methods):
 *   { token: string | null, url: string | null }
 *
 * On revoke, returns { token: null, url: null }. The caller is expected
 * to call GET again to mint a fresh token if they want to share again.
 *
 * Token shape: 32-character base32-ish (URL-safe alphabet). Generated
 * via crypto.randomUUID() + a second UUID concatenated, with hyphens
 * stripped. The schema accepts any text >= 16 chars so we have headroom
 * to migrate to a different scheme later without a migration.
 *
 * Anti-abuse:
 *   - Auth required (no anonymous tokens).
 *   - Rate-limit (light bucket) — token creation hammers nothing
 *     destructive but we don't need 1000/min from a single user.
 *   - One active token per (user, kind=streak) — re-minting revokes
 *     the previous active row first, then inserts a new one.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimitOrNull } from '@/lib/ratelimit';

const SHARE_KIND = 'streak' as const;

/** Site origin for absolute share URLs. Falls back to env, then to the
 *  request host (which Next exposes via next/headers but we keep this
 *  endpoint Edge-compatible by deriving from the request URL instead). */
function getOrigin(req: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && explicit.startsWith('http')) return explicit.replace(/\/$/, '');
  try {
    return new URL(req.url).origin;
  } catch {
    return 'https://effortos-zeta.vercel.app';
  }
}

function makeToken(): string {
  // Two stripped UUIDs → 64 hex chars. Trim to 40 — long enough that
  // 16^40 ≈ 1.5e48 brute force is hopeless, short enough to fit in a
  // shareable WhatsApp message comfortably.
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return (a + b).slice(0, 40);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const blocked = await rateLimitOrNull(user.id, 'light');
  if (blocked) return blocked;

  // Look for an existing active token first.
  const { data: existing } = await supabase
    .from('share_tokens')
    .select('token')
    .eq('user_id', user.id)
    .eq('kind', SHARE_KIND)
    .is('revoked_at', null)
    .maybeSingle();

  if (existing?.token) {
    const origin = getOrigin(req);
    return NextResponse.json({
      token: existing.token,
      url: `${origin}/share/streak/${existing.token}`,
    });
  }

  // No active token — mint one. Retry on the rare collision (40-hex
  // collision is astronomically unlikely but the UNIQUE constraint
  // would still 23505 on a duplicate so we treat it gracefully).
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = makeToken();
    const { error: insertErr } = await supabase
      .from('share_tokens')
      .insert({ user_id: user.id, token, kind: SHARE_KIND });

    if (!insertErr) {
      const origin = getOrigin(req);
      return NextResponse.json({
        token,
        url: `${origin}/share/streak/${token}`,
      });
    }
    // 23505 = unique violation. Retry on collision; bail on anything else.
    const code = (insertErr as { code?: string }).code;
    if (code !== '23505') {
      console.error('[share/streak] insert failed:', insertErr);
      return NextResponse.json({ error: 'Failed to create share' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Could not generate token' }, { status: 500 });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const blocked = await rateLimitOrNull(user.id, 'light');
  if (blocked) return blocked;

  // Revoke whatever is currently active. We update by user+kind+is-null
  // to avoid touching previously-revoked rows.
  const { error } = await supabase
    .from('share_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('kind', SHARE_KIND)
    .is('revoked_at', null);

  if (error) {
    console.error('[share/streak] revoke failed:', error);
    return NextResponse.json({ error: 'Failed to revoke share' }, { status: 500 });
  }

  return NextResponse.json({ token: null, url: null });
}
