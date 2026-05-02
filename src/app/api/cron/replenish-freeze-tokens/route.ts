import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { recordCronRun } from '@/lib/cron-run-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/replenish-freeze-tokens
 *
 * Daily cron. Refills freeze_tokens_remaining for any profile whose
 * freeze_tokens_resets_at has passed today. Free tier resets to 1
 * token; Pro tier (active subscription) resets to 3.
 *
 * Reset cadence: monthly, anchored to the user's previous reset date
 * (not the calendar month). So a user who first replenished on
 * 2026-04-17 next replenishes on 2026-05-17, not 2026-05-01. Avoids
 * everyone refilling on the same day — easier on the DB and feels
 * more personal to the user.
 *
 * Idempotent: re-running the cron the same day is a no-op for
 * already-replenished users (their resets_at moves forward by 30
 * days, so the WHERE filter excludes them on the second run).
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const supabase = createServiceClient();
  const startedAt = Date.now();

  try {
    // ── 1. Find profiles whose bucket needs refilling ──
    //
    // NULL freeze_tokens_resets_at means "never replenished" — we
    // treat those as eligible too (the column's default is NULL on
    // pre-mig-035 profile rows). Both conditions get OR'd.
    const today = new Date().toISOString().slice(0, 10);
    const { data: dueProfiles, error: dueErr } = await supabase
      .from('profiles')
      .select('id')
      .or(`freeze_tokens_resets_at.is.null,freeze_tokens_resets_at.lte.${today}`);

    if (dueErr) {
      console.error('[replenish-freeze-tokens] query failed:', dueErr);
      await recordCronRun('replenish-freeze-tokens', 'failure', {
        error: dueErr.message,
      });
      return NextResponse.json({ error: 'query failed' }, { status: 500 });
    }

    if (!dueProfiles || dueProfiles.length === 0) {
      await recordCronRun('replenish-freeze-tokens', 'success', { replenished: 0 });
      return NextResponse.json({ replenished: 0, reason: 'nobody due today' });
    }

    const dueIds = dueProfiles.map((p) => p.id);

    // ── 2. Find which of those are Pro vs free ──
    //
    // Pro = active subscription with plan_tier='pro'. Looked up via
    // a single bulk query against subscriptions rather than a per-user
    // join, so the cron stays well under the 60s ceiling even at
    // thousands of users.
    const { data: proSubs } = await supabase
      .from('subscriptions')
      .select('user_id')
      .in('user_id', dueIds)
      .eq('plan_tier', 'pro')
      .in('status', ['trialing', 'active', 'past_due']);

    const proIds = new Set((proSubs || []).map((s) => s.user_id as string));

    // Compute next reset date once: today + 30 days.
    const nextReset = new Date();
    nextReset.setUTCDate(nextReset.getUTCDate() + 30);
    const nextResetIso = nextReset.toISOString().slice(0, 10);

    // ── 3. Bulk update in two batches: Pro (3 tokens) and free (1) ──
    let replenishedPro = 0;
    let replenishedFree = 0;

    if (proIds.size > 0) {
      const proIdsArray = Array.from(proIds);
      const { data: updated, error: upErr } = await supabase
        .from('profiles')
        .update({
          freeze_tokens_remaining: 3,
          freeze_tokens_resets_at: nextResetIso,
        })
        .in('id', proIdsArray)
        .select('id');
      if (upErr) {
        console.error('[replenish-freeze-tokens] pro update failed:', upErr);
      } else {
        replenishedPro = updated?.length ?? 0;
      }
    }

    const freeIds = dueIds.filter((id) => !proIds.has(id));
    if (freeIds.length > 0) {
      const { data: updated, error: upErr } = await supabase
        .from('profiles')
        .update({
          freeze_tokens_remaining: 1,
          freeze_tokens_resets_at: nextResetIso,
        })
        .in('id', freeIds)
        .select('id');
      if (upErr) {
        console.error('[replenish-freeze-tokens] free update failed:', upErr);
      } else {
        replenishedFree = updated?.length ?? 0;
      }
    }

    const elapsedMs = Date.now() - startedAt;
    await recordCronRun('replenish-freeze-tokens', 'success', {
      due: dueIds.length,
      replenishedPro,
      replenishedFree,
      elapsedMs,
    });

    return NextResponse.json({
      due: dueIds.length,
      replenished_pro: replenishedPro,
      replenished_free: replenishedFree,
      next_reset: nextResetIso,
      elapsedMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[replenish-freeze-tokens] threw:', err);
    await recordCronRun('replenish-freeze-tokens', 'failure', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
