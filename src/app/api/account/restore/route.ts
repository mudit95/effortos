import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

/**
 * POST /api/account/restore
 *
 * Reverses a prior soft-delete by clearing `profiles.deleted_at` for the
 * signed-in user. Only callable while the user is still inside the 30-day
 * recovery window (after that, the purge cron has irreversibly deleted
 * their data and the auth.users row no longer exists — they would need
 * to sign up fresh).
 *
 * Auth: the user MUST be signed in. We deliberately don't restore via a
 * public link — the act of signing in proves possession of the email +
 * password, which is the security boundary.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to restore your account' }, { status: 401 });
  }

  const service = createServiceClient();

  // Fetch the row first so we can return a clear error when the account
  // wasn't actually scheduled for deletion.
  const { data: profile, error: readErr } = await service
    .from('profiles')
    .select('deleted_at')
    .eq('id', user.id)
    .maybeSingle();

  if (readErr) {
    console.error('[restore] read failed:', readErr);
    return NextResponse.json({ error: 'Restore failed' }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: 'No account found' }, { status: 404 });
  }
  if (!profile.deleted_at) {
    return NextResponse.json({ ok: true, status: 'not_scheduled_for_deletion' });
  }

  const { error: updateErr } = await service
    .from('profiles')
    .update({ deleted_at: null })
    .eq('id', user.id);
  if (updateErr) {
    console.error('[restore] update failed:', updateErr);
    return NextResponse.json({ error: 'Restore failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
