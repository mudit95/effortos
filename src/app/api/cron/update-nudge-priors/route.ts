import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/update-nudge-priors
 *
 * Rebuilds the population-level Beta(α, β) posteriors in
 * nudge_slot_priors from the aggregate coach_log outcomes. New users
 * (<14 personal observations) Thompson-sample from these instead of
 * their sparse own posteriors, so the better the population priors,
 * the faster a fresh user's bandit converges.
 *
 * Schedule: once daily at 03:00 UTC via GitHub Actions cron. We don't
 * need finer granularity — the priors only matter for new users and
 * a 24-hour delay in incorporating outcomes is invisible at our scale.
 *
 * Aggregation:
 *   - For each (nudge_type, slot), count successes (outcome=TRUE) and
 *     failures (outcome=FALSE) across ALL users for the last 90 days.
 *   - α = 1 + successes; β = 1 + failures.
 *   - n_observations = successes + failures.
 *
 * The 90-day window prevents stale priors — if user behaviour shifts
 * (e.g. seasonal shift in productive hours), old data should age out.
 *
 * Idempotency: full UPSERT of every (nudge_type, slot) row. Re-running
 * is a no-op if no new outcomes landed. Concurrent runs serialise on
 * the row-level UPDATEs.
 */
const PRIORS_LOOKBACK_DAYS = 90;

// Slots to update — mirrors what nudge-bandit.ts ships with. Adding a
// new bandit-driven nudge type means adding it here and re-running
// the cron once.
const NUDGE_TYPE_SLOTS: Record<string, readonly string[]> = {
  morning_kickoff: ['6', '7', '8', '9', '10'],
};

export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = createServiceClient();

  try {
    const since = new Date(Date.now() - PRIORS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const updates: Array<{
      nudge_type: string;
      slot: string;
      alpha: number;
      beta: number;
      n_observations: number;
    }> = [];

    for (const [nudgeType, slots] of Object.entries(NUDGE_TYPE_SLOTS)) {
      for (const slot of slots) {
        const [{ count: successes }, { count: failures }] = await Promise.all([
          supabase
            .from('coach_log')
            .select('id', { count: 'exact', head: true })
            .eq('nudge_type', nudgeType)
            .eq('nudge_slot', slot)
            .eq('outcome', true)
            .gte('created_at', since),
          supabase
            .from('coach_log')
            .select('id', { count: 'exact', head: true })
            .eq('nudge_type', nudgeType)
            .eq('nudge_slot', slot)
            .eq('outcome', false)
            .gte('created_at', since),
        ]);

        const s = successes ?? 0;
        const f = failures ?? 0;
        updates.push({
          nudge_type: nudgeType,
          slot,
          alpha: 1 + s,
          beta: 1 + f,
          n_observations: s + f,
        });
      }
    }

    // Upsert all rows. The PRIMARY KEY (nudge_type, slot) drives the
    // conflict target.
    const { error: upsertErr } = await supabase
      .from('nudge_slot_priors')
      .upsert(updates.map((u) => ({ ...u, updated_at: new Date().toISOString() })), {
        onConflict: 'nudge_type,slot',
      });

    if (upsertErr) {
      console.error('[update-nudge-priors] upsert failed:', upsertErr);
      await recordCronRun('update-nudge-priors', 'failure', { error: upsertErr.message });
      return NextResponse.json({ error: 'Upsert failed' }, { status: 500 });
    }

    await recordCronRun('update-nudge-priors', 'success', {
      slots_updated: updates.length,
    });

    return NextResponse.json({
      slots_updated: updates.length,
      lookback_days: PRIORS_LOOKBACK_DAYS,
      updates,
    });
  } catch (err) {
    console.error('[update-nudge-priors] fatal:', err);
    await recordCronRun('update-nudge-priors', 'failure', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
