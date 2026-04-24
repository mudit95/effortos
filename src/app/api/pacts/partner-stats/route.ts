import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/pacts/partner-stats?pact_id=<uuid>
 * Returns the partner's stats (name, active_days_7d, sessions_7d) for a given pact.
 * The "partner" is whichever participant is NOT the current user.
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const pactId = searchParams.get('pact_id');

    if (!pactId) {
      return NextResponse.json({ error: 'pact_id query parameter is required' }, { status: 400 });
    }

    // Fetch the pact
    const { data: pact, error: pactError } = await supabase
      .from('pacts')
      .select('*')
      .eq('id', pactId)
      .single();

    if (pactError || !pact) {
      return NextResponse.json({ error: 'Pact not found' }, { status: 404 });
    }

    // Verify the user is a participant
    if (pact.user_id !== user.id && pact.partner_user_id !== user.id) {
      return NextResponse.json({ error: 'You are not a participant in this pact' }, { status: 403 });
    }

    // Determine the partner's user_id
    const partnerId = pact.user_id === user.id ? pact.partner_user_id : pact.user_id;

    if (!partnerId) {
      return NextResponse.json({ error: 'Partner has not joined yet' }, { status: 404 });
    }

    // Fetch partner stats from the view
    const { data: stats, error: statsError } = await supabase
      .from('pact_user_stats')
      .select('user_id, name, active_days_7d, sessions_7d')
      .eq('user_id', partnerId)
      .single();

    if (statsError || !stats) {
      console.error('Partner stats fetch error:', statsError);
      return NextResponse.json({ error: 'Partner stats not available' }, { status: 404 });
    }

    return NextResponse.json({
      pact_id: pactId,
      partner: {
        user_id: stats.user_id,
        name: stats.name,
        active_days_7d: stats.active_days_7d,
        sessions_7d: stats.sessions_7d,
      },
    });
  } catch (err) {
    console.error('Partner stats GET error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
