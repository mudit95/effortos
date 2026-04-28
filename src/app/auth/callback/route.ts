import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Auth callback handler for OAuth (Google, Apple) and email magic links.
 * Supabase redirects here after authentication.
 *
 * Failure path: redirect back to /signin with an error query param. Note
 * the route is /signin (no hyphen) — there's no /sign-in route. Getting
 * this wrong sent failed Google logins to the 404 page.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // Log the actual error so we can diagnose OAuth failures from logs.
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message);
    return NextResponse.redirect(
      `${origin}/signin?error=auth_failed&reason=${encodeURIComponent(error.message)}`,
    );
  }

  // No `code` query param — usually means the user hit the URL directly.
  return NextResponse.redirect(`${origin}/signin?error=auth_failed&reason=no_code`);
}
