/**
 * Cron success/failure logger.
 *
 * Every cron route should `await recordCronRun(...)` exactly once at the
 * end of its handler — once for the successful 2xx path, once in the
 * outer catch for the failure path. The watchdog cron (see
 * /api/cron/watchdog) reads from cron_run_log to decide which crons
 * are healthy and which need an alert.
 *
 * Cadence catalog: this is the single source of truth for "how stale is
 * too stale" per cron. The watchdog reads CRON_CATALOG below to compute
 * per-cron staleness thresholds. Add a new cron here when you add a new
 * route under /api/cron/.
 */

import { createServiceClient } from './supabase/service';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CronCadenceEntry {
  /** Stable cron name; matches the URL path component. */
  name: string;
  /** Maximum tolerable gap between successful runs, in minutes.
   *  Set conservatively — false-positives from a single missed run hurt
   *  more than catching a real outage 90 minutes later. */
  staleAfterMinutes: number;
  /** Human-friendly description for the alert email. */
  description: string;
}

/**
 * Source-of-truth catalog. Hourly crons get a 90-minute window
 * (one missed run is a hiccup; two means trouble). Daily crons get a
 * 26-hour window (gives Vercel cron one missed slot before alerting).
 */
export const CRON_CATALOG: CronCadenceEntry[] = [
  { name: 'morning-email',           staleAfterMinutes: 90,  description: 'Hourly morning email digest' },
  { name: 'afternoon-email',         staleAfterMinutes: 90,  description: 'Hourly afternoon check-in' },
  { name: 'nightly-email',           staleAfterMinutes: 90,  description: 'Hourly nightly recap' },
  { name: 'coach',                   staleAfterMinutes: 90,  description: 'Hourly AI coach nudges' },
  { name: 'beast-mode',              staleAfterMinutes: 60,  description: 'Beast Mode every-30-min evening enforcer' },
  { name: 'trial-ending',            staleAfterMinutes: 26 * 60, description: 'Daily trial-ending warning' },
  { name: 'pacts-cleanup',           staleAfterMinutes: 26 * 60, description: 'Daily pacts maintenance' },
  { name: 'retention-sweep',         staleAfterMinutes: 26 * 60, description: 'Daily operational-table prune' },
  { name: 'purge-deleted-accounts',  staleAfterMinutes: 26 * 60, description: 'Daily 30-day soft-delete purge' },
  { name: 're-engagement',           staleAfterMinutes: 26 * 60, description: 'Daily inactive-user nudge' },
  { name: 'pact-activity',           staleAfterMinutes: 26 * 60, description: 'Daily pact-partner activity recap' },
];

export async function recordCronRun(
  cronName: string,
  status: 'success' | 'failure',
  details?: Record<string, unknown>,
  client?: SupabaseClient,
): Promise<void> {
  try {
    const supabase = client ?? createServiceClient();
    await supabase.from('cron_run_log').insert({
      cron_name: cronName,
      status,
      details: details ?? null,
    });
  } catch (err) {
    // A failed audit-write should NEVER take down the cron job that just
    // succeeded. Log loudly; the watchdog will eventually notice if writes
    // are systemically broken (because no rows show up at all).
    console.error('[cron-run-log] insert failed (non-fatal):', err);
  }
}
