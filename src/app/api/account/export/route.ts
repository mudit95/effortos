import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/account/export
 *
 * Returns a JSON archive of every row the signed-in user owns across EffortOS.
 * Satisfies the data-portability requirement under GDPR Art. 20 and DPDP Act
 * (right of users to receive a machine-readable copy of their personal data).
 *
 * The response is served with Content-Disposition: attachment so the browser
 * saves it as a file rather than rendering JSON inline.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Every table that stores user-owned data. Keep in sync with the deletion
    // endpoint so export and delete cover the same surface area.
    const [
      profile,
      subscription,
      goals,
      sessions,
      dailyTasks,
      repeatingTemplates,
      feedbackEntries,
      emailPreferences,
      emailLog,
      timerState,
      couponRedemptions,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('goals').select('*').eq('user_id', user.id),
      supabase.from('sessions').select('*').eq('user_id', user.id),
      supabase.from('daily_tasks').select('*').eq('user_id', user.id),
      supabase.from('repeating_templates').select('*').eq('user_id', user.id),
      supabase.from('feedback_entries').select('*').eq('user_id', user.id),
      supabase.from('email_preferences').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('email_log').select('*').eq('user_id', user.id),
      supabase.from('timer_state').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('coupon_redemptions').select('*').eq('user_id', user.id),
    ]);

    // Milestones are joined via goal_id, not user_id — pull them with the goal set
    const goalIds = (goals.data ?? []).map(g => g.id);
    const { data: milestones } = goalIds.length
      ? await supabase.from('milestones').select('*').in('goal_id', goalIds)
      : { data: [] as Record<string, unknown>[] };

    const archive = {
      export_generated_at: new Date().toISOString(),
      export_format_version: 1,
      account: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
      profile: profile.data ?? null,
      subscription: subscription.data ?? null,
      email_preferences: emailPreferences.data ?? null,
      timer_state: timerState.data ?? null,
      goals: goals.data ?? [],
      milestones: milestones ?? [],
      feedback_entries: feedbackEntries.data ?? [],
      sessions: sessions.data ?? [],
      daily_tasks: dailyTasks.data ?? [],
      repeating_templates: repeatingTemplates.data ?? [],
      email_log: emailLog.data ?? [],
      coupon_redemptions: couponRedemptions.data ?? [],
    };

    const filename = `effortos-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(archive, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('Account export error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
