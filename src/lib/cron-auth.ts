import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * Vercel Cron jobs send an Authorization header with CRON_SECRET.
 * This helper verifies it, preventing external callers from triggering crons.
 *
 * Comparison is timing-safe — a naive `!==` leaks length and per-byte
 * timing, which over thousands of probes lets an attacker recover the
 * secret one character at a time. crypto.timingSafeEqual takes constant
 * time relative to the input length.
 */
export function verifyCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // In dev, allow all requests
    if (process.env.NODE_ENV === 'development') return null;
    console.error('[cron] CRON_SECRET not configured');
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;

  // timingSafeEqual throws if buffers differ in length, so we hash to a
  // fixed width first. Equal hashes ↔ equal inputs (modulo SHA-256
  // collisions, which we treat as impossible).
  let match = false;
  try {
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    match = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    match = false;
  }
  if (!match) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null; // OK
}
