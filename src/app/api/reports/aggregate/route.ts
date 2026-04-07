import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/reports/aggregate
 * Aggregates pomodoro data for daily, weekly, or monthly reports.
 * Returns: pomodoros, focusMinutes, tasksDone, avgPerDay, byTag, byDay, bestDay
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { period, date } = body; // period: 'daily' | 'weekly' | 'monthly', date: YYYY-MM-DD

    if (!period || !date) {
      return NextResponse.json({ error: 'period and date are required' }, { status: 400 });
    }

    // Calculate date range
    const targetDate = new Date(date + 'T00:00:00');
    let startDate: Date;
    let endDate: Date;
    let dayCount: number;

    switch (period) {
      case 'daily':
        startDate = targetDate;
        endDate = new Date(targetDate);
        endDate.setDate(endDate.getDate() + 1);
        dayCount = 1;
        break;
      case 'weekly':
        // Start from Monday of the week
        startDate = new Date(targetDate);
        const day = startDate.getDay();
        const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
        startDate.setDate(diff);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 7);
        dayCount = 7;
        break;
      case 'monthly':
        startDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
        endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 1);
        dayCount = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        break;
      default:
        return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Fetch daily tasks in range
    const { data: tasks } = await supabase
      .from('daily_tasks')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', startStr)
      .lt('date', endStr)
      .order('date');

    const allTasks = tasks || [];

    // Compute aggregates
    let totalPomodoros = 0;
    let totalTasksDone = 0;
    const byTag: Record<string, number> = {};
    const byDay: Record<string, number> = {};

    for (const task of allTasks) {
      const done = task.pomodoros_done as number;
      totalPomodoros += done;

      if (task.completed) totalTasksDone++;

      const tag = (task.tag as string) || 'untagged';
      byTag[tag] = (byTag[tag] || 0) + done;

      const taskDate = task.date as string;
      byDay[taskDate] = (byDay[taskDate] || 0) + done;
    }

    // Also count sessions from the sessions table (for long-term goals)
    const { data: sessions } = await supabase
      .from('sessions')
      .select('start_time, duration')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .gte('start_time', startDate.toISOString())
      .lt('start_time', endDate.toISOString());

    const goalSessions = sessions || [];
    let goalPomodoros = 0;
    let totalFocusSeconds = 0;

    for (const s of goalSessions) {
      goalPomodoros++;
      totalFocusSeconds += s.duration as number;
    }

    // Add daily task pomodoros to focus time (assume 25 min each)
    totalFocusSeconds += totalPomodoros * 25 * 60;
    const totalPomodorosAll = totalPomodoros + goalPomodoros;

    // Find best day
    let bestDay = { date: '', pomodoros: 0 };
    for (const [d, count] of Object.entries(byDay)) {
      if (count > bestDay.pomodoros) {
        bestDay = { date: d, pomodoros: count };
      }
    }

    // Tasks worked on (unique titles with pomodoro counts)
    const tasksSummary: { title: string; pomodoros: number; tag: string }[] = [];
    const taskMap = new Map<string, { pomodoros: number; tag: string }>();
    for (const task of allTasks) {
      const title = task.title as string;
      const existing = taskMap.get(title);
      if (existing) {
        existing.pomodoros += task.pomodoros_done as number;
      } else {
        taskMap.set(title, {
          pomodoros: task.pomodoros_done as number,
          tag: (task.tag as string) || 'untagged',
        });
      }
    }
    for (const [title, data] of taskMap) {
      if (data.pomodoros > 0) {
        tasksSummary.push({ title, ...data });
      }
    }
    tasksSummary.sort((a, b) => b.pomodoros - a.pomodoros);

    return NextResponse.json({
      period,
      startDate: startStr,
      endDate: endStr,
      pomodoros: totalPomodorosAll,
      focusMinutes: Math.round(totalFocusSeconds / 60),
      tasksDone: totalTasksDone,
      avgPerDay: dayCount > 0 ? Math.round((totalPomodorosAll / dayCount) * 10) / 10 : 0,
      byTag,
      byDay,
      bestDay: bestDay.date ? bestDay : null,
      tasks: tasksSummary,
    });
  } catch (err) {
    console.error('Report aggregate error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
