/**
 * Rate limiting primitives — per-user buckets for authenticated AI coach
 * endpoints, plus per-IP buckets for unauthenticated public endpoints
 * (health probe, webhooks) to stop scraping-amplification attacks.
 *
 * Uses Upstash Redis via their REST client — pay-per-call, fits Vercel's
 * edge/serverless model with zero cold-start overhead. A single Redis
 * instance backs both limiter families (see getRedis()).
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
type IpTier = 'health';

/** Limits, tuned to cap Anthropic spend per user without being user-hostile. */
const LIMITS: Record<Tier, { tokens: number; window: `${number} ${'s' | 'm' | 'h' | 'd'}` }> = {
  // Cheap, short-prompt endpoints called frequently on the dashboard.
  light: { tokens: 20, window: '1 h' },
  // Longer-context endpoints that should only fire a handful of times a day.
  heavy: { tokens: 5, window: '1 d' },
};

/**
 * IP-based limits for unauthenticated public endpoints (probes, webhooks).
 * A well-behaved uptime monitor pings every 30–60s → 60/min is ~60× headroom;
 * a misbehaving scraper hammering us gets 429'd quickly.
 */
const IP_LIMITS: Record<IpTier, { tokens: number; window: `${number} ${'s' | 'm' | 'h' | 'd'}` }> = {
  health: { tokens: 60, window: '1 m' },
};

let _cache: { light: Ratelimit; heavy: Ratelimit } | null = null;
let _ipCache: { health: Ratelimit } | null = null;
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

function getLimiters(): { light: Ratelimit; heavy: Ratelimit } | null {
  if (_cache) return _cache;

  const redis = getRedis();
  if (!redis) return null;

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

function getIpLimiters(): { health: Ratelimit } | null {
  if (_ipCache) return _ipCache;

  const redis = getRedis();
  if (!redis) return null;

  _ipCache = {
    health: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(IP_LIMITS.health.tokens, IP_LIMITS.health.window),
      analytics: true,
      prefix: 'rl:ip:health',
    }),
  };

  return _ipCache;
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

/**
 * Best-effort client IP extraction for rate-limit bucket keys.
 *
 * Trust order is deliberate: Vercel/Cloudflare hop headers first (they're
 * set by our edge and can be trusted), then x-forwarded-for's LEFT-MOST
 * entry (the original client, though spoofable if upstream proxies don't
 * sanitise). Returns 'unknown' as a stable fallback bucket — that bucket
 * can get noisy but it's better than failing open entirely.
 */
export function getClientIp(req: Request): string {
  const h = req.headers;
  const vercel = h.get('x-vercel-forwarded-for');
  if (vercel) return vercel.split(',')[0].trim();
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = h.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

/**
 * Consume one token from the IP bucket for this (ip, tier). Fails open when
 * Upstash isn't configured — public endpoints must stay reachable in local
 * dev and during rollout before env vars are wired.
 */
export async function rateLimitByIp(ip: string, tier: IpTier): Promise<RateLimitResult> {
  const limiters = getIpLimiters();
  if (!limiters) {
    if (!ipWarned) {
      console.warn(
        '[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — skipping IP rate limiting.',
      );
      ipWarned = true;
    }
    return { ok: true, remaining: -1, reset: 0, limit: 0, retryAfterSec: 0 };
  }

  const { success, remaining, reset, limit } = await limiters[tier].limit(ip);
  return {
    ok: success,
    remaining,
    reset,
    limit,
    retryAfterSec: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
  };
}

let ipWarned = false;

/**
 * Convenience helper mirroring rateLimitOrNull but keyed on request IP.
 * Returns the 429 response to send, or null if the request can proceed.
 */
export async function rateLimitByIpOrNull(req: Request, tier: IpTier) {
  const ip = getClientIp(req);
  const rl = await rateLimitByIp(ip, tier);
  if (rl.ok) return null;

  const { NextResponse } = await import('next/server');
  return NextResponse.json(
    {
      error: 'Too many requests.',
      retry_after: rl.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(rl.retryAfterSec),
        'X-RateLimit-Limit': String(rl.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.floor(rl.reset / 1000)),
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
