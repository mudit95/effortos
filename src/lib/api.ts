// Supabase API Data Layer
// Mirrors storage.ts interface but reads/writes to Supabase instead of localStorage.

import { Goal, Session, User, FeedbackEntry, DailySession, UserSettings, DEFAULT_SETTINGS, DailyTask, RepeatingTaskTemplate, TaskTagId, Milestone, DashboardMode, JournalEntry, JournalMoodId, ShadowGoal, TimeBlock } from '@/types';
import { createClient } from './supabase/client';

// ── Helpers ────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient();
}

function profileToUser(profile: Record<string, unknown>, email?: string): User {
  return {
    id: profile.id as string,
    name: (profile.name as string) || '',
    email: (profile.email as string) || email || '',
    timezone: (profile.timezone as string) || 'UTC',
    created_at: profile.created_at as string,
    onboarding_completed: profile.onboarding_completed as boolean,
    avatar_url: profile.avatar_url as string | undefined,
    settings: {
      focus_duration: (profile.focus_duration as number) || DEFAULT_SETTINGS.focus_duration,
      break_duration: (profile.break_duration as number) || DEFAULT_SETTINGS.break_duration,
      notifications_enabled: profile.notifications_enabled as boolean ?? DEFAULT_SETTINGS.notifications_enabled,
      sound_enabled: profile.sound_enabled as boolean ?? DEFAULT_SETTINGS.sound_enabled,
      theme: (profile.theme as 'dark' | 'light') || DEFAULT_SETTINGS.theme,
    },
  };
}

function goalRowToGoal(row: Record<string, unknown>, milestones: Milestone[] = [], feedback: FeedbackEntry[] = []): Goal {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    description: row.description as string | undefined,
    estimated_sessions_initial: row.estimated_sessions_initial as number,
    estimated_sessions_current: row.estimated_sessions_current as number,
    sessions_completed: row.sessions_completed as number,
    user_time_bias: row.user_time_bias as number,
    feedback_bias_log: feedback,
    experience_level: row.experience_level as Goal['experience_level'],
    daily_availability: row.daily_availability as number,
    deadline: row.deadline as string | undefined,
    consistency_level: row.consistency_level as Goal['consistency_level'],
    confidence_score: row.confidence_score as number,
    difficulty: row.difficulty as Goal['difficulty'],
    recommended_sessions_per_day: row.recommended_sessions_per_day as number,
    estimated_days: row.estimated_days as number,
    milestones,
    status: row.status as Goal['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    completed_at: row.completed_at as string | undefined,
    paused_at: row.paused_at as string | undefined,
  };
}

// ── User Operations ────────────────────────────────────────────────────

export async function getUser(): Promise<User | null> {
  const supabase = getSupabase();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (!profile) return null;
  return profileToUser(profile, authUser.email);
}

export async function updateUser(updates: Partial<User>): Promise<User | null> {
  const supabase = getSupabase();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return null;

  // Map User fields to profile columns
  const profileUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) profileUpdates.name = updates.name;
  if (updates.email !== undefined) profileUpdates.email = updates.email;
  if (updates.timezone !== undefined) profileUpdates.timezone = updates.timezone;
  if (updates.onboarding_completed !== undefined) profileUpdates.onboarding_completed = updates.onboarding_completed;
  if (updates.avatar_url !== undefined) profileUpdates.avatar_url = updates.avatar_url;

  if (Object.keys(profileUpdates).length > 0) {
    await supabase.from('profiles').update(profileUpdates).eq('id', authUser.id);
  }

  return getUser();
}

export async function updateSettings(settings: Partial<UserSettings>): Promise<User | null> {
  const supabase = getSupabase();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return null;

  const profileUpdates: Record<string, unknown> = {};
  if (settings.focus_duration !== undefined) profileUpdates.focus_duration = settings.focus_duration;
  if (settings.break_duration !== undefined) profileUpdates.break_duration = settings.break_duration;
  if (settings.notifications_enabled !== undefined) profileUpdates.notifications_enabled = settings.notifications_enabled;
  if (settings.sound_enabled !== undefined) profileUpdates.sound_enabled = settings.sound_enabled;
  if (settings.theme !== undefined) profileUpdates.theme = settings.theme;

  if (Object.keys(profileUpdates).length > 0) {
    await supabase.from('profiles').update(profileUpdates).eq('id', authUser.id);
  }

  return getUser();
}

// ── Goal Operations ────────────────────────────────────────────────────

