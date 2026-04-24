import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/pacts/end
 * Ends an active pact by setting status to 'ended' and ended_at to now.
 * Body: { pact_id: string }
 *
 * Only the creator or the partner can end a pact.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { pact_id } = body;

    if (!pact_id || typeof pact_id !== 'string') {
      return NextResponse.json({ error: 'pact_id is required' }, { status: 400 });
    }

    // Fetch the pact and verify the user is a participant
    const { data: pact, error: lookupError } = await supabase
      .from('pacts')
      .select('*')
      .eq('id', pact_id)
      .single();

    if (lookupError || !pact) {
      return NextResponse.json({ error: 'Pact not found' }, { status: 404 });
    }

    if (pact.user_id !== user.id && pact.partner_user_id !== user.id) {
      return NextResponse.json({ error: 'You are not a participant in this pact' }, { status: 403 });
    }

    if (pact.status === 'ended') {
      return NextResponse.json({ error: 'Pact is already ended' }, { status: 409 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('pacts')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
      })
      .eq('id', pact_id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('Pact end error:', updateError);
      return NextResponse.json({ error: 'Failed to end pact' }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('Pact end POST error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
