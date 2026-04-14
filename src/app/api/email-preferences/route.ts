import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/email-preferences — fetch current user's email prefs
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('email_preferences')
    .select('morning_email, afternoon_email, nightly_email, admin_emails, unsubscribed_all, timezone')
    .eq('user_id', user.id)
    .maybeSingle();

  // Return defaults if no row exists
  return NextResponse.json(data || {
    morning_email: true,
    afternoon_email: true,
    nightly_email: true,
    admin_emails: true,
    unsubscribed_all: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  });
}

/**
 * PUT /api/email-preferences — update current user's email prefs
 */
export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const updates = await req.json();
  const allowed = ['morning_email', 'afternoon_email', 'nightly_email', 'admin_emails', 'unsubscribed_all', 'timezone'];
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );

  // Upsert
  const { error } = await supabase
    .from('email_preferences')
    .upsert({ user_id: user.id, ...filtered }, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
