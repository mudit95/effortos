import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { sendTextMessage } from '@/lib/whatsapp';
import { concurrentMap } from '@/lib/concurrency';
import { recordCronRun } from '@/lib/cron-run-log';
import {
  shouldFireForUser,
  evaluateMissingChecks,
  recentBeastNudgeExists,
  recordBeastNudge,
  dailyBeastCountForUser,
  beastMessage,
  beastDailyCap,
  beastModeDisabled,
  type BeastUser,
  type BeastNudgeKind,
} from '@/lib/beast-mode';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/beast-mode
 *
 * Runs every 30 minutes via GitHub Actions. For each Pro user with
 * `beast_mode_enabled = true` whose local time is currently within the
 * 20:00–23:30 evening window, this cron pings them on WhatsApp until
 * they have:
 *   1. Planned at least one task for tomorrow.
 *   2. Written a journal entry for today.
 *
 * Each gap (plan_tomorrow / journal_today) is debounced to one nudge
 * per ~25 minutes per user, so a wedged or double-firing cron tick
 * can't double-spam.
 *
 * Pro-gating: this is the most aggressive coaching feature we ship.
 * It's the value spike that makes Pro feel different from free —
 * "the bot won't shut up until you do the thing" is a paid promise.
 *
 * Auth: standard CRON_SECRET bearer.
 */
