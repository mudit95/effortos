import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { PENDING_PACT_TTL_DAYS } from '@/lib/pacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/pacts-cleanup
 *
 * Runs once daily. Flips any pending accountability-pact invites
 * older than PENDING_PACT_TTL_DAYS to status='declined' so they:
 *   1. Stop showing up in the user's pact list (the GET filter in
 *      /api/pacts already hides them client-facing, but this also
 *      keeps the underlying table tidy).
 *   2. Can no longer be accepted via their invite_code — the accept
 *      route checks `status === 'pending'` after the lookup.
 *
 * We mark as 'declined' rather than DELETE so the row sticks around
 * for audit / debugging — the inviter can still see that someone was
 * invited but the invite expired.
 *
 * Scheduled from vercel.json. Expects Authorization: Bearer CRON_SECRET.
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  // Service role: this is a system-level cleanup; no user is in the
  // request context. Without service role we'd be bound by RLS and
  // couldn't update rows where the cron isn't user_id/partner_user_id.
  const supabase = createServiceClient();

  const cutoff = new Date(
    Date.now() - PENDING_PACT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: expired, error } = await supabase
    .from('pacts')
    .update({ status: 'declined' })
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    // Returning the touched rows so we can log how much we cleaned —
    // useful when the cron alarms because nothing's happening.
    .select('id, user_id, partner_email, created_at');

  if (error) {
    console.error('[pacts-cleanup] update failed:', error);
    return NextResponse.json(
      { error: 'cleanup failed', detail: error.message },
      { status: 500 },
    );
  }

  const count = expired?.length ?? 0;
  console.log(
    `[pacts-cleanup] expired ${count} pending pact(s) older than ${PENDING_PACT_TTL_DAYS}d`,
  );

  return NextResponse.json({
    expired: count,
    cutoff,
    ttl_days: PENDING_PACT_TTL_DAYS,
  });
}
