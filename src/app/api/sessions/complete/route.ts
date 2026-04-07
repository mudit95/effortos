import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/sessions/complete
 * Atomically completes a pomodoro session:
 * 1. Updates the session record (status=completed, end_time, duration)
 * 2. Increments the goal's sessions_completed
 * 3. Checks and completes milestones
 * 4. Optionally increments daily task pomodoro count
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

    // 1. Complete the session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .update({
        status: 'completed',
        end_time: new Date().toISOString(),
        duration,
        notes: notes || null,
      })
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (sessionError) {
      return NextResponse.json({ error: 'Failed to complete session' }, { status: 500 });
    }

    // 2. Increment goal sessions_completed (if goal-based session)
    if (goalId && goalId !== '__daily__') {
      const { data: goal } = await supabase
        .from('goals')
        .select('sessions_completed, estimated_sessions_current, milestones(*)')
        .eq('id', goalId)
        .single();

      if (goal) {
        const newCount = (goal.sessions_completed as number) + 1;
        await supabase
          .from('goals')
          .update({ sessions_completed: newCount })
          .eq('id', goalId);

        // 3. Check milestones
        const milestones = goal.milestones as Array<{
          id: string; session_target: number; completed: boolean;
        }> || [];

        for (const milestone of milestones) {
          if (!milestone.completed && newCount >= milestone.session_target) {
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
            .eq('id', goalId);
        }
      }
    }

    // 4. Increment daily task pomodoro count
    if (dailyTaskId) {
      const { data: task } = await supabase
        .from('daily_tasks')
        .select('pomodoros_done, pomodoros_target, completed')
        .eq('id', dailyTaskId)
        .single();

      if (task) {
        const newDone = (task.pomodoros_done as number) + 1;
        const autoComplete = newDone >= (task.pomodoros_target as number);

        await supabase
          .from('daily_tasks')
          .update({
            pomodoros_done: newDone,
            completed: autoComplete ? true : task.completed,
            completed_at: autoComplete && !(task.completed as boolean) ? new Date().toISOString() : null,
          })
          .eq('id', dailyTaskId);
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
