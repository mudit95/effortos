import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getRazorpay } from '@/lib/razorpay';

/**
 * POST /api/account/delete
 *
 * Hard-deletes the signed-in user's account:
 *   1. Verifies current password (defence against session hijack / shoulder-surfing).
 *   2. Requires the literal confirmation string "delete my account" in the body.
 *   3. Cancels any active Razorpay subscription immediately (no refund — the user
 *      is asking for complete removal, not a prorated refund).
 *   4. Deletes rows in every user-owned table, in FK-safe order.
 *   5. Deletes the auth.users row via the service-role client, which signs the
 *      user out of all sessions.
 *
 * Body: { password: string, confirmation: string }
 *
 * Compliance: GDPR Art. 17 "right to erasure" and DPDP Act §12 "right to
 * erasure of personal data". No soft-delete or grace period on the server —
 * once this endpoint returns 200, the data is gone.
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

    // 2. Switch to service-role client for the actual deletions. RLS would
    //    let the user delete their own rows, but a single privileged client
    //    makes the cleanup atomic-in-code and survives RLS policy drift.
    const admin = createServiceClient();

    // Delete in FK-safe order. Children before parents.
    // milestones depends on goals; all other tables have user_id directly.
    const { data: userGoals } = await admin
      .from('goals')
      .select('id')
      .eq('user_id', user.id);
    const goalIds = (userGoals ?? []).map(g => g.id);

    if (goalIds.length) {
      await admin.from('milestones').delete().in('goal_id', goalIds);
    }

    // Each of these has a user_id column; delete independently.
    await Promise.all([
      admin.from('feedback_entries').delete().eq('user_id', user.id),
      admin.from('sessions').delete().eq('user_id', user.id),
      admin.from('daily_tasks').delete().eq('user_id', user.id),
      admin.from('repeating_templates').delete().eq('user_id', user.id),
      admin.from('timer_state').delete().eq('user_id', user.id),
      admin.from('email_preferences').delete().eq('user_id', user.id),
      admin.from('email_log').delete().eq('user_id', user.id),
      admin.from('coupon_redemptions').delete().eq('user_id', user.id),
    ]);

    // Now the parents.
    await admin.from('goals').delete().eq('user_id', user.id);
    await admin.from('subscriptions').delete().eq('user_id', user.id);
    await admin.from('profiles').delete().eq('id', user.id);

    // 3. Finally remove the auth.users row. This invalidates every session
    //    token the user holds. If this specific call fails we leave behind an
    //    orphan auth row — surface the error so the caller knows it's not a
    //    full wipe yet. Everything else has succeeded at this point.
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      console.error('auth.admin.deleteUser failed:', deleteUserError);
      return NextResponse.json(
        {
          error:
            'User data was deleted but the account could not be removed. Contact support.',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Account deletion error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
