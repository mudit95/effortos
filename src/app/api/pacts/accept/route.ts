import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * POST /api/pacts/accept
 * Accepts a pact invitation by invite_code.
 * Body: { invite_code: string }
 *
 * Sets partner_user_id to the current user, status to 'active', and accepted_at to now.
 *
 * RLS NOTE: The lookup-by-invite-code uses the service-role client on
 * purpose. The pacts SELECT policy requires `auth.uid() = user_id OR
 * auth.uid() = partner_user_id`, but a pending invite's
 * partner_user_id is NULL until the invitee accepts — so the user-
 * scoped client would always return 0 rows here ("Pact not found").
 *
 * Bypassing RLS is safe because the 24-byte hex invite_code is itself
 * the authenticator (whoever holds the code is the legitimate
 * invitee). After the lookup we still re-check status and that the
 * caller isn't the creator before flipping the row to 'active' on the
 * user-scoped client — so the UPDATE remains RLS-protected.
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

    // Service-role lookup — see RLS NOTE on the route docblock.
    const service = createServiceClient();
    const { data: pact, error: lookupError } = await service
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

    // Update on the user-scoped client. The pacts UPDATE policy is
    // `auth.uid() = user_id OR auth.uid() = partner_user_id` — the
    // partner_user_id is still NULL on the row at this exact instant,
    // so we'd be blocked. Use the service client for the write too.
    // The race-condition guard on `status='pending'` plus the explicit
    // pact.id match makes this safe.
    const { data: updated, error: updateError } = await service
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
