import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getRazorpay } from '@/lib/razorpay';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * POST /api/account/delete
 *
 * Soft-deletes the signed-in user's account with a 30-day recovery window:
 *   1. Verifies current password (defence against session hijack / shoulder-surfing).
 *   2. Requires the literal confirmation string "delete my account" in the body.
 *   3. Cancels any active Razorpay subscription immediately so the card stops
 *      being charged during the recovery window.
 *   4. Sets `profiles.deleted_at = now()`. The /api/cron/purge-deleted-accounts
 *      cron hard-deletes rows where deleted_at < now - 30 days.
 *   5. Signs the user out so the next request lands on the landing page.
 *
 * Body: { password: string, confirmation: string }
 *
 * The user can restore their account within 30 days via /api/account/restore.
 * After 30 days, the cron triggers the actual hard-delete path (which still
 * runs in this same file's tearDown helper, called from the cron route).
 *
 * Compliance: GDPR Art. 17 "right to erasure" + DPDP Act §12 "right to
 * erasure" both allow a reasonable recovery window before permanent deletion.
 * Privacy policy explicitly mentions the 30-day window.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate-limit BEFORE password verification so the password check can't be
    // used as an unbounded brute-force oracle. The 'light' bucket (20/hour)
    // is generous for legitimate mistypes and infeasible for brute force.
    const blocked = await rateLimitOrNull(user.id, 'light');
    if (blocked) return blocked;

    let body: { password?: unknown; confirmation?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation : '';

    if (confirmation.trim().toLowerCase() !== 'delete my account') {
      return NextResponse.json(
        { error: "Type 'delete my account' to confirm" },
        { status: 400 },
      );
    }

    if (!password) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 });
    }

    // Re-verify password. signInWithPassword returns an error if wrong; a success
    // doesn't alter the current session because it creates a new one that we
    // discard. We rely on @supabase/ssr to not persist this because the API
    // route's cookie store only affects the response, and we won't emit the
    // new session cookies in the final redirect.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (authError) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 403 });
    }

    // 1. Cancel any live Razorpay subscription so it stops charging.
    //    We look it up with the user's row first — no Razorpay call if there's
    //    nothing to cancel.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('razorpay_subscription_id, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (
      sub?.razorpay_subscription_id &&
      (sub.status === 'trialing' || sub.status === 'active' || sub.status === 'past_due')
    ) {
      try {
        // cancel immediately (second arg = cancel_at_cycle_end=false)
        await getRazorpay().subscriptions.cancel(sub.razorpay_subscription_id, false);
      } catch (err) {
        // Log but don't abort — the user wants their account gone; a
        // Razorpay hiccup shouldn't strand them. The webhook handler is
        // idempotent so a later cancellation webhook will be harmless.
        console.error('Razorpay cancel during account deletion failed:', err);
      }
    }

    // 2. Soft-delete: stamp deleted_at via service-role client (the auth-
    //    bound supabase client may be RLS-blocked from setting that column
    //    depending on policy, and we want this write atomic regardless).
    //    The /api/cron/purge-deleted-accounts cron hard-deletes after 30d.
    const admin = createServiceClient();
    const { error: softDeleteErr } = await admin
      .from('profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', user.id);

    if (softDeleteErr) {
      console.error('Soft-delete failed:', softDeleteErr);
      return NextResponse.json(
        { error: 'Could not schedule deletion. Try again or contact support.' },
        { status: 500 },
      );
    }

    // 3. Sign the user out so the next request lands on landing.
    //    They can sign back in within 30 days to restore.
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('signOut after soft-delete failed (non-fatal):', err);
    }

    return NextResponse.json({
      success: true,
      scheduled_purge_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    console.error('Account deletion error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
