import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { TaskSummary, GoalSummary, DaySummary } from './email-templates';

/**
 * Creates a Supabase admin client for cron jobs (no user auth).
 */
export function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, key);
}

/**
 * Get all users eligible for a specific email type at the current time.
 * Filters by email preference + timezone (checks which users are in the target hour).
 */
export async function getEligibleUsers(
  emailType: 'morning_email' | 'afternoon_email' | 'nightly_email',
  targetHour: number, // e.g., 8 for 8 AM
): Promise<{ user_id: string; email: string; name: string; timezone: string }[]> {
  const supabase = getAdminSupabase();

  // Get all users with this email enabled
  const { data: prefs } = await supabase
    .from('email_preferences')
    .select('user_id, timezone')
    .eq(emailType, true)
    .eq('unsubscribed_all', false);

  if (!prefs || prefs.length === 0) return [];

  // Filter by timezone — is it the right hour in their zone?
  const now = new Date();
  const eligible = prefs.filter(p => {
    try {
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: p.timezone }));
      return userTime.getHours() === targetHour;
    } catch {
      // Invalid timezone — default to Asia/Kolkata
      const userTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      return userTime.getHours() === targetHour;
    }
  });

  if (eligible.length === 0) return [];

  // Get user emails and names
  const userIds = eligible.map(e => e.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .in('user_id', userIds);

  const authUsers = await listAllAuthUsers(supabase);

  const profileMap = new Map(profiles?.map(p => [p.user_id, p.display_name]) || []);
  const tzMap = new Map(eligible.map(e => [e.user_id, e.timezone]));
  const authUserMap = new Map(authUsers.map(u => [u.id, u]));

  return userIds
    .map(uid => {
      const authUser = authUserMap.get(uid);
      if (!authUser?.email) return null;
      return {
        user_id: uid,
        email: authUser.email,
        name: profileMap.get(uid) || authUser.user_metadata?.name || 'there',
        timezone: tzMap.get(uid) || 'Asia/Kolkata',
      };
    })
    .filter((u): u is NonNullable<typeof u> => u !== null);
}

/**
 * Page through supabase.auth.admin.listUsers and return every user.
 *
 * The admin API caps `perPage` around 1000. The pre-pagination implementation
 * passed `perPage: 1000` with no page loop, silently dropping every user
 * past the first page from email sends. We now loop until we see a short
 * page (fewer rows than perPage), which is the documented terminator.
 *
 * We also O(1)-lookup by id via a Map in callers, rather than the prior
 * O(N) Array.find per user id — a cron servicing thousands of eligible
 * users is now linear in that count rather than quadratic.
 */
export async function listAllAuthUsers(
  supabase: ReturnType<typeof getAdminSupabase>,
): Promise<{ id: string; email?: string; user_metadata?: { name?: string } }[]> {
  const perPage = 1000;
  const all: { id: string; email?: string; user_metadata?: { name?: string } }[] = [];
  // Supabase pages are 1-indexed.
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error('[cron-helpers] listUsers page', page, 'failed:', error);
      break;
    }
    const users = data?.users ?? [];
    for (const u of users) {
      all.push({ id: u.id, email: u.email, user_metadata: u.user_metadata });
    }
    if (users.length < perPage) break; // last page
    // Safety valve against a misbehaving API — 100k users is far beyond
    // anything this tier would serve and prevents infinite looping on a
    // bad response.
    if (page > 100) {
      console.warn('[cron-helpers] listUsers exceeded 100 pages, stopping');
      break;
    }
  }
  return all;
}

/**
 * Fetch a user's daily tasks for a given date.
 */
export async function getUserTasks(userId: string, date: string): Promise<TaskSummary[]> {
  const supabase = getAdminSupabase();

  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('title, completed, pomodoros_done, pomodoros_target, tag, goal_id')
    .eq('user_id', userId)
    .eq('date', date)
    .order('order', { ascending: true });

  if (!tasks || tasks.length === 0) return [];

  // Resolve goal titles for linked tasks
  const goalIds = [...new Set(tasks.filter(t => t.goal_id).map(t => t.goal_id!))];
  const goalMap = new Map<string, string>();
  if (goalIds.length > 0) {
    const { data: goals } = await supabase
      .from('goals')
      .select('id, title')
      .in('id', goalIds);
    goals?.forEach(g => goalMap.set(g.id, g.title));
  }

  return tasks.map(t => ({
    title: t.title,
    completed: t.completed,
    pomodoros_done: t.pomodoros_done || 0,
    pomodoros_target: t.pomodoros_target || 0,
    tag: t.tag || undefined,
    goal_title: t.goal_id ? goalMap.get(t.goal_id) : undefined,
  }));
}

/**
 * Fetch active goal + streak for a user.
 */
export async function getUserGoalSummary(userId: string): Promise<GoalSummary | undefined> {
  const supabase = getAdminSupabase();

  const { data: goal } = await supabase
    .from('goals')
    .select('title, sessions_completed, estimated_sessions_current')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!goal) return undefined;

  // Calculate streak — count consecutive days with at least 1 session
  const { data: sessions } = await supabase
    .from('sessions')
    .select('start_time')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('start_time', { ascending: false })
    .limit(90); // last ~3 months

  let streak = 0;
  if (sessions && sessions.length > 0) {
    const days = new Set(sessions.map(s => s.start_time.slice(0, 10)));
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (days.has(key)) {
        streak++;
      } else if (i === 0) {
        // Today might not have sessions yet, skip
        continue;
      } else {
        break;
      }
    }
  }

  return {
    title: goal.title,
    sessions_completed: goal.sessions_completed,
    estimated_sessions: goal.estimated_sessions_current,
    streak,
  };
}

/**
 * Fetch today's session stats for a user.
 */
export async function getUserDaySummary(userId: string, date: string): Promise<DaySummary> {
  const supabase = getAdminSupabase();

  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  const { data: sessions } = await supabase
    .from('sessions')
    .select('duration')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay);

  const totalSessions = sessions?.length || 0;
  const totalFocusMinutes = Math.round((sessions?.reduce((sum, s) => sum + (s.duration || 0), 0) || 0) / 60);

  const { data: tasks } = await supabase
    .from('daily_tasks')
    .select('completed')
    .eq('user_id', userId)
    .eq('date', date);

  const tasksTotal = tasks?.length || 0;
  const tasksCompleted = tasks?.filter(t => t.completed).length || 0;

  // Get streak from goal summary
  const goalSummary = await getUserGoalSummary(userId);

  return {
    total_sessions: totalSessions,
    total_focus_minutes: totalFocusMinutes,
    tasks_completed: tasksCompleted,
    tasks_total: tasksTotal,
    streak: goalSummary?.streak || 0,
  };
}

/**
 * Log an email send to the email_log table.
 */
export async function logEmail(opts: {
  userId: string;
  emailTo: string;
  emailType: string;
  subject: string;
  resendId?: string;
  status?: 'sent' | 'failed';
  error?: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getAdminSupabase();
  await supabase.from('email_log').insert({
    user_id: opts.userId,
    email_to: opts.emailTo,
    email_type: opts.emailType,
    subject: opts.subject,
    resend_id: opts.resendId || null,
    status: opts.status || 'sent',
    error: opts.error || null,
    metadata: opts.metadata || null,
  });
}