export async function GET(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  // ── 0. Global kill switch ──────────────────────────────────────
  // Read on every tick so flipping BEAST_MODE_DISABLED via Vercel env
  // takes effect immediately without redeploy. This is the WhatsApp
  // Business compliance lever — if Meta flags the number for repeated
  // unsolicited messaging, you set this to '1' and every subsequent
  // tick is a no-op until you can investigate.
  if (beastModeDisabled()) {
    await recordCronRun('beast-mode', 'success', { disabled: true, reason: 'kill_switch' });
    return NextResponse.json({ disabled: true, reason: 'kill_switch' });
  }

  const supabase = createServiceClient();

  try {
    // ── 1. Find candidate users ─────────────────────────────────────
    // Beast Mode requires three things on the profile: enabled flag,
    // linked WhatsApp, and a phone number. Coaching pause is checked
    // per-user inside shouldFireForUser so we don't reject everyone
    // upfront just for being mid-pause on one row.
    const { data: candidates, error: queryErr } = await supabase
      .from('profiles')
      .select('id, name, phone_number, timezone, coaching_paused_until')
      .eq('beast_mode_enabled', true)
      .eq('whatsapp_linked', true)
      .not('phone_number', 'is', null);

    if (queryErr) {
      console.error('[beast-mode] profile query failed:', queryErr);
      await recordCronRun('beast-mode', 'failure', { reason: 'query_failed' });
      return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
    }

    if (!candidates || candidates.length === 0) {
      await recordCronRun('beast-mode', 'success', { eligible: 0 });
      return NextResponse.json({ sent: 0, reason: 'no beast-mode users' });
    }

    // ── 2. Pro-tier filter ──────────────────────────────────────────
    // Mirrors the coach cron. We only ping subscribers in
    // ('trialing','active') — paused/canceled subscribers don't get
    // beast mode even if they left the toggle on.
    const userIds = candidates.map((u) => u.id);
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('user_id, plan_tier, status')
      .in('user_id', userIds)
      .eq('plan_tier', 'pro')
      .in('status', ['trialing', 'active']);

    const proSet = new Set((subs ?? []).map((s: { user_id: string }) => s.user_id));
    const eligibleUsers: BeastUser[] = candidates.filter((u) => proSet.has(u.id));

    if (eligibleUsers.length === 0) {
      await recordCronRun('beast-mode', 'success', { eligible: 0, reason: 'no pro users' });
      return NextResponse.json({ sent: 0, reason: 'no pro-tier beast users' });
    }

    // ── 3. Per-user evaluation + send ───────────────────────────────
    const now = new Date();
    let attempted = 0;
    let sent = 0;
    let outsideWindow = 0;
    const failures: string[] = [];

    // Concurrency 6: each user does ~2 cheap reads + up to 2 Meta sends.
    // Meta's per-app messaging rate limit is 80 msgs/sec on the standard
    // tier, so 6 in flight is far from any cap.
    const BEAST_CONCURRENCY = 6;

    const dailyCap = beastDailyCap();

    const results = await concurrentMap(eligibleUsers, BEAST_CONCURRENCY, async (user) => {
      if (!shouldFireForUser(user, now)) {
        return { kind: 'outside_window' as const };
      }

      const missing = await evaluateMissingChecks(supabase, user, now);
      if (missing.length === 0) {
        return { kind: 'satisfied' as const };
      }

      // ── Per-user daily ceiling ────────────────────────────────────
      // Single SELECT count per user per tick — cheap, but it's the
      // most important guardrail in this entire cron. Hitting `dailyCap`
      // means we have already pinged this user enough today (default
      // 4×) regardless of debounce gaps. Stops the runaway "user
      // forgot to journal, beast forgot to stop" failure mode.
      const sentToday = await dailyBeastCountForUser(supabase, user.id, now);
      if (sentToday >= dailyCap) {
        return { kind: 'cap_reached' as const, sentToday };
      }

      // Per-kind ping with per-kind debounce. We honour the daily cap
      // INSIDE this loop too so we don't fire two messages back-to-back
      // when the user is exactly one ping away from the ceiling.
      const perKindOutcomes: { kind: BeastNudgeKind; sent: boolean; debounced: boolean; capped?: boolean }[] = [];
      let sentThisTick = 0;
      for (const nudgeKind of missing) {
        if (sentToday + sentThisTick >= dailyCap) {
          perKindOutcomes.push({ kind: nudgeKind, sent: false, debounced: false, capped: true });
          continue;
        }
        const recent = await recentBeastNudgeExists(supabase, user.id, nudgeKind, now);
        if (recent) {
          perKindOutcomes.push({ kind: nudgeKind, sent: false, debounced: true });
          continue;
        }
        const message = beastMessage(nudgeKind, user.name);
        const phone = user.phone_number.replace(/^\+/, '');
        const delivered = await sendTextMessage(phone, message);
        await recordBeastNudge(supabase, {
          userId: user.id,
          nudgeKind,
          messageSent: message,
          delivered,
        });
        if (delivered) sentThisTick++;
        perKindOutcomes.push({ kind: nudgeKind, sent: delivered, debounced: false });
      }

      return { kind: 'pinged' as const, outcomes: perKindOutcomes };
    }, { taskTimeoutMs: 15_000 });

    let capReached = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const user = eligibleUsers[i];
      if (!r.ok) {
        failures.push(`${user.id}: ${r.error instanceof Error ? r.error.message : 'unknown'}`);
        continue;
      }
      const v = r.value;
      if (v.kind === 'outside_window') {
        outsideWindow++;
        continue;
      }
      if (v.kind === 'satisfied') continue;
      if (v.kind === 'cap_reached') {
        capReached++;
        continue;
      }
      // pinged
      for (const out of v.outcomes) {
        if (!out.debounced && !out.capped) attempted++;
        if (out.sent) sent++;
      }
    }

    await recordCronRun('beast-mode', 'success', {
      eligible: eligibleUsers.length,
      outside_window: outsideWindow,
      cap_reached: capReached,
      daily_cap: dailyCap,
      attempted,
      sent,
      failures: failures.length,
    });

    return NextResponse.json({
      eligible: eligibleUsers.length,
      outside_window: outsideWindow,
      cap_reached: capReached,
      daily_cap: dailyCap,
      attempted,
      sent,
      failures: failures.length > 0 ? failures : undefined,
    });
  } catch (err) {
    console.error('[beast-mode] fatal:', err);
    await recordCronRun('beast-mode', 'failure', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
