import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/unsubscribe
 *
 * Handles two distinct flows for the same signed token:
 *
 *   POST  — RFC 8058 one-click unsubscribe. Gmail / Apple Mail POST a
 *           form-encoded body of `List-Unsubscribe=One-Click` directly to
 *           this URL (which we publish in the `List-Unsubscribe` header
 *           in src/lib/email.ts). We must respond 2xx without UI, having
 *           flipped the kill switch.
 *
 *   GET   — A user manually clicked the unsubscribe link in the email.
 *           We flip the kill switch and redirect to the human-readable
 *           /unsubscribe page so they get visible confirmation.
 *
 * Either way, the signed token is what authenticates the action. There
 * is no session requirement — the user is consuming an email they
 * received, not an in-app interaction.
 *
 * RLS: `email_preferences.unsubscribed_all` is a per-user mutable column
 * (RLS allows the owner). Anonymous calls have no auth.uid(); we use the
 * service-role client so the update succeeds without bypassing the
 * signature check above.
 */

async function performUnsubscribe(email: string): Promise<{ ok: boolean; reason?: string }> {
  const service = createServiceClient();

  // Resolve email → user_id via auth.admin.listUsers.
  // We don't have a public profiles.email column under our control (it's a
  // copy that may be stale), so use the auth source of truth.
  const { data: usersPage, error: listErr } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) {
    console.error('[unsubscribe] auth.admin.listUsers failed:', listErr);
    return { ok: false, reason: 'lookup_failed' };
  }
  const lower = email.toLowerCase();
  const match = usersPage.users.find((u) => u.email?.toLowerCase() === lower);

  if (!match) {
    // No-account-for-email is treated as success: don't leak account
    // existence via different responses, and the unsubscribe is a no-op
    // that's fine to silently succeed for a stale email anyway.
    return { ok: true };
  }

  // Upsert email_preferences with unsubscribed_all=true.
  const { error: upErr } = await service
    .from('email_preferences')
    .upsert(
      {
        user_id: match.id,
        unsubscribed_all: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (upErr) {
    console.error('[unsubscribe] upsert failed:', upErr);
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true };
}

function requireToken(searchParams: URLSearchParams) {
  const t = searchParams.get('t');
  if (!t) return { ok: false as const, reason: 'missing_token' as const };
  const v = verifyUnsubscribeToken(t);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  return { ok: true as const, email: v.email };
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const verified = requireToken(url.searchParams);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  const result = await performUnsubscribe(verified.email);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }
  // RFC 8058: any 2xx is fine.
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const verified = requireToken(url.searchParams);
  if (!verified.ok) {
    // Bounce to the page with an error code so the user sees something
    // intelligible instead of raw JSON.
    return NextResponse.redirect(`${url.origin}/unsubscribe?status=error&reason=${verified.reason}`);
  }

  const result = await performUnsubscribe(verified.email);
  if (!result.ok) {
    return NextResponse.redirect(`${url.origin}/unsubscribe?status=error&reason=${result.reason}`);
  }
  return NextResponse.redirect(`${url.origin}/unsubscribe?status=ok`);
}
