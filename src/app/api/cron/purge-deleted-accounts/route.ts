import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getAdminSupabase } from '@/lib/cron-helpers';
import { hardDeleteAccount } from '@/lib/account-deletion';
import { concurrentMap } from '@/lib/concurrency';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Hobby cap is 60s. Concurrent purge at 5 × ~5s/user = ~60 users/run.
// Real-world ripe-account counts are much smaller; 60s is comfortable.
export const maxDuration = 60;

/**
 * GET /api/cron/purge-deleted-accounts
 *
 * Daily sweep that hard-deletes profiles whose `deleted_at` is older
 * than 30 days. The user-facing /api/account/delete only sets deleted_at;
 * this is the actual erasure.
 *
 * Compliance:
 *   Privacy policy promises "we delete your personal data within 30 days
 *   of a deletion request." The 30-day window gives users a chance to
 *   recover an accidental click; past 30 we run the irreversible cleanup
 *   defined in lib/account-deletion.ts.
 *
 * Idempotency: hardDeleteAccount is itself idempotent. If the cron runs
 * twice on the same row (Vercel retry, manual trigger), the second pass
 * is a no-op — every table delete .eq()s on a row that's already gone.
 *
 * Concurrency: bounded at 5 because each user's hardDelete touches ~14
 * tables and the auth admin API has its own implicit per-second limit.
 *
 * Scheduled daily at 04:30 UTC (just after retention-sweep). Auth via
 * the standard CRON_SECRET bearer.
 */

const PURGE_AFTER_DAYS = 30;
const PURGE_CONCURRENCY = 5;

export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = getAdminSupabase();
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: ripeProfiles, error } = await supabase
    .from('profiles')
    .select('id, deleted_at')
    .lt('deleted_at', cutoff);

  if (error) {
    console.error('[purge-deleted-accounts] query failed:', error);
    await recordCronRun('purge-deleted-accounts', 'failure', { reason: 'query_failed', error: error.message });
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
  if (!ripeProfiles || ripeProfiles.length === 0) {
    await recordCronRun('purge-deleted-accounts', 'success', { purged: 0 });
    return NextResponse.json({ purged: 0, cutoff });
  }

  let purged = 0;
  const errors: string[] = [];

  const results = await concurrentMap(ripeProfiles, PURGE_CONCURRENCY, async (p) => {
    const err = await hardDeleteAccount(supabase, p.id);
    return { id: p.id, err };
  });

  for (const r of results) {
    if (!r.ok) {
      errors.push(r.error instanceof Error ? r.error.message : String(r.error));
      continue;
    }
    if (r.value.err) {
      errors.push(`${r.value.id}: ${r.value.err}`);
    } else {
      purged++;
    }
  }

  await recordCronRun(
    'purge-deleted-accounts',
    errors.length > 0 ? 'failure' : 'success',
    { purged, considered: ripeProfiles.length, errorCount: errors.length },
  );
  return NextResponse.json({
    purged,
    cutoff,
    considered: ripeProfiles.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
