import { NextResponse } from 'next/server';

/**
 * Vercel Cron jobs send an Authorization header with CRON_SECRET.
 * This helper verifies it, preventing external callers from triggering crons.
 */
export function verifyCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // In dev, allow all requests
    if (process.env.NODE_ENV === 'development') return null;
    console.error('[cron] CRON_SECRET not configured');
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null; // OK
}