export async function getGoals(): Promise<Goal[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: rows } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', user.id)
    .neq('status', 'abandoned')
    .order('created_at', { ascending: false });

  if (!rows || rows.length === 0) return [];

  // Fetch milestones and feedback for all goals in batch
  const goalIds = rows.map((r: Record<string, unknown>) => r.id as string);

  const [{ data: milestones }, { data: feedback }] = await Promise.all([
    supabase.from('milestones').select('*').in('goal_id', goalIds).order('sort_order'),
    supabase.from('feedback_entries').select('*').in('goal_id', goalIds).order('created_at'),
  ]);

  const milestonesByGoal = new Map<string, Milestone[]>();
  (milestones || []).forEach((m: Record<string, unknown>) => {
    const gid = m.goal_id as string;
    if (!milestonesByGoal.has(gid)) milestonesByGoal.set(gid, []);
    milestonesByGoal.get(gid)!.push({
      id: m.id as string,
      title: m.title as string,
      session_target: m.session_target as number,
      completed: m.completed as boolean,
      completed_at: m.completed_at as string | undefined,
    });
  });

  const feedbackByGoal = new Map<string, FeedbackEntry[]>();
  (feedback || []).forEach((f: Record<string, unknown>) => {
    const gid = f.goal_id as string;
    if (!feedbackByGoal.has(gid)) feedbackByGoal.set(gid, []);
    feedbackByGoal.get(gid)!.push({
      timestamp: f.created_at as string,
      bias: f.bias as number,
      sessions_at_time: f.sessions_at_time as number,
    });
  });

  return rows.map((r: Record<string, unknown>) =>
    goalRowToGoal(r, milestonesByGoal.get(r.id as string) || [], feedbackByGoal.get(r.id as string) || [])
  );
}

export async function getActiveGoal(): Promise<Goal | null> {
  const goals = await getGoals();
  return goals.find(g => g.status === 'active') || null;
}

export async function getGoalById(id: string): Promise<Goal | null> {
  const goals = await getGoals();
  return goals.find(g => g.id === id) || null;
}

export async function createGoal(data: Omit<Goal, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string }): Promise<Goal | null> {
  const supabase = getSupabase();

  // Extract milestones and feedback separately
  const { milestones, feedback_bias_log } = data;

  // Build insert payload with ONLY valid database columns — no extra fields
  const insertData: Record<string, unknown> = {
    user_id: data.user_id,
    title: data.title,
    estimated_sessions_initial: data.estimated_sessions_initial,
    estimated_sessions_current: data.estimated_sessions_current,
    sessions_completed: data.sessions_completed ?? 0,
    user_time_bias: data.user_time_bias ?? 0,
    experience_level: data.experience_level,
    daily_availability: data.daily_availability,
    consistency_level: data.consistency_level,
    confidence_score: data.confidence_score,
    difficulty: data.difficulty,
    recommended_sessions_per_day: data.recommended_sessions_per_day,
    estimated_days: data.estimated_days,
    status: data.status || 'active',
  };
  // Only include optional fields if they have real values
  if (data.description) insertData.description = data.description;
  if (data.deadline) insertData.deadline = data.deadline;
  if (data.paused_at) insertData.paused_at = data.paused_at;
  if (data.completed_at) insertData.completed_at = data.completed_at;

  const { data: row, error } = await supabase
    .from('goals')
    .insert(insertData)
    .select()
    .single();

  if (error || !row) {
    console.warn('Failed to create goal:', error?.message || error, 'Data:', JSON.stringify(insertData).slice(0, 200));
    return null;
  }

  // Insert milestones
  if (milestones && milestones.length > 0) {
    await supabase.from('milestones').insert(
      milestones.map((m, i) => ({
        goal_id: row.id,
        title: m.title,
        session_target: m.session_target,
        completed: m.completed,
        completed_at: m.completed_at,
        sort_order: i,
      }))
    );
  }

  // Insert feedback entries
  if (feedback_bias_log && feedback_bias_log.length > 0) {
    await supabase.from('feedback_entries').insert(
      feedback_bias_log.map(f => ({
        goal_id: row.id,
        bias: f.bias,
        sessions_at_time: f.sessions_at_time,
      }))
    );
  }

  return getGoalById(row.id as string);
}

