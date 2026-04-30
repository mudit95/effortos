import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/sessions/complete
 * Atomically completes a pomodoro session:
 * 1. Updates the session record (status=completed, end_time, duration)
 * 2. Increments the goal's sessions_completed
 * 3. Checks and completes milestones
 * 4. Optionally increments daily task pomodoro count
 *
 * IDEMPOTENCY:
 *   The offline queue replays failed completions on reconnect, and the
 *   client may also re-issue the request after a transient timeout. The
 *   earlier version blindly performed the update + increments every time,
 *   so a single completion could be counted twice (or more). We now do a
 *   conditional update — `status='completed' WHERE status != 'completed'`
 *   — and only run the goal/task increments when a row was actually
 *   transitioned. A replay of an already-completed session returns 200
 *   with `{ alreadyCompleted: true }` and is a no-op.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, duration, notes, dailyTaskId, goalId } = body;

    if (!sessionId || !duration) {
      return NextResponse.json({ error: 'sessionId and duration are required' }, { status: 400 });
    }

    // 1. Conditional complete: only flip status if it wasn't already completed.
    //
    // Postgres-via-PostgREST returns the affected rows in `data`. When the
    // .neq('status','completed') filter rules everyone out (the row is
    // already completed), `data` is an empty array — that's our signal to
    // bail out and skip the increments below.
    const { data: transitionedRows, error: sessionError } = await supabase
      .from('sessions')
      .update({
        status: 'completed',
        end_time: new Date().toISOString(),
        duration,
        notes: notes || null,
      })
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .neq('status', 'completed')
      .select();

    if (sessionError) {
      return NextResponse.json({ error: 'Failed to complete session' }, { status: 500 });
    }

    if (!transitionedRows || transitionedRows.length === 0) {
      // Either the session doesn't exist for this user, or it was already
      // completed by an earlier request. Treat both as a no-op success so
      // the offline queue can drop the item without retry.
      return NextResponse.json({ success: true, alreadyCompleted: true });
    }
    const session = transitionedRows[0];

    // 2. Increment goal sessions_completed (if goal-based session)
    //
    // Every goals/milestones/daily_tasks query below also carries an
    // explicit `user_id = user.id` filter. RLS already guarantees rows
    // are scoped to the caller, but we layer the filter in code too as
    // defence-in-depth: if RLS were ever disabled by mistake, these
    // endpoints still refuse to mutate another user's data.
    if (goalId && goalId !== '__daily__') {
      const { data: goal } = await supabase
        .from('goals')
        .select('sessions_completed, estimated_sessions_current, milestones(*)')
        .eq('id', goalId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (goal) {
        const newCount = (goal.sessions_completed as number) + 1;
        await supabase
          .from('goals')
          .update({ sessions_completed: newCount })
          .eq('id', goalId)
          .eq('user_id', user.id);

        // 3. Check milestones
        const milestones = goal.milestones as Array<{
          id: string; session_target: number; completed: boolean;
        }> || [];

        for (const milestone of milestones) {
          if (!milestone.completed && newCount >= milestone.session_target) {
            // milestones has no user_id column — it scopes via goal_id.
            // These milestone IDs came from the user-scoped goal query
            // above, so they are safe to update by id alone (and RLS
            // enforces goal ownership as well).
            await supabase
              .from('milestones')
              .update({ completed: true, completed_at: new Date().toISOString() })
              .eq('id', milestone.id);
          }
        }

        // Check if goal is now complete
        if (newCount >= (goal.estimated_sessions_current as number)) {
          await supabase
            .from('goals')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('id', goalId)
            .eq('user_id', user.id);
        }
      }
    }

    // 4. Increment daily task pomodoro count
    if (dailyTaskId) {
      const { data: task } = await supabase
        .from('daily_tasks')
        // include completed_at so we can preserve the original timestamp
        // when we're not transitioning incomplete→complete.
        .select('pomodoros_done, pomodoros_target, completed, completed_at')
        .eq('id', dailyTaskId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (task) {
        const newDone = (task.pomodoros_done as number) + 1;
        const wasCompleted = task.completed as boolean;
        const autoComplete = newDone >= (task.pomodoros_target as number);

        // Only set completed_at when transitioning incomplete→complete.
        // The previous code wrote `completed_at: null` for the no-op
        // branch, which silently wiped the original completion timestamp
        // on every replay (corrupting streak / report data).
        const update: Record<string, unknown> = {
          pomodoros_done: newDone,
          completed: autoComplete ? true : wasCompleted,
        };
        if (autoComplete && !wasCompleted) {
          update.completed_at = new Date().toISOString();
        }

        await supabase
          .from('daily_tasks')
          .update(update)
          .eq('id', dailyTaskId)
          .eq('user_id', user.id);
      }
    }

    // 5. Clear timer state
    await supabase
      .from('timer_state')
      .delete()
      .eq('user_id', user.id);

    return NextResponse.json({ success: true, session });
  } catch (err) {
    console.error('Session complete error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
