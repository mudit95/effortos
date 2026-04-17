import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/health
 *
 * Lightweight liveness + readiness probe for external uptime monitors
 * (Better Stack, UptimeRobot, Vercel's built-in ping, etc.).
 *
 * Returns 200 when the web tier can reach Supabase and basic env is present.
 * Returns 503 with a `degraded` flag if Supabase is unreachable — uptime
 * monitors should treat 503 as DOWN so we're paged on real infra issues.
 *
 * Intentionally does NOT require auth. Response body is intentionally small.
 */

// 5s max for the Supabase ping so a slow DB doesn't exceed Vercel's function
// budget. Uptime monitors will time out at ~10s and mark us down anyway.
export const maxDuration = 10;

export async function GET() {
  const startedAt = Date.now();
  const checks = {
    env: {
      supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabase_anon_key: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      supabase_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      razorpay: !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET,
      resend: !!process.env.RESEND_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      cron_secret: !!process.env.CRON_SECRET,
    },
    supabase_reachable: false as boolean,
  };

  // Minimum env we MUST have to serve requests at all.
  const envOk =
    checks.env.supabase_url && checks.env.supabase_anon_key && checks.env.supabase_service_key;

  // Cheap HEAD-style read against a known table to confirm DB connectivity.
  // `profiles` exists in every environment.
  if (envOk) {
    try {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .limit(1);
      checks.supabase_reachable = !error;
    } catch {
      checks.supabase_reachable = false;
    }
  }

  const healthy = envOk && checks.supabase_reachable;
  const body = {
    status: healthy ? 'ok' : 'degraded',
    checks,
    response_ms: Date.now() - startedAt,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    deployed_at: process.env.VERCEL_GIT_COMMIT_AUTHOR_DATE ?? null,
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