export async function updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | null> {
  const supabase = getSupabase();

  // Separate embedded arrays from flat fields
  const { milestones, feedback_bias_log, ...flatUpdates } = updates;

  // Remove fields that aren't columns
  const safeUpdates: Record<string, unknown> = {};
  const allowedFields = [
    'title', 'description', 'estimated_sessions_initial', 'estimated_sessions_current',
    'sessions_completed', 'user_time_bias', 'experience_level', 'daily_availability',
    'deadline', 'consistency_level', 'confidence_score', 'difficulty',
    'recommended_sessions_per_day', 'estimated_days', 'status', 'paused_at', 'completed_at',
  ];
  for (const [key, val] of Object.entries(flatUpdates)) {
    if (allowedFields.includes(key)) safeUpdates[key] = val;
  }

  if (Object.keys(safeUpdates).length > 0) {
    await supabase.from('goals').update(safeUpdates).eq('id', id);
  }

  return getGoalById(id);
}

export async function pauseGoal(id: string): Promise<Goal | null> {
  return updateGoal(id, { status: 'paused', paused_at: new Date().toISOString() });
}

export async function resumeGoal(id: string): Promise<Goal | null> {
  return updateGoal(id, { status: 'active', paused_at: undefined });
}

export async function addFeedback(goalId: string, bias: number): Promise<Goal | null> {
  const supabase = getSupabase();
  const goal = await getGoalById(goalId);
  if (!goal) return null;

  await supabase.from('feedback_entries').insert({
    goal_id: goalId,
    bias,
    sessions_at_time: goal.sessions_completed,
  });

  return getGoalById(goalId);
}

// ── Session Operations ────────────────────────────────────────────────

export async function getSessions(goalId?: string): Promise<Session[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('start_time', { ascending: false });

  if (goalId) query = query.eq('goal_id', goalId);

  const { data } = await query;
  return (data || []) as Session[];
}

export async function getCompletedSessions(goalId: string): Promise<Session[]> {
  const sessions = await getSessions(goalId);
  return sessions.filter(s => s.status === 'completed');
}

export async function createSession(data: Omit<Session, 'id' | 'created_at'>): Promise<Session> {
  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from('sessions')
    .insert({ ...data, device: 'web' })
    .select()
    .single();

  if (error || !row) {
    throw new Error('Failed to create session: ' + error?.message);
  }
  return row as Session;
}

export async function createManualSession(userId: string, goalId: string, notes?: string): Promise<Session> {
  const now = new Date();
  const start = new Date(now.getTime() - 25 * 60 * 1000);
  return createSession({
    user_id: userId,
    goal_id: goalId,
    start_time: start.toISOString(),
    end_time: now.toISOString(),
    duration: 25 * 60,
    status: 'completed',
    notes,
    manual: true,
  });
}

export async function updateSession(id: string, updates: Partial<Session>): Promise<Session | null> {
  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  return row as Session | null;
}

export async function completeSession(id: string, duration: number, notes?: string): Promise<Session | null> {
  return updateSession(id, {
    status: 'completed',
    end_time: new Date().toISOString(),
    duration,
    notes,
  });
}

export async function discardSession(id: string): Promise<Session | null> {
  return updateSession(id, { status: 'discarded' });
}

// ── Analytics ──────────────────────────────────────────────────────────

export async function getDailySessions(goalId: string, days: number = 30): Promise<DailySession[]> {
  const sessions = await getCompletedSessions(goalId);
  const result: Map<string, number> = new Map();

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    result.set(key, 0);
  }

  sessions.forEach(s => {
    const key = new Date(s.start_time).toISOString().split('T')[0];
    if (result.has(key)) {
      result.set(key, (result.get(key) || 0) + 1);
    }
  });

  return Array.from(result.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Timer State ────────────────────────────────────────────────────────

export async function saveTimerState(state: {
  goalId: string; remaining: number; isRunning: boolean; sessionId?: string;
}): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('timer_state').upsert({
    user_id: user.id,
    goal_id: state.goalId === '__daily__' ? null : state.goalId,
    remaining: state.remaining,
    is_running: state.isRunning,
    session_id: state.sessionId || null,
    device: 'web',
  });
}

export async function getTimerState(): Promise<{
  goalId: string; remaining: number; isRunning: boolean; sessionId?: string; savedAt: number;
} | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('timer_state')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!data) return null;
  return {
    goalId: (data.goal_id as string) || '__daily__',
    remaining: data.remaining as number,
    isRunning: data.is_running as boolean,
    sessionId: data.session_id as string | undefined,
    savedAt: new Date(data.updated_at as string).getTime(),
  };
}

export async function clearTimerState(): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('timer_state').delete().eq('user_id', user.id);
}

// ── Daily Tasks ────────────────────────────────────────────────────────

