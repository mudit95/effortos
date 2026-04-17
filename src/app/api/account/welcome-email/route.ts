import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { welcomeEmail } from '@/lib/email-templates';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/account/welcome-email
 *
 * Idempotently sends the one-time welcome email to the authenticated user.
 * Safe to call on every app bootstrap — we bail out if:
 *   - user isn't authenticated,
 *   - profile was created more than 7 days ago (too late to be a "welcome"),
 *   - we've already logged a 'welcome' email to them,
 *   - the user has unsubscribed from all email.
 *
 * The client calls this fire-and-forget from initializeApp() right after
 * a successful cloud login. Returning 200 with { sent: false } is expected
 * for every bootstrap after the first.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ sent: false, reason: 'no email on account' });
  }

  const admin = createServiceClient();

  // Has a welcome email ever been logged for this user?
  const { data: prior } = await admin
    .from('email_log')
    .select('id')
    .eq('user_id', user.id)
    .eq('email_type', 'welcome')
    .limit(1)
    .maybeSingle();

  if (prior) {
    return NextResponse.json({ sent: false, reason: 'already sent' });
  }

  // Don't back-send to old accounts — only first-week signups.
  const { data: profile } = await admin
    .from('profiles')
    .select('name, created_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.created_at) {
    const ageMs = Date.now() - new Date(profile.created_at).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ sent: false, reason: 'account older than 7 days' });
    }
  }

  // Respect the global unsubscribe flag.
  const { data: prefs } = await admin
    .from('email_preferences')
    .select('unsubscribed_all')
    .eq('user_id', user.id)
    .maybeSingle();

  if (prefs?.unsubscribed_all) {
    return NextResponse.json({ sent: false, reason: 'unsubscribed' });
  }

  const userName =
    profile?.name ||
    (user.user_metadata?.name as string | undefined) ||
    (user.user_metadata?.full_name as string | undefined) ||
    'there';

  const { subject, html } = welcomeEmail({ userName });

  try {
    const result = await sendEmail({
      to: user.email,
      subject,
      html,
      tags: [{ name: 'type', value: 'welcome' }],
    });

    // Log so we never double-send.
    await admin.from('email_log').insert({
      user_id: user.id,
      email_to: user.email,
      email_type: 'welcome',
      subject,
      resend_id: result?.id ?? null,
      status: 'sent',
    });

    return NextResponse.json({ sent: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    // Record the failure so we can retry later without double-send concerns
    // (the idempotency check above uses any row, not just status=sent — so
    // keep failure rows out to allow the next bootstrap to retry).
    console.error('[welcome-email] Send failed:', msg);
    return NextResponse.json({ sent: false, error: msg }, { status: 200 });
  }
}
