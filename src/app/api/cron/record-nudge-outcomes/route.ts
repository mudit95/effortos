import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { recordCronRun } from '@/lib/cron-run-log';
import { recordOutcome } from '@/lib/nudge-bandit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/record-nudge-outcomes
 *
 * Walks recent coach_log rows whose 30-min outcome window has just
 * elapsed and records whether a focus session started. Result feeds
 * the per-user Beta posteriors the bandit reads.
 *
 * Schedule: every 5 minutes via the GitHub Actions cron config. The
 * 5-min cadence keeps the latency between "nudge sent" and "outcome
 * recorded" bounded at ~35 minutes worst case (delivery time + 30 min
 * window + 5 min cron lag), which is well within the lifecycle of
 * making the next day's pickSlot decision.
 *
 * Why GitHub Actions and not Vercel Cron: same reason as the rest of
 * the cron suite — the Hobby tier's "1 cron / 24h" limit is tighter
 * than what the bandit needs. The Actions config (.github/workflows/
 * cron.yml) hits this endpoint every 5 minutes with the bearer token.
 *
 * Idempotency: each row's UPDATE is guarded by `outcome IS NULL`, so a
 * double-tap of this cron (network retry, manual trigger overlap)
 * never overwrites a recorded outcome.
 *
 * Performance: caps at 500 rows per invocation so a backlog (e.g.
 * after the cron was paused) doesn't blow the function timeout.
 * Subsequent invocations chew through the rest.
 */
const ATTRIBUTION_WINDOW_MIN = 30;
const SAFETY_MAX_ROWS = 500;

export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = createServiceClient();

  try {
    // Window boundaries:
    //   - Lower bound: 4 hours ago. Old enough that the outcome window
    //     has definitely elapsed; recent enough that we're not
    //     re-evaluating ancient logs after a cron outage. Pair-with-
    //     `outcome IS NULL` filter so we re-process anything that
    //     was missed within that 4-hour buffer.
    //   - Upper bound: 30 minutes ago. Anything more recent than that
    //     hasn't completed its attribution window yet.
    const windowEnd = new Date(Date.now() - ATTRIBUTION_WINDOW_MIN * 60 * 1000).toISOString();
    const windowStart = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const { data: rows, error: queryErr } = await supabase
      .from('coach_log')
      .select('id, user_id, nudge_slot, created_at, delivered')
      .is('outcome', null)
      .eq('delivered', true) // skip rows that never reached the user
      .not('nudge_slot', 'is', null) // only attribute rows we have a slot for
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .order('created_at', { ascending: true })
      .limit(SAFETY_MAX_ROWS);

    if (queryErr) {
      console.error('[record-nudge-outcomes] query failed:', queryErr);
      await recordCronRun('record-nudge-outcomes', 'failure', { error: queryErr.message });
      return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      await recordCronRun('record-nudge-outcomes', 'success', { processed: 0 });
      return NextResponse.json({ processed: 0 });
    }

    // For each row, check whether a session started within the
    // attribution window after delivery. We can't know exact delivery
    // time (created_at is when we wrote the row, not when the user
    // received it on WhatsApp) — created_at is close enough for a
    // first-pass implementation. Future: persist delivered_at from
    // the Meta webhook receipt.
    let successCount = 0;
    let failureCount = 0;
    const results: Array<{ id: string; outcome: boolean }> = [];

    for (const row of rows) {
      const sentAt = new Date(row.created_at as string).getTime();
      const windowEndMs = sentAt + ATTRIBUTION_WINDOW_MIN * 60 * 1000;

      const { count } = await supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', row.user_id as string)
        .eq('status', 'completed')
        .gte('start_time', new Date(sentAt).toISOString())
        .lte('start_time', new Date(windowEndMs).toISOString());

      const hadSession = (count ?? 0) > 0;
      await recordOutcome(supabase, row.id as string, hadSession);
      results.push({ id: row.id as string, outcome: hadSession });
      if (hadSession) successCount++;
      else failureCount++;
    }

    await recordCronRun('record-nudge-outcomes', 'success', {
      processed: rows.length,
      success: successCount,
      failure: failureCount,
    });

    return NextResponse.json({
      processed: rows.length,
      success: successCount,
      failure: failureCount,
    });
  } catch (err) {
    console.error('[record-nudge-outcomes] fatal:', err);
    await recordCronRun('record-nudge-outcomes', 'failure', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
