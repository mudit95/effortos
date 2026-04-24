import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/pacts/accept
 * Accepts a pact invitation by invite_code.
 * Body: { invite_code: string }
 *
 * Sets partner_user_id to the current user, status to 'active', and accepted_at to now.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { invite_code } = body;

    if (!invite_code || typeof invite_code !== 'string') {
      return NextResponse.json({ error: 'invite_code is required' }, { status: 400 });
    }

    // Look up the pact by invite_code
    const { data: pact, error: lookupError } = await supabase
      .from('pacts')
      .select('*')
      .eq('invite_code', invite_code.trim())
      .single();

    if (lookupError || !pact) {
      return NextResponse.json({ error: 'Pact not found' }, { status: 404 });
    }

    if (pact.status !== 'pending') {
      return NextResponse.json(
        { error: `Pact is no longer pending (current status: ${pact.status})` },
        { status: 409 },
      );
    }

    if (pact.user_id === user.id) {
      return NextResponse.json({ error: 'You cannot accept your own pact' }, { status: 400 });
    }

    // Accept the pact
    const { data: updated, error: updateError } = await supabase
      .from('pacts')
      .update({
        partner_user_id: user.id,
        status: 'active',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', pact.id)
      .eq('status', 'pending') // guard against race conditions
      .select()
      .single();

    if (updateError || !updated) {
      console.error('Pact accept error:', updateError);
      return NextResponse.json({ error: 'Failed to accept pact' }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('Pact accept POST error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