export async function getAllDailyTasks(): Promise<DailyTask[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('daily_tasks')
    .select('*')
    .eq('user_id', user.id)
    .order('sort_order');

  return ((data || []) as Record<string, unknown>[]).map(d => ({
    id: d.id as string,
    title: d.title as string,
    completed: d.completed as boolean,
    repeating: d.repeating as boolean,
    pomodoros_target: d.pomodoros_target as number,
    pomodoros_done: d.pomodoros_done as number,
    date: d.date as string,
    tag: d.tag as TaskTagId | undefined,
    goal_id: (d.goal_id as string | null) ?? undefined,
    time_block: (d.time_block as TimeBlock | null) ?? undefined,
    created_at: d.created_at as string,
    completed_at: d.completed_at as string | undefined,
    order: d.sort_order as number,
  }));
}

export async function getDailyTasksForDate(date: string): Promise<DailyTask[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('daily_tasks')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('sort_order');

  return ((data || []) as Record<string, unknown>[]).map(d => ({
    id: d.id as string,
    title: d.title as string,
    completed: d.completed as boolean,
    repeating: d.repeating as boolean,
    pomodoros_target: d.pomodoros_target as number,
    pomodoros_done: d.pomodoros_done as number,
    date: d.date as string,
    tag: d.tag as TaskTagId | undefined,
    goal_id: (d.goal_id as string | null) ?? undefined,
    time_block: (d.time_block as TimeBlock | null) ?? undefined,
    created_at: d.created_at as string,
    completed_at: d.completed_at as string | undefined,
    order: d.sort_order as number,
  }));
}

export async function createDailyTask(
  title: string,
  pomodorosTarget: number = 1,
  repeating: boolean = false,
  tag?: TaskTagId,
  goalId?: string,
): Promise<DailyTask | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const date = new Date().toISOString().split('T')[0];
  const existing = await getDailyTasksForDate(date);

  const { data: row } = await supabase
    .from('daily_tasks')
    .insert({
      user_id: user.id,
      title,
      pomodoros_target: pomodorosTarget,
      repeating,
      tag,
      date,
      // `goal_id` links the task back to a goal so per-goal rollups and
      // reporting work. Previously this was silently dropped on create —
      // only updateDailyTask could set it.
      goal_id: goalId ?? null,
      sort_order: existing.length,
    })
    .select()
    .single();

  if (repeating) {
    await addRepeatingTemplate(title, pomodorosTarget, tag);
  }

  if (!row) return null;
  return {
    id: row.id as string,
    title: row.title as string,
    completed: false,
    repeating,
    pomodoros_target: pomodorosTarget,
    pomodoros_done: 0,
    date,
    tag,
    goal_id: (row.goal_id as string | null) ?? undefined,
    created_at: row.created_at as string,
    order: existing.length,
  };
}

export async function createDailyTaskForDate(
  title: string,
  date: string,
  pomodorosTarget: number = 1,
  repeating: boolean = false,
  tag?: TaskTagId,
  goalId?: string,
): Promise<DailyTask | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const existing = await getDailyTasksForDate(date);

  const { data: row } = await supabase
    .from('daily_tasks')
    .insert({
      user_id: user.id,
      title,
      pomodoros_target: pomodorosTarget,
      repeating,
      tag,
      date,
      goal_id: goalId ?? null,
      sort_order: existing.length,
    })
    .select()
    .single();

  if (repeating) {
    await addRepeatingTemplate(title, pomodorosTarget, tag);
  }

  if (!row) return null;
  return {
    id: row.id as string,
    title: row.title as string,
    completed: false,
    repeating,
    pomodoros_target: pomodorosTarget,
    pomodoros_done: 0,
    date,
    tag,
    goal_id: (row.goal_id as string | null) ?? undefined,
    created_at: row.created_at as string,
    order: existing.length,
  };
}

