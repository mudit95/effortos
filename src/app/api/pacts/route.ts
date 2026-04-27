import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';
import { sendEmail, APP_URL } from '@/lib/email';
import { rateLimitOrNull } from '@/lib/ratelimit';

/**
 * GET /api/pacts
 * Lists all pacts for the current user (both as creator and as partner),
 * joined with pact_user_stats for partner info.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch pacts where the user is either the creator or the accepted partner
    const { data: pacts, error } = await supabase
      .from('pacts')
      .select('*')
      .or(`user_id.eq.${user.id},partner_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Pacts list error:', error);
      return NextResponse.json({ error: 'Failed to fetch pacts' }, { status: 500 });
    }

    // For each pact, determine the partner's user_id and fetch their stats
    const partnerIds = pacts
      .map((p) => (p.user_id === user.id ? p.partner_user_id : p.user_id))
      .filter(Boolean) as string[];

    let statsMap: Record<string, { name: string; active_days_7d: number; sessions_7d: number }> = {};

    if (partnerIds.length > 0) {
      const { data: stats, error: statsError } = await supabase
        .from('pact_user_stats')
        .select('user_id, name, active_days_7d, sessions_7d')
        .in('user_id', partnerIds);

      if (statsError) {
        console.error('Partner stats fetch error:', statsError);
      } else if (stats) {
        statsMap = Object.fromEntries(stats.map((s) => [s.user_id, s]));
      }
    }

    const pactsWithStats = pacts.map((pact) => {
      const partnerId = pact.user_id === user.id ? pact.partner_user_id : pact.user_id;
      const partnerStats = partnerId ? statsMap[partnerId] ?? null : null;
      return {
        ...pact,
        partner: partnerStats
          ? {
              user_id: partnerId,
              name: partnerStats.name,
              active_days_7d: partnerStats.active_days_7d,
              sessions_7d: partnerStats.sessions_7d,
            }
          : null,
      };
    });

    return NextResponse.json({ pacts: pactsWithStats });
  } catch (err) {
    console.error('Pacts GET error:', err);
    return NextResponse.json({ pacts: [], error: 'Internal error' }, { status: 200 });
  }
}

/**
 * POST /api/pacts
 * Creates a new pact invitation by partner_email.
 * Body: { partner_email: string }
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate-limit: each pact invite sends an email — without a cap a logged-in
    // user could turn this into a free outbound-email amplifier or harass an
    // address by repeatedly inviting it. Light bucket (20/hour) is plenty for
    // legitimate pact creation.
    const blocked = await rateLimitOrNull(user.id, 'light');
    if (blocked) return blocked;

    const body = await req.json();
    const { partner_email } = body;

    if (!partner_email || typeof partner_email !== 'string') {
      return NextResponse.json({ error: 'partner_email is required' }, { status: 400 });
    }

    const trimmedEmail = partner_email.trim().toLowerCase();

    if (trimmedEmail === user.email) {
      return NextResponse.json({ error: 'You cannot create a pact with yourself' }, { status: 400 });
    }

    // Check if the partner already has a profile (optional — they might not be signed up yet)
    const { data: partnerProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', trimmedEmail)
      .single();

    // Generate invite code on the app side (avoids dependency on pgcrypto extension)
    const inviteCode = crypto.randomBytes(12).toString('hex');

    const { data: pact, error } = await supabase
      .from('pacts')
      .insert({
        user_id: user.id,
        partner_email: trimmedEmail,
        partner_user_id: partnerProfile?.id ?? null,
        invite_code: inviteCode,
      })
      .select()
      .single();

    if (error) {
      console.error('Pact creation error:', JSON.stringify(error));
      if (error.code === '42P01') {
        return NextResponse.json({ error: 'Pacts feature not yet set up. Run migration 018 in your Supabase SQL editor.' }, { status: 500 });
      }
      return NextResponse.json({ error: error.message || 'Failed to create pact' }, { status: 500 });
    }

    // Send invite email to partner (fire-and-forget)
    const senderName = user.user_metadata?.name || user.email?.split('@')[0] || 'Someone';
    sendEmail({
      to: trimmedEmail,
      subject: `${senderName} invited you to an accountability pact on EffortOS`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px;">
          <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">${senderName} wants to stay accountable with you</h2>
          <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 24px;">
            They've invited you to an accountability pact on EffortOS. You'll see each other's streaks and weekly activity — nothing else. Just enough to keep each other on track.
          </p>
          <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; margin: 0 0 24px;">
            <p style="font-size: 12px; color: #888; margin: 0 0 4px;">Your invite code:</p>
            <p style="font-size: 18px; font-weight: 600; font-family: monospace; margin: 0; letter-spacing: 1px;">${inviteCode}</p>
          </div>
          <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 24px;">
            To accept: Open <a href="${APP_URL}" style="color: #0ea5e9;">EffortOS</a> → Settings → Accountability Pacts → paste the code above.
          </p>
          <p style="font-size: 12px; color: #999;">If you don't have an EffortOS account, <a href="${APP_URL}" style="color: #0ea5e9;">sign up free</a> first.</p>
        </div>
      `,
    }).catch(err => console.error('Pact invite email failed:', err));

    return NextResponse.json(pact, { status: 201 });
  } catch (err) {
    console.error('Pacts POST error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
