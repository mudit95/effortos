/**
 * Signed unsubscribe tokens.
 *
 * Every transactional email contains an unsubscribe link. Without a
 * signature, anyone who knows another user's email could iterate through
 * `?email=victim@example.com` and silently unsubscribe them — denying
 * them critical billing/security mail.
 *
 * Token format (base64url-encoded):   `email|exp|hmac`
 *   - email  : the recipient address (lowercased, trimmed)
 *   - exp    : unix-seconds expiry (we use a long horizon — see below)
 *   - hmac   : HMAC-SHA256(`${email}|${exp}`, secret), hex-encoded
 *
 * HMAC verification is timing-safe. The expiry is intentionally long
 * (1 year) because email clients pre-fetch links during inbox sync and
 * users routinely click old "unsubscribe" links from months-ago mail.
 *
 * Secret resolution:
 *   1. process.env.UNSUBSCRIBE_SECRET (preferred — explicit)
 *   2. process.env.SUPABASE_SERVICE_ROLE_KEY (fallback — always present)
 * Either way, the secret is server-only; never bundled to clients.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function getSecret(): string {
  const explicit = process.env.UNSUBSCRIBE_SECRET;
  if (explicit && explicit.length >= 16) return explicit;

  // Fallback so the unsubscribe URL keeps working without an extra env var.
  // We derive from SUPABASE_SERVICE_ROLE_KEY because it's the most stable
  // server-only secret available across all envs (dev, preview, prod).
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fallback) return `unsub:${fallback}`;

  // Production MUST have one of the two secrets above. Without them, an
  // attacker who knows another user's email could iterate the unsubscribe
  // endpoint and silently suppress them — see lib/unsubscribe-token.ts
  // top-of-file comment.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Cannot sign unsubscribe token: set UNSUBSCRIBE_SECRET or SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  // Test / dev fallback. The token will be valid syntactically but won't
  // verify cleanly across environments — and that's fine, because nothing
  // in dev/CI actually clicks the link. Production deploys use a real
  // secret and never hit this branch.
  return 'dev-only-do-not-use-in-prod-asdfqwertyuiopzxcvbnm';
}

function base64UrlEncode(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer {
  // Restore padding so Buffer.from accepts it.
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Produce a signed unsubscribe token for the given email. */
export function signUnsubscribeToken(
  email: string,
  ttlSeconds: number = ONE_YEAR_SECONDS,
): string {
  const normalized = email.trim().toLowerCase();
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${normalized}|${exp}`;
  const hmac = createHmac('sha256', getSecret()).update(payload).digest('hex');
  return base64UrlEncode(`${payload}|${hmac}`);
}

export interface UnsubVerifyResult {
  ok: true;
  email: string;
}
export interface UnsubVerifyError {
  ok: false;
  reason: 'malformed' | 'expired' | 'bad_signature';
}

/** Verify and decode an unsubscribe token. Returns the email on success. */
export function verifyUnsubscribeToken(
  token: string,
): UnsubVerifyResult | UnsubVerifyError {
  let raw: string;
  try {
    raw = base64UrlDecode(token).toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  // Split from the right so emails containing `|` don't break parsing.
  const lastBar = raw.lastIndexOf('|');
  if (lastBar < 0) return { ok: false, reason: 'malformed' };
  const payload = raw.slice(0, lastBar);
  const providedHmac = raw.slice(lastBar + 1);

  const secondLastBar = payload.lastIndexOf('|');
  if (secondLastBar < 0) return { ok: false, reason: 'malformed' };
  const email = payload.slice(0, secondLastBar);
  const expStr = payload.slice(secondLastBar + 1);
  const exp = Number(expStr);
  if (!email || !Number.isFinite(exp)) return { ok: false, reason: 'malformed' };

  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' };

  const expectedHmac = createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex');

  // Timing-safe compare. Buffers must be the same length or timingSafeEqual
  // throws — guard with a length check.
  let match = false;
  try {
    const a = Buffer.from(providedHmac, 'hex');
    const b = Buffer.from(expectedHmac, 'hex');
    match = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    match = false;
  }
  if (!match) return { ok: false, reason: 'bad_signature' };

  return { ok: true, email };
}
