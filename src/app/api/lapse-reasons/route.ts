import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * POST /api/lapse-reasons
 *
 * Body: { reason: 'work'|'health'|'motivation'|'life_event'|'other', days_dormant: number, note?: string }
 *
 * Records a single lapse-reason row for the calling user. Authenticated;
 * RLS handles the user-id binding via auth.uid(). Rate-limited (light
 * bucket) — there's no legitimate reason a single user submits the
 * survey more than a handful of times a day.
 *
 * Response: 200 { ok: true } on success, 4xx on bad input.
 */

const ALLOWED_REASONS = ['work', 'health', 'motivation', 'life_event', 'other'] as const;
type Reason = typeof ALLOWED_REASONS[number];

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const blocked = await rateLimitOrNull(user.id, 'light');
  if (blocked) return blocked;

  let body: { reason?: string; days_dormant?: number; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const reason = body.reason;
  if (!reason || !ALLOWED_REASONS.includes(reason as Reason)) {
    return NextResponse.json({ error: 'Invalid reason' }, { status: 400 });
  }
  const daysDormant = Number(body.days_dormant);
  if (!Number.isFinite(daysDormant) || daysDormant < 0) {
    return NextResponse.json({ error: 'days_dormant must be a non-negative number' }, { status: 400 });
  }
  // Cap the note at 200 chars to prevent storage bloat and to keep the
  // survey UX bounded — anything longer is journal material, not a
  // single-question survey.
  const note = typeof body.note === 'string' ? body.note.slice(0, 200) : null;

  const { error } = await supabase
    .from('lapse_reasons')
    .insert({
      user_id: user.id,
      reason,
      days_dormant: Math.floor(daysDormant),
      note: note || null,
    });

  if (error) {
    console.error('[lapse-reasons] insert failed:', error);
    return NextResponse.json({ error: 'Failed to record' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