export async function updateDailyTask(id: string, updates: Partial<DailyTask>): Promise<DailyTask | null> {
  const supabase = getSupabase();
  const dbUpdates: Record<string, unknown> = {};
  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.completed !== undefined) dbUpdates.completed = updates.completed;
  if (updates.pomodoros_target !== undefined) dbUpdates.pomodoros_target = updates.pomodoros_target;
  if (updates.pomodoros_done !== undefined) dbUpdates.pomodoros_done = updates.pomodoros_done;
  if (updates.tag !== undefined) dbUpdates.tag = updates.tag;
  if (updates.completed_at !== undefined) dbUpdates.completed_at = updates.completed_at;
  if (updates.order !== undefined) dbUpdates.sort_order = updates.order;
  // `date` and `goal_id` were previously dropped by this allowlist, which
  // silently broke "Roll to tomorrow" (date change reverted on next refresh)
  // and any goal-reassignment UI for cloud users. Same trap waits for any
  // new field added here — `time_block` (Schedule view drag-and-drop)
  // explicitly serializes `null` to mean "unscheduled" so the column can
  // be cleared without falling through the `!== undefined` guard.
  if (updates.date !== undefined) dbUpdates.date = updates.date;
  if (updates.goal_id !== undefined) dbUpdates.goal_id = updates.goal_id;
  if (updates.time_block !== undefined) dbUpdates.time_block = updates.time_block ?? null;

  const { data: row } = await supabase
    .from('daily_tasks')
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single();

  if (!row) return null;
  return {
    id: row.id as string,
    title: row.title as string,
    completed: row.completed as boolean,
    repeating: row.repeating as boolean,
    pomodoros_target: row.pomodoros_target as number,
    pomodoros_done: row.pomodoros_done as number,
    date: row.date as string,
    tag: row.tag as TaskTagId | undefined,
    goal_id: (row.goal_id as string | null) ?? undefined,
    time_block: (row.time_block as TimeBlock | null) ?? undefined,
    created_at: row.created_at as string,
    completed_at: row.completed_at as string | undefined,
    order: row.sort_order as number,
  };
}

export async function toggleDailyTaskComplete(id: string): Promise<DailyTask | null> {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('daily_tasks')
    .select('completed')
    .eq('id', id)
    .single();

  if (!existing) return null;
  const completed = !(existing.completed as boolean);

  return updateDailyTask(id, {
    completed,
    completed_at: completed ? new Date().toISOString() : undefined,
  });
}

export async function incrementTaskPomodoro(id: string): Promise<DailyTask | null> {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from('daily_tasks')
    .select('pomodoros_done, pomodoros_target, completed, completed_at')
    .eq('id', id)
    .single();

  if (!existing) return null;
  const newDone = (existing.pomodoros_done as number) + 1;
  const autoComplete = newDone >= (existing.pomodoros_target as number);

  return updateDailyTask(id, {
    pomodoros_done: newDone,
    completed: autoComplete ? true : existing.completed as boolean,
    completed_at: autoComplete && !(existing.completed_at) ? new Date().toISOString() : existing.completed_at as string | undefined,
  });
}

export async function deleteDailyTask(id: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('daily_tasks').delete().eq('id', id);
}

// ── Repeating Templates ────────────────────────────────────────────────

export async function getRepeatingTemplates(): Promise<RepeatingTaskTemplate[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('repeating_templates')
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true);

  return ((data || []) as Record<string, unknown>[]).map(t => ({
    id: t.id as string,
    title: t.title as string,
    pomodoros_target: t.pomodoros_target as number,
    tag: t.tag as TaskTagId | undefined,
    created_at: t.created_at as string,
    active: true,
  }));
}

export async function addRepeatingTemplate(
  title: string, pomodorosTarget: number, tag?: TaskTagId
): Promise<RepeatingTaskTemplate | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Check for existing
  const { data: existing } = await supabase
    .from('repeating_templates')
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true)
    .ilike('title', title);

  if (existing && existing.length > 0) {
    return {
      id: existing[0].id as string,
      title: existing[0].title as string,
      pomodoros_target: existing[0].pomodoros_target as number,
      tag: existing[0].tag as TaskTagId | undefined,
      created_at: existing[0].created_at as string,
      active: true,
    };
  }

  const { data: row } = await supabase
    .from('repeating_templates')
    .insert({ user_id: user.id, title, pomodoros_target: pomodorosTarget, tag })
    .select()
    .single();

  if (!row) return null;
  return {
    id: row.id as string,
    title: row.title as string,
    pomodoros_target: row.pomodoros_target as number,
    tag: row.tag as TaskTagId | undefined,
    created_at: row.created_at as string,
    active: true,
  };
}

export async function removeRepeatingTemplate(id: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('repeating_templates').update({ active: false }).eq('id', id);
}

export async function ensureRepeatingTasksForDate(date: string): Promise<DailyTask[]> {
  const templates = await getRepeatingTemplates();
  const existingTasks = await getDailyTasksForDate(date);
  const existingTitles = new Set(existingTasks.map(t => t.title.toLowerCase()));

  const newTasks: DailyTask[] = [];
  for (const template of templates) {
    if (!existingTitles.has(template.title.toLowerCase())) {
      const task = await createDailyTaskForDate(
        template.title, date, template.pomodoros_target, true, template.tag
      );
      if (task) newTasks.push(task);
    }
  }
  return [...existingTasks, ...newTasks];
}

