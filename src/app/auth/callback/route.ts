import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Auth callback handler for OAuth (Google) and email magic links.
 * Supabase redirects here after authentication.
 *
 * Apple OAuth was scoped but never implemented — the AuthScreen only
 * renders a Continue with Google button. Don't claim Apple support here
 * until the corresponding sign-in button + Apple developer config land.
 *
 * Why this route instantiates `createServerClient` directly instead of
 * using our shared `createClient()` helper: in a Next.js Route Handler,
 * cookies set via `next/headers` `cookies()` (which the helper does)
 * don't reliably propagate to a `NextResponse.redirect()` response — the
 * browser ends up redirected without the session cookie, so the next
 * request looks unauthenticated and the user appears "logged out
 * immediately after signing in." The official Supabase pattern is to
 * thread cookies through the OUTGOING response object, exactly the same
 * way our middleware does. See lib/supabase/middleware.ts for the same
 * pattern.
 *
 * Failure path: redirect back to /signin with an error query param. Note
 * the route is /signin (no hyphen) — there's no /sign-in route. Getting
 * this wrong sent failed Google logins to the 404 page.
 */
/**
 * Validate the post-auth `next` redirect target.
 *
 * Without this, an attacker could craft `?next=//evil.com/path`. The naive
 * `${origin}${next}` interpolation produces `https://yoursite.com//evil.com/path`,
 * which browsers normalise to `https://evil.com/path` (the leading `//`
 * makes it a protocol-relative URL). The user is then phished on a domain
 * that just held their freshly-issued auth cookie.
 *
 * Rule: must start with a single `/`, must not start with `//`, must not
 * contain a scheme (`https:` etc.) or backslash. Reject anything else and
 * fall back to home.
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return '/';
  // Reject protocol-relative URLs and absolute URLs.
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//')) return '/';
  // Reject backslash variants (some browsers treat \\ like //).
  if (raw.startsWith('/\\')) return '/';
  // Reject any embedded scheme.
  if (/^\/[^/]*:/.test(raw)) return '/';
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

  if (!code) {
    // No `code` query param — usually means the user hit the URL directly.
    return NextResponse.redirect(`${origin}/signin?error=auth_failed&reason=no_code`);
  }

  // Build the redirect response up-front so the cookie handlers below can
  // set session cookies directly on it. This is the critical detail that
  // fixes "Google sign-in keeps logging me off" — without it, the cookies
  // get written into the next/headers store and dropped on redirect.
  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Log the raw error server-side for diagnosis, but DON'T put it in the
    // redirect URL — the message ends up in the user's address bar, browser
    // history, and any HTTP referrer logged by downstream services. Use an
    // opaque code instead and rely on Sentry/server logs for detail.
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message);
    return NextResponse.redirect(
      `${origin}/signin?error=auth_failed&reason=exchange_failed`,
    );
  }
  return response;
}
