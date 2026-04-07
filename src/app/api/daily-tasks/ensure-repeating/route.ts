import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/daily-tasks/ensure-repeating
 * Creates daily tasks from repeating templates for a given date.
 * Idempotent — won't create duplicates if tasks already exist.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { date } = body;

    if (!date) {
      return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 });
    }

    // Get active repeating templates
    const { data: templates } = await supabase
      .from('repeating_templates')
      .select('*')
      .eq('user_id', user.id)
      .eq('active', true);

    if (!templates || templates.length === 0) {
      const { data: existing } = await supabase
        .from('daily_tasks')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', date)
        .order('sort_order');

      return NextResponse.json({ tasks: existing || [] });
    }

    // Get existing tasks for this date
    const { data: existingTasks } = await supabase
      .from('daily_tasks')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', date)
      .order('sort_order');

    const existing = existingTasks || [];
    const existingTitles = new Set(
      existing.map((t: Record<string, unknown>) => (t.title as string).toLowerCase())
    );

    // Create missing tasks
    const newTasks = [];
    for (const template of templates) {
      const title = template.title as string;
      if (!existingTitles.has(title.toLowerCase())) {
        newTasks.push({
          user_id: user.id,
          title,
          pomodoros_target: template.pomodoros_target,
          repeating: true,
          tag: template.tag,
          date,
          sort_order: existing.length + newTasks.length,
        });
      }
    }

    if (newTasks.length > 0) {
      await supabase.from('daily_tasks').insert(newTasks);
    }

    // Return all tasks for this date
    const { data: allTasks } = await supabase
      .from('daily_tasks')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', date)
      .order('sort_order');

    return NextResponse.json({ tasks: allTasks || [] });
  } catch (err) {
    console.error('Ensure repeating error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
