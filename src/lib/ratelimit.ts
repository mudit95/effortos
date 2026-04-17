/**
 * Per-user rate limiting for the AI coach endpoints.
 *
 * Uses Upstash Redis via their REST client — pay-per-call, fits Vercel's
 * edge/serverless model with zero cold-start overhead.
 *
 * Environment variables required (set in Vercel):
 *   UPSTASH_REDIS_REST_URL    e.g. https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN  (read+write token, found in Upstash console)
 *
 * Design note: we fail OPEN when the env vars aren't set. That's deliberate
 * so local dev and the pre-Upstash production state don't break. In
 * production with Upstash wired up, requests over-budget return 429.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

type Tier = 'light' | 'heavy';

/** Limits, tuned to cap Anthropic spend per user without being user-hostile. */
const LIMITS: Record<Tier, { tokens: number; window: `${number} ${'s' | 'm' | 'h' | 'd'}` }> = {
  // Cheap, short-prompt endpoints called frequently on the dashboard.
  light: { tokens: 20, window: '1 h' },
  // Longer-context endpoints that should only fire a handful of times a day.
  heavy: { tokens: 5, window: '1 d' },
};

let _cache: { light: Ratelimit; heavy: Ratelimit } | null = null;

function getLimiters(): { light: Ratelimit; heavy: Ratelimit } | null {
  if (_cache) return _cache;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const redis = new Redis({ url, token });

  _cache = {
    light: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(LIMITS.light.tokens, LIMITS.light.window),
      analytics: true,
      prefix: 'rl:coach:light',
    }),
    heavy: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(LIMITS.heavy.tokens, LIMITS.heavy.window),
      analytics: true,
      prefix: 'rl:coach:heavy',
    }),
  };

  return _cache;
}

export interface RateLimitResult {
  ok: boolean;
  /** Remaining requests in the current window, or -1 when not configured. */
  remaining: number;
  /** Unix ms when the window resets. 0 when not configured. */
  reset: number;
  /** Configured limit, 0 when not configured. */
  limit: number;
  /** Seconds until the user can retry. Only meaningful when ok === false. */
  retryAfterSec: number;
}

/**
 * Consume one token for this (userId, tier) bucket.
 * Safe to call from any Next.js route handler.
 */
export async function rateLimitCoach(userId: string, tier: Tier): Promise<RateLimitResult> {
  const limiters = getLimiters();
  if (!limiters) {
    // Fail open if Upstash isn't configured. Log once-per-process so prod
    // misconfig is visible without spamming.
    if (!warned) {
      console.warn(
        '[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — skipping rate limiting. ' +
          'Anthropic spend is UNBOUNDED until these are configured.',
      );
      warned = true;
    }
    return { ok: true, remaining: -1, reset: 0, limit: 0, retryAfterSec: 0 };
  }

  const { success, remaining, reset, limit } = await limiters[tier].limit(userId);
  return {
    ok: success,
    remaining,
    reset,
    limit,
    retryAfterSec: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}

let warned = false;

/**
 * Convenience helper for route handlers — returns the response to send on
 * rate-limit rejection, or `null` if the request can proceed.
 *
 * Usage:
 *   const blocked = await rateLimitOrNull(userId, 'light');
 *   if (blocked) return blocked;
 */
export async function rateLimitOrNull(userId: string, tier: Tier) {
  const rl = await rateLimitCoach(userId, tier);
  if (rl.ok) return null;

  const { NextResponse } = await import('next/server');
  return NextResponse.json(
    {
      error: 'Too many requests. Try again soon.',
      retry_after: rl.retryAfterSec,
      limit: rl.limit,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(rl.retryAfterSec),
        'X-RateLimit-Limit': String(rl.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(rl.reset / 1000)),
      },
    },
  );
}
