import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/coach/preferences
 * Returns the current user's coaching preferences.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('coaching_intensity, coaching_quiet_start, coaching_quiet_end, coaching_paused_until, beast_mode_enabled')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({
        coaching_intensity: 'balanced',
        coaching_quiet_start: 22,
        coaching_quiet_end: 7,
        coaching_paused_until: null,
        beast_mode_enabled: false,
      });
    }

    return NextResponse.json(profile);
  } catch (err) {
    console.error('Coach preferences GET error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/coach/preferences
 * Updates coaching preferences.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const update: Record<string, unknown> = {};

    if (body.coaching_intensity && ['light', 'balanced', 'intense'].includes(body.coaching_intensity)) {
      update.coaching_intensity = body.coaching_intensity;
    }
    if (typeof body.coaching_quiet_start === 'number' && body.coaching_quiet_start >= 0 && body.coaching_quiet_start <= 23) {
      update.coaching_quiet_start = body.coaching_quiet_start;
    }
    if (typeof body.coaching_quiet_end === 'number' && body.coaching_quiet_end >= 0 && body.coaching_quiet_end <= 23) {
      update.coaching_quiet_end = body.coaching_quiet_end;
    }

    // Beast Mode is Pro-gated on the server side because the cron uses
    // this column directly. We don't trust the client; we re-check the
    // user's subscription state here before persisting `true`. (`false`
    // is always allowed — letting a non-Pro user turn it OFF is fine.)
    if (typeof body.beast_mode_enabled === 'boolean') {
      if (body.beast_mode_enabled === false) {
        update.beast_mode_enabled = false;
      } else {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('plan_tier, status')
          .eq('user_id', user.id)
          .eq('plan_tier', 'pro')
          .in('status', ['trialing', 'active'])
          .maybeSingle();
        if (!sub) {
          return NextResponse.json(
            { error: 'Beast Mode requires Pro' },
            { status: 403 },
          );
        }
        update.beast_mode_enabled = true;
        update.beast_mode_enabled_at = new Date().toISOString();
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', user.id);

    if (error) {
      console.error('Coach preferences update error:', error);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Coach preferences POST error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
