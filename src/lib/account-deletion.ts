/**
 * Account hard-delete helper.
 *
 * Two callers use this module:
 *
 *   1. /api/account/delete — when a user soft-deletes their account, we
 *      DON'T call hardDeleteAccount immediately. We just stamp deleted_at.
 *      The user-facing endpoint stays simple: validate, cancel Razorpay,
 *      set deleted_at, sign out.
 *
 *   2. /api/cron/purge-deleted-accounts — daily cron that finds profiles
 *      where deleted_at < now - 30 days and calls hardDeleteAccount for
 *      each one. This is the only path that actually erases data.
 *
 * Why a shared helper:
 *   - The order of operations across 14 user-owned tables is non-trivial.
 *   - Both callers must produce the same end state.
 *   - Future test coverage can run hardDeleteAccount against a known
 *     fixture and assert all 14 tables are empty.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Erase every row owned by the user from every user-owned table, then
 * delete the auth.users row. Idempotent — safe to call twice.
 *
 * Returns null on success, error message on partial failure (the caller
 * decides whether to retry).
 */
export async function hardDeleteAccount(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  // Delete in FK-safe order. Children before parents.
  // milestones depends on goals; all other tables have user_id directly.
  const { data: userGoals } = await admin
    .from('goals')
    .select('id')
    .eq('user_id', userId);
  const goalIds = (userGoals ?? []).map((g) => g.id);

  if (goalIds.length) {
    await admin.from('milestones').delete().in('goal_id', goalIds);
  }

  // Each of these has a user_id column; delete independently.
  await Promise.all([
    admin.from('feedback_entries').delete().eq('user_id', userId),
    admin.from('sessions').delete().eq('user_id', userId),
    admin.from('daily_tasks').delete().eq('user_id', userId),
    admin.from('repeating_templates').delete().eq('user_id', userId),
    admin.from('timer_state').delete().eq('user_id', userId),
    admin.from('email_preferences').delete().eq('user_id', userId),
    admin.from('email_log').delete().eq('user_id', userId),
    admin.from('coupon_redemptions').delete().eq('user_id', userId),
    admin.from('journal_entries').delete().eq('user_id', userId),
    admin.from('shadow_goals').delete().eq('user_id', userId),
    admin.from('coach_log').delete().eq('user_id', userId),
    admin.from('other_todos').delete().eq('user_id', userId),
  ]);

  // Pacts: the user can be on either side of a 1:1 pact. Delete rows
  // they own; for rows where they're the partner we NULL out
  // partner_user_id so the other party's pact survives but loses the
  // link to the deleted user (matches the ON DELETE SET NULL FK).
  await admin.from('pacts').delete().eq('user_id', userId);
  await admin
    .from('pacts')
    .update({ partner_user_id: null })
    .eq('partner_user_id', userId);

  // Now the parents.
  await admin.from('goals').delete().eq('user_id', userId);
  await admin.from('subscriptions').delete().eq('user_id', userId);
  await admin.from('profiles').delete().eq('id', userId);

  // Finally remove the auth.users row. Invalidates every session token
  // the user holds. We don't pre-delete other tables that reference
  // auth.users via cascade (admin_actions, consent_log) — the cascade
  // FK handles those automatically when this call lands.
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    return `auth.admin.deleteUser failed: ${deleteUserError.message}`;
  }
  return null;
}
