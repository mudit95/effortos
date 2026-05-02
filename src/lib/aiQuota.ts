/**
 * Per-user daily Anthropic token cap.
 *
 * Why this exists:
 *   Without a guard, a single misbehaving user (or a scripted attack) can
 *   burn arbitrary $$ of Anthropic credits in a day. At ~$3 per million
 *   tokens for Haiku 4.5 (input+output blended), one user spamming the
 *   chat endpoint at 5k tokens/request × 200 requests = $3 of spend in
 *   an hour. At 1000 such users that's catastrophic.
 *
 *   This module gives every user a daily token budget by tier, tracked in
 *   Redis with a 24h sliding key. Calls past the budget reject with a
 *   typed error that callers translate to a friendly user-facing message.
 *
 * Daily limits (input + output combined, per Anthropic's `usage` field):
 *   - free      :    5,000 tokens — implicit-trial new accounts
 *   - starter   :   50,000 tokens — average user runs 5-10k/day
 *   - pro       :  200,000 tokens — heavy users + proactive coach
 *
 * These are intentionally generous for the median user — a normal day's
 * usage on Starter is ~10-15k tokens. The cap is meant to catch abuse
 * outliers, not nudge engaged users into upgrading.
 *
 * USAGE (the canonical pattern):
 *
 *   import { ensureAiQuota, recordAiUsage, getUserAiTier } from '@/lib/aiQuota';
 *
 *   const tier = await getUserAiTier(supabase, user.id);
 *   const gate = await ensureAiQuota(user.id, tier);
 *   if (!gate.ok) {
 *     return NextResponse.json(
 *       { error: 'Daily AI quota exhausted', resetAt: gate.resetAt },
 *       { status: 429 },
 *     );
 *   }
 *
 *   const response = await anthropic.messages.create({ ... });
 *   await recordAiUsage(user.id, response.usage);
 *   // ...respond as normal
 *
 * TOCTOU note: ensureAiQuota reads the bucket then returns ok before the
 * actual API call lands. Two parallel calls can both pass the check and
 * push the user fractionally over their cap. We accept that — at 50k/day
 * granularity, occasionally over-delivering by a single request's worth
 * of tokens is much better than rejecting a legitimate user mid-sentence.
 *
 * Fail-open: if Redis is misconfigured (env vars missing) we let the
 * call proceed. This matches the rest of the rate-limit infra and keeps
 * dev/preview deploys functional. In production with Upstash wired,
 * over-budget calls return 429.
 */

import { getRedis } from './ratelimit';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AiTier = 'free' | 'starter' | 'pro';

const DAILY_TOKEN_LIMITS: Record<AiTier, number> = {
  free: 5_000,
  starter: 50_000,
  pro: 200_000,
};

/** Day-bucket key in Redis. UTC day; rolls over at midnight UTC. */
function bucketKey(userId: string): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `aiq:${userId}:${day}`;
}

/** ms-until-midnight-UTC, used for Redis TTL + caller resetAt hint. */
function msUntilUtcMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

export interface QuotaOk { ok: true; used: number; limit: number; tier: AiTier }
export interface QuotaExhausted {
  ok: false;
  used: number;
  limit: number;
  tier: AiTier;
  /** Unix-ms when the bucket resets (UTC midnight). */
  resetAt: number;
}

/**
 * Check whether the user has remaining AI quota today.
 *
 * Returns ok=true with the current usage if under cap, ok=false with
 * resetAt if exhausted. Fails open (returns ok=true with limit=∞) when
 * Redis isn't configured.
 */
export async function ensureAiQuota(
  userId: string,
  tier: AiTier = 'starter',
): Promise<QuotaOk | QuotaExhausted> {
  const redis = getRedis();
  if (!redis) {
    // Fail-open in development so local testing without Upstash keys works.
    // Fail-CLOSED in production: an unconfigured Redis there means cost
    // controls are silently disabled — a single user could burn arbitrary
    // Anthropic spend with no upper bound. We'd rather hard-fail the AI
    // request and surface the misconfig than serve unlimited spend.
    if (process.env.NODE_ENV === 'production') {
      console.error('[aiQuota] Redis not configured — failing closed in production. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.');
      return {
        ok: false,
        used: 0,
        limit: DAILY_TOKEN_LIMITS[tier],
        tier,
        resetAt: Date.now() + msUntilUtcMidnight(),
      };
    }
    return { ok: true, used: 0, limit: Number.POSITIVE_INFINITY, tier };
  }

  const limit = DAILY_TOKEN_LIMITS[tier];
  const key = bucketKey(userId);
  const used = Number((await redis.get<number>(key)) ?? 0);

  if (used >= limit) {
    return {
      ok: false,
      used,
      limit,
      tier,
      resetAt: Date.now() + msUntilUtcMidnight(),
    };
  }
  return { ok: true, used, limit, tier };
}

/**
 * Add the actual token usage from an Anthropic response to today's bucket.
 *
 * Anthropic's `response.usage` shape:
 *   { input_tokens: number; output_tokens: number; ... }
 * We sum both — what matters for cost is the combined consumption.
 *
 * Sets a 26-hour TTL on the bucket key; well past UTC midnight rollover
 * so we never accidentally lose a record while the day is still ours.
 */
export async function recordAiUsage(
  userId: string,
  // Anthropic's Usage type uses `number | null` for cache fields. We accept
  // both null and undefined to keep the helper drop-in for response.usage.
  usage:
    | {
        input_tokens?: number | null;
        output_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      }
    | null
    | undefined,
): Promise<void> {
  if (!usage) return;
  const redis = getRedis();
  if (!redis) return;

  // Conservative count — include cache-creation tokens (we pay for them
  // even though they're not in input). Cache-read tokens are 10% of
  // input cost; we count them at full weight, accepting a small
  // overestimate vs. the complexity of fractional accounting.
  const total =
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  if (total <= 0) return;

  const key = bucketKey(userId);
  // INCRBY + EXPIRE in two calls. Upstash supports pipelines but for one
  // user-call this is fast enough (<10ms typical) and the code stays clear.
  try {
    await redis.incrby(key, total);
    // 26-hour TTL — long enough to survive UTC midnight rollover safely.
    // The next day's first call writes a fresh key automatically.
    await redis.expire(key, 26 * 60 * 60);
  } catch (err) {
    console.error('[aiQuota] recordAiUsage failed (non-fatal):', err);
  }
}

/**
 * Resolve a user's AI tier from their subscription row.
 *
 * Mapping:
 *   - status active/past_due/trialing + plan_tier='pro'      → 'pro'
 *   - status active/past_due/trialing + plan_tier='starter'  → 'starter'
 *   - any other state                                         → 'free'
 *
 * Free tier here means "implicit 3-day trial" or "subscription lapsed".
 * Both deserve some AI access (otherwise nothing works) but a much
 * smaller bucket than paying users.
 */
export async function getUserAiTier(
  supabase: SupabaseClient,
  userId: string,
): Promise<AiTier> {
  const { data } = await supabase
    .from('subscriptions')
    .select('status, plan_tier')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return 'free';
  const liveStatuses = ['active', 'past_due', 'trialing'];
  if (!liveStatuses.includes(data.status)) return 'free';
  return data.plan_tier === 'pro' ? 'pro' : 'starter';
}
