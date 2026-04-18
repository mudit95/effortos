import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { sendEmail } from '@/lib/email';
import { adminCustomEmail } from '@/lib/email-templates';
import { getAdminSupabase, logEmail, listAllAuthUsers } from '@/lib/cron-helpers';

/**
 * POST /api/admin/email
 * Send a custom email to one or more users.
 *
 * Body:
 *  - target: 'all' | 'trialing' | 'active' | 'expired' | 'individual'
 *  - emails: string[]       (required when target='individual')
 *  - subject: string
 *  - body: string           (plain text with \n\n for paragraphs)
 *  - ctaText?: string
 *  - ctaUrl?: string
 */
export async function POST(req: Request) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { target, emails: individualEmails, subject, body, ctaText, ctaUrl } = await req.json();
  if (!subject || !body || !target) {
    return NextResponse.json({ error: 'subject, body, and target required' }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  let recipientEmails: string[] = [];
  const userIdMap = new Map<string, string>(); // email → user_id

  if (target === 'individual') {
    if (!individualEmails || !Array.isArray(individualEmails) || individualEmails.length === 0) {
      return NextResponse.json({ error: 'emails required for individual target' }, { status: 400 });
    }
    recipientEmails = individualEmails;
  } else {
    // Get users by subscription status
    let statusFilter: string[];
    if (target === 'all') {
      statusFilter = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];
    } else if (target === 'trialing') {
      statusFilter = ['trialing'];
    } else if (target === 'active') {
      statusFilter = ['active'];
    } else if (target === 'expired') {
      statusFilter = ['expired', 'cancelled', 'past_due'];
    } else {
      return NextResponse.json({ error: `Unknown target: ${target}` }, { status: 400 });
    }

    // Get subscriptions matching status
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('user_id')
      .in('status', statusFilter);

    const userIds = subs?.map(s => s.user_id) || [];

    if (userIds.length === 0) {
      return NextResponse.json({ sent: 0, reason: 'no users match target' });
    }

    // Check email preferences — only send if admin_emails=true
    const { data: prefs } = await supabase
      .from('email_preferences')
      .select('user_id')
      .in('user_id', userIds)
      .eq('admin_emails', true)
      .eq('unsubscribed_all', false);

    const eligibleIds = new Set(prefs?.map(p => p.user_id) || []);

    // If no prefs exist for a user, they're still eligible (default is true)
    const finalIds = userIds.filter(id => eligibleIds.has(id) || !prefs?.find(p => p.user_id === id));

    // Get emails from auth. Use the paged helper — single-page listUsers
    // silently dropped everyone past user #1000 from admin broadcasts.
    const authUsers = await listAllAuthUsers(supabase);
    const authUserMap = new Map(authUsers.map(u => [u.id, u]));
    for (const uid of finalIds) {
      const authUser = authUserMap.get(uid);
      if (authUser?.email) {
        recipientEmails.push(authUser.email);
        userIdMap.set(authUser.email, uid);
      }
    }
  }

  if (recipientEmails.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no eligible recipients' });
  }

  // Generate HTML
  const html = adminCustomEmail({ subject, body, ctaText, ctaUrl });

  let sent = 0;
  const errors: string[] = [];

  for (const email of recipientEmails) {
    try {
      const result = await sendEmail({
        to: email,
        subject,
        html,
        tags: [{ name: 'type', value: 'admin_custom' }],
      });

      const userId = userIdMap.get(email);
      if (userId) {
        await logEmail({
          userId,
          emailTo: email,
          emailType: 'admin_custom',
          subject,
          resendId: result?.id,
          metadata: { admin_id: check.user.id, target },
        });
      }
      sent++;
    } catch (err) {
      errors.push(`${email}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  return NextResponse.json({ sent, total: recipientEmails.length, errors: errors.length > 0 ? errors : undefined });
}

/**
 * GET /api/admin/email — fetch email log
 */
export async function GET() {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.reason === 'unauthenticated' ? 401 : 403 });

  const { supabase } = check;
  const { data } = await supabase
    .from('email_log')
    .select('id, email_to, email_type, subject, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  return NextResponse.json(data || []);
}
