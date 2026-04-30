import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimitOrNull } from '@/lib/ratelimit';

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

    // Rate-limit: data export is heavy (11 table scans) and used as a
    // privacy/compliance feature, not a polling endpoint. The 'heavy' bucket
    // (5/day) is plenty for legitimate use and stops a malicious script from
    // turning this into a DOS amplifier.
    const blocked = await rateLimitOrNull(user.id, 'heavy');
    if (blocked) return blocked;

    // Every table that stores user-owned data. Keep in sync with the deletion
    // endpoint so export and delete cover the same surface area.
    //
    // The earlier export omitted journal_entries, shadow_goals, coach_log,
    // pacts, and other_todos — incomplete under GDPR Art. 20 / DPDP right
    // to portability. All five are included now.
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
      journalEntries,
      shadowGoals,
      coachLog,
      pactsAsOwner,
      pactsAsPartner,
      otherTodos,
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
      supabase.from('journal_entries').select('*').eq('user_id', user.id),
      supabase.from('shadow_goals').select('*').eq('user_id', user.id),
      supabase.from('coach_log').select('*').eq('user_id', user.id),
      // Pacts have two foreign keys (user_id and partner_user_id). The user is
      // entitled to a copy of any row they participate in, on either side.
      supabase.from('pacts').select('*').eq('user_id', user.id),
      supabase.from('pacts').select('*').eq('partner_user_id', user.id),
      supabase.from('other_todos').select('*').eq('user_id', user.id),
    ]);

    // Milestones are joined via goal_id, not user_id — pull them with the goal set
    const goalIds = (goals.data ?? []).map(g => g.id);
    const { data: milestones } = goalIds.length
      ? await supabase.from('milestones').select('*').in('goal_id', goalIds)
      : { data: [] as Record<string, unknown>[] };

    // Merge pacts from both directions, dedup by id (a self-pact would
    // otherwise appear twice).
    const allPacts = [...(pactsAsOwner.data ?? []), ...(pactsAsPartner.data ?? [])];
    const seenPactIds = new Set<string>();
    const pacts = allPacts.filter(p => {
      const id = p.id as string;
      if (seenPactIds.has(id)) return false;
      seenPactIds.add(id);
      return true;
    });

    const archive = {
      export_generated_at: new Date().toISOString(),
      export_format_version: 2,
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
      journal_entries: journalEntries.data ?? [],
      shadow_goals: shadowGoals.data ?? [],
      coach_log: coachLog.data ?? [],
      pacts,
      other_todos: otherTodos.data ?? [],
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
