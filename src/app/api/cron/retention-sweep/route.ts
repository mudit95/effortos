import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { getAdminSupabase } from '@/lib/cron-helpers';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/retention-sweep
 *
 * Prunes append-only operational tables so they don't grow forever.
 *
 * At ~1000 active users:
 *   coach_log              ~6k rows/day → 2.2M / year
 *   email_log              ~3k rows/day → 1.1M / year
 *   wa_processed_messages  ~10k rows/day on a busy bot
 *   webhook_events         ~few/day per paying user
 *
 * None of these are user-facing data. They exist for short-term forensics
 * (Did the cron fire? Did Razorpay send the activated event? Did this
 * particular WhatsApp message get duped?) and lose value quickly.
 *
 * Retention windows are conservative — long enough that "what happened
 * last week" debugging still works, short enough that the indexes stay
 * fast and the disk bill stays small.
 *
 * IMPORTANT: this only deletes operational logs. Sessions, daily_tasks,
 * journal_entries, goals, profiles — all the stuff users own — are
 * never touched here.
 *
 * Scheduled daily from vercel.json. Expects Authorization: Bearer CRON_SECRET.
 */

interface SweepTarget {
  table: string;
  retentionDays: number;
  // Column to compare against `now() - retentionDays days`.
  // Must be timestamptz; safe-listed below so we don't allow arbitrary input.
  timestampColumn: string;
}

const SWEEP_TARGETS: SweepTarget[] = [
  // Coach nudge log — keep enough history that the daily-cap check
  // (last 24h) and weekly-recap analysis (~last 14d) still work.
  // 180 days gives us 6 months of nudge history for retro analysis.
  { table: 'coach_log',             retentionDays: 180, timestampColumn: 'created_at' },

  // Transactional email log. Bounce / complaint debugging usually needs
  // ~30 days of history. We're conservative at 180 to keep DKIM-issue
  // forensics intact.
  { table: 'email_log',             retentionDays: 180, timestampColumn: 'created_at' },

  // WhatsApp inbound dedup. Meta retries top out at ~24h, so 7 days is
  // luxurious headroom. Anything older than this is just disk waste.
  { table: 'wa_processed_messages', retentionDays: 7,   timestampColumn: 'processed_at' },

  // Razorpay webhook idempotency log. Razorpay won't retry an event
  // older than ~24h either. 90 days lets us debug a specific subscription
  // history, then prunes.
  { table: 'webhook_events',        retentionDays: 90,  timestampColumn: 'received_at' },
];

export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = getAdminSupabase();
  const results: Array<{
    table: string;
    cutoff: string;
    deleted: number | null;
    error?: string;
  }> = [];

  for (const target of SWEEP_TARGETS) {
    const cutoff = new Date(
      Date.now() - target.retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    try {
      // `count: 'exact'` makes Supabase return the deleted-row count via
      // the response header — useful for monitoring sweep volume over
      // time. The .lt() filter below keeps the delete bounded; without it
      // a typo could empty the table.
      const { error, count } = await supabase
        .from(target.table)
        .delete({ count: 'exact' })
        .lt(target.timestampColumn, cutoff);

      if (error) {
        console.error(`[retention-sweep] ${target.table} failed:`, error);
        results.push({
          table: target.table,
          cutoff,
          deleted: null,
          error: error.message,
        });
        continue;
      }

      results.push({ table: target.table, cutoff, deleted: count ?? 0 });
      console.log(`[retention-sweep] ${target.table}: deleted ${count ?? 0} rows older than ${cutoff}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[retention-sweep] ${target.table} threw:`, msg);
      results.push({ table: target.table, cutoff, deleted: null, error: msg });
    }
  }

  const totalDeleted = results.reduce((sum, r) => sum + (r.deleted ?? 0), 0);
  const anyTableErrored = results.some((r) => r.error);
  await recordCronRun(
    'retention-sweep',
    anyTableErrored ? 'failure' : 'success',
    { totalDeleted, results },
  );
  return NextResponse.json({ ok: true, totalDeleted, results });
}