// ── Journal entries ───────────────────────────────────────────────────
// The DB has UNIQUE(user_id, date); we lean on that by always using
// `upsert(..., onConflict: 'user_id,date')` so upstream code doesn't
// have to branch on "does this day already exist?".

function mapJournalRow(row: Record<string, unknown>): JournalEntry {
  return {
    id: row.id as string,
    date: row.date as string,
    content: (row.content as string) ?? '',
    mood: (row.mood as JournalMoodId | null) ?? undefined,
    ai_prompt: (row.ai_prompt as string | null) ?? undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function getJournalEntries(): Promise<JournalEntry[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false });

  return (data ?? []).map(mapJournalRow);
}

export async function getJournalEntryForDate(date: string): Promise<JournalEntry | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', date)
    .maybeSingle();

  return data ? mapJournalRow(data) : null;
}

export async function upsertJournalEntry(
  date: string,
  content: string,
  mood?: JournalMoodId,
): Promise<JournalEntry | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // `onConflict` must list the columns in the unique constraint so Postgres
  // picks it (otherwise it errors with "there is no unique or exclusion
  // constraint matching the ON CONFLICT specification").
  const { data } = await supabase
    .from('journal_entries')
    .upsert(
      {
        user_id: user.id,
        date,
        content,
        mood: mood ?? null,
        // updated_at is bumped by the DB trigger defined in migration 013.
      },
      { onConflict: 'user_id,date' },
    )
    .select()
    .single();

  return data ? mapJournalRow(data) : null;
}

export async function deleteJournalEntry(date: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('journal_entries')
    .delete()
    .eq('user_id', user.id)
    .eq('date', date);
}

/**
 * Attach a one-time AI-generated prompt to an entry. Uses upsert so the
 * row is created if it doesn't exist yet (content defaults to '' server-
 * side). Only ai_prompt is included in the payload, so existing content/
 * mood are untouched — Supabase's upsert maps to ON CONFLICT DO UPDATE
 * over only the payload columns.
 */
export async function setJournalAIPrompt(
  date: string,
  prompt: string,
): Promise<JournalEntry | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('journal_entries')
    .upsert(
      {
        user_id: user.id,
        date,
        ai_prompt: prompt,
      },
      { onConflict: 'user_id,date' },
    )
    .select()
    .single();

  return data ? mapJournalRow(data) : null;
}

// ── Shadow goals ──────────────────────────────────────────────────────
// "Someday shelf" rows. RLS gates by user_id so we can leave the
// `.eq('user_id', user.id)` filter in for defence-in-depth (matches the
// pattern in goals/daily_tasks/journal_entries) — the policy would block
// cross-user reads anyway but explicit beats implicit here.

function mapShadowGoalRow(row: Record<string, unknown>): ShadowGoal {
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    note: (row.note as string) ?? '',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function getShadowGoals(): Promise<ShadowGoal[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('shadow_goals')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return (data ?? []).map(mapShadowGoalRow);
}

export async function createShadowGoal(
  title: string,
  note = '',
): Promise<ShadowGoal | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('shadow_goals')
    .insert({
      user_id: user.id,
      title: title.trim(),
      note: note.trim(),
    })
    .select()
    .single();

  return data ? mapShadowGoalRow(data) : null;
}

export async function updateShadowGoal(
  id: string,
  patch: { title?: string; note?: string },
): Promise<ShadowGoal | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.note !== undefined) update.note = patch.note.trim();
  // updated_at is bumped by the DB trigger defined in migration 014.

  // Avoid issuing an empty UPDATE — Supabase will accept it but it's a
  // pointless round trip and would still touch updated_at via the trigger.
  if (Object.keys(update).length === 0) {
    const { data } = await supabase
      .from('shadow_goals')
      .select('*')
      .eq('user_id', user.id)
      .eq('id', id)
      .maybeSingle();
    return data ? mapShadowGoalRow(data) : null;
  }

  const { data } = await supabase
    .from('shadow_goals')
    .update(update)
    .eq('user_id', user.id)
    .eq('id', id)
    .select()
    .single();

  return data ? mapShadowGoalRow(data) : null;
}

export async function deleteShadowGoal(id: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('shadow_goals')
    .delete()
    .eq('user_id', user.id)
    .eq('id', id);
}
