// Local Storage Persistence Layer

import { Goal, Session, User, FeedbackEntry, DailySession, UserSettings, DEFAULT_SETTINGS, DailyTask, RepeatingTaskTemplate, TaskTagId, DashboardMode, JournalEntry, JournalMoodId, ShadowGoal, DailyGrindLayout } from '@/types';
import { generateId } from './utils';

const STORAGE_KEYS = {
  USER: 'effortos_user',
  GOALS: 'effortos_goals',
  SESSIONS: 'effortos_sessions',
  TIMER_STATE: 'effortos_timer',
  DAILY_TASKS: 'effortos_daily_tasks',
  REPEATING_TEMPLATES: 'effortos_repeating_templates',
  DASHBOARD_MODE: 'effortos_dashboard_mode',
  JOURNAL_ENTRIES: 'effortos_journal_entries',
  SHADOW_GOALS: 'effortos_shadow_goals',
  DAILY_GRIND_LAYOUT: 'effortos_daily_grind_layout',
} as const;

function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Storage write failed:', e);
  }
}

// User operations
export function getUser(): User | null {
  const user = safeGet<User | null>(STORAGE_KEYS.USER, null);
  if (user && !user.settings) {
    user.settings = DEFAULT_SETTINGS;
  }
  return user;
}

export function setUser(user: User): void {
  safeSet(STORAGE_KEYS.USER, user);
}

export function createDemoUser(name: string, email: string): User {
  const user: User = {
    id: generateId(),
    name,
    email,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    created_at: new Date().toISOString(),
    onboarding_completed: false,
    settings: DEFAULT_SETTINGS,
  };
  setUser(user);
  return user;
}

export function updateUser(updates: Partial<User>): User | null {
  const user = getUser();
  if (!user) return null;
  const updated = { ...user, ...updates };
  setUser(updated);
  return updated;
}

export function updateSettings(settings: Partial<UserSettings>): User | null {
  const user = getUser();
  if (!user) return null;
  const updated = { ...user, settings: { ...user.settings, ...settings } };
  setUser(updated);
  return updated;
}

// Goal operations
export function getGoals(): Goal[] {
  return safeGet<Goal[]>(STORAGE_KEYS.GOALS, []);
}

export function getActiveGoal(): Goal | null {
  const goals = getGoals();
  return goals.find(g => g.status === 'active') || null;
}

export function getGoalById(id: string): Goal | null {
  const goals = getGoals();
  return goals.find(g => g.id === id) || null;
}

export function getCompletedGoals(): Goal[] {
  return getGoals().filter(g => g.status === 'completed');
}

export function getPausedGoals(): Goal[] {
  return getGoals().filter(g => g.status === 'paused');
}

export function getAllNonAbandonedGoals(): Goal[] {
  return getGoals().filter(g => g.status !== 'abandoned');
}

export function createGoal(data: Omit<Goal, 'id' | 'created_at' | 'updated_at'>): Goal {
  const goal: Goal = {
    ...data,
    id: generateId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const goals = getGoals();
  goals.push(goal);
  safeSet(STORAGE_KEYS.GOALS, goals);
  return goal;
}

export function updateGoal(id: string, updates: Partial<Goal>): Goal | null {
  const goals = getGoals();
  const index = goals.findIndex(g => g.id === id);
  if (index === -1) return null;
  goals[index] = { ...goals[index], ...updates, updated_at: new Date().toISOString() };
  safeSet(STORAGE_KEYS.GOALS, goals);
  return goals[index];
}

export function pauseGoal(id: string): Goal | null {
  return updateGoal(id, { status: 'paused', paused_at: new Date().toISOString() });
}

export function resumeGoal(id: string): Goal | null {
  return updateGoal(id, { status: 'active', paused_at: undefined });
}

export function addFeedback(goalId: string, bias: number): Goal | null {
  const goal = getGoalById(goalId);
  if (!goal) return null;
  const entry: FeedbackEntry = {
    timestamp: new Date().toISOString(),
    bias,
    sessions_at_time: goal.sessions_completed,
  };
  const log = [...goal.feedback_bias_log, entry];
  return updateGoal(goalId, { feedback_bias_log: log });
}

// Session operations
export function getSessions(goalId?: string): Session[] {
  const sessions = safeGet<Session[]>(STORAGE_KEYS.SESSIONS, []);
  if (goalId) return sessions.filter(s => s.goal_id === goalId);
  return sessions;
}

export function getCompletedSessions(goalId: string): Session[] {
  return getSessions(goalId).filter(s => s.status === 'completed');
}

export function createSession(data: Omit<Session, 'id' | 'created_at'>): Session {
  const session: Session = {
    ...data,
    id: generateId(),
    created_at: new Date().toISOString(),
  };
  const sessions = getSessions();
  sessions.push(session);
  safeSet(STORAGE_KEYS.SESSIONS, sessions);
  return session;
}

export function createManualSession(userId: string, goalId: string, notes?: string): Session {
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

export function updateSession(id: string, updates: Partial<Session>): Session | null {
  const sessions = getSessions();
  const index = sessions.findIndex(s => s.id === id);
  if (index === -1) return null;
  sessions[index] = { ...sessions[index], ...updates };
  safeSet(STORAGE_KEYS.SESSIONS, sessions);
  return sessions[index];
}

export function completeSession(id: string, duration: number, notes?: string): Session | null {
  return updateSession(id, {
    status: 'completed',
    end_time: new Date().toISOString(),
    duration,
    notes,
  });
}

export function discardSession(id: string): Session | null {
  return updateSession(id, { status: 'discarded' });
}

// Analytics
export function getDailySessions(goalId: string, days: number = 30): DailySession[] {
  const sessions = getCompletedSessions(goalId);
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

// Timer state persistence
export function saveTimerState(state: { goalId: string; remaining: number; isRunning: boolean; sessionId?: string }): void {
  safeSet(STORAGE_KEYS.TIMER_STATE, { ...state, savedAt: Date.now() });
}

export function getTimerState(): { goalId: string; remaining: number; isRunning: boolean; sessionId?: string; savedAt: number } | null {
  return safeGet(STORAGE_KEYS.TIMER_STATE, null);
}

export function clearTimerState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.TIMER_STATE);
}

// Dashboard mode
export function getDashboardMode(): DashboardMode {
  if (typeof window === 'undefined') return 'longterm';
  return (localStorage.getItem(STORAGE_KEYS.DASHBOARD_MODE) as DashboardMode) || 'longterm';
}

export function setDashboardMode(mode: DashboardMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.DASHBOARD_MODE, mode);
}

// Daily Grind layout (list vs schedule). Persisted separately from
// DashboardMode because they toggle independently — the user might want
// "Daily mode → Schedule layout" or "Daily mode → List layout".
export function getDailyGrindLayout(): DailyGrindLayout {
  if (typeof window === 'undefined') return 'list';
  const raw = localStorage.getItem(STORAGE_KEYS.DAILY_GRIND_LAYOUT);
  return raw === 'schedule' ? 'schedule' : 'list';
}

export function setDailyGrindLayout(layout: DailyGrindLayout): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.DAILY_GRIND_LAYOUT, layout);
}

// Daily Tasks
function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

export function getAllDailyTasks(): DailyTask[] {
  return safeGet<DailyTask[]>(STORAGE_KEYS.DAILY_TASKS, []);
}

export function getDailyTasksForDate(date: string): DailyTask[] {
  return getAllDailyTasks()
    .filter(t => t.date === date)
    .sort((a, b) => a.order - b.order);
}

export function getTodayTasks(): DailyTask[] {
  return getDailyTasksForDate(getTodayKey());
}

export function createDailyTask(
  title: string,
  pomodorosTarget: number = 1,
  repeating: boolean = false,
  tag?: TaskTagId,
  goalId?: string,
): DailyTask {
  const tasks = getAllDailyTasks();
  const todayTasks = tasks.filter(t => t.date === getTodayKey());
  const task: DailyTask = {
    id: generateId(),
    title,
    completed: false,
    repeating,
    pomodoros_target: pomodorosTarget,
    pomodoros_done: 0,
    date: getTodayKey(),
    tag,
    goal_id: goalId || undefined,
    created_at: new Date().toISOString(),
    order: todayTasks.length,
  };
  tasks.push(task);
  safeSet(STORAGE_KEYS.DAILY_TASKS, tasks);

  if (repeating) {
    addRepeatingTemplate(title, pomodorosTarget, tag);
  }

  return task;
}

export function createDailyTaskForDate(
  title: string,
  date: string,
  pomodorosTarget: number = 1,
  repeating: boolean = false,
  tag?: TaskTagId,
  goalId?: string,
): DailyTask {
  const tasks = getAllDailyTasks();
  const dateTasks = tasks.filter(t => t.date === date);
  const task: DailyTask = {
    id: generateId(),
    title,
    completed: false,
    repeating,
    pomodoros_target: pomodorosTarget,
    pomodoros_done: 0,
    date,
    tag,
    goal_id: goalId || undefined,
    created_at: new Date().toISOString(),
    order: dateTasks.length,
  };
  tasks.push(task);
  safeSet(STORAGE_KEYS.DAILY_TASKS, tasks);

  if (repeating) {
    addRepeatingTemplate(title, pomodorosTarget, tag);
  }

  return task;
}

export function updateDailyTask(id: string, updates: Partial<DailyTask>): DailyTask | null {
  const tasks = getAllDailyTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...updates };
  safeSet(STORAGE_KEYS.DAILY_TASKS, tasks);
  return tasks[idx];
}

export function toggleDailyTaskComplete(id: string): DailyTask | null {
  const tasks = getAllDailyTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const completed = !tasks[idx].completed;
  tasks[idx] = {
    ...tasks[idx],
    completed,
    completed_at: completed ? new Date().toISOString() : undefined,
  };
  safeSet(STORAGE_KEYS.DAILY_TASKS, tasks);
  return tasks[idx];
}

export function incrementTaskPomodoro(id: string): DailyTask | null {
  const tasks = getAllDailyTasks();
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const newDone = tasks[idx].pomodoros_done + 1;
  const autoComplete = newDone >= tasks[idx].pomodoros_target;
  tasks[idx] = {
    ...tasks[idx],
    pomodoros_done: newDone,
    completed: autoComplete ? true : tasks[idx].completed,
    completed_at: autoComplete && !tasks[idx].completed_at ? new Date().toISOString() : tasks[idx].completed_at,
  };
  safeSet(STORAGE_KEYS.DAILY_TASKS, tasks);
  return tasks[idx];
}

export function deleteDailyTask(id: string): void {
  const tasks = getAllDailyTasks().filter(t => t.id !== id);
  safeSet(STORAGE_KEYS.DAILY_TASKS, tasks);
}

export function reorderDailyTasks(date: string, orderedIds: string[]): void {
  const tasks = getAllDailyTasks();
  orderedIds.forEach((id, index) => {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx !== -1) tasks[idx].order = index;
  });
  safeSet(STORAGE_KEYS.DAILY_TASKS, tasks);
}

// Repeating task templates
export function getRepeatingTemplates(): RepeatingTaskTemplate[] {
  return safeGet<RepeatingTaskTemplate[]>(STORAGE_KEYS.REPEATING_TEMPLATES, []);
}

export function addRepeatingTemplate(title: string, pomodorosTarget: number, tag?: TaskTagId): RepeatingTaskTemplate {
  const templates = getRepeatingTemplates();
  const existing = templates.find(t => t.title.toLowerCase() === title.toLowerCase() && t.active);
  if (existing) return existing;

  const template: RepeatingTaskTemplate = {
    id: generateId(),
    title,
    pomodoros_target: pomodorosTarget,
    tag,
    created_at: new Date().toISOString(),
    active: true,
  };
  templates.push(template);
  safeSet(STORAGE_KEYS.REPEATING_TEMPLATES, templates);
  return template;
}

export function removeRepeatingTemplate(id: string): void {
  const templates = getRepeatingTemplates().map(t =>
    t.id === id ? { ...t, active: false } : t
  );
  safeSet(STORAGE_KEYS.REPEATING_TEMPLATES, templates);
}

// Populate today's tasks from repeating templates (call on app init)
export function ensureRepeatingTasksForDate(date: string): DailyTask[] {
  const templates = getRepeatingTemplates().filter(t => t.active);
  const existingTasks = getDailyTasksForDate(date);
  const existingTitles = new Set(existingTasks.map(t => t.title.toLowerCase()));

  const newTasks: DailyTask[] = [];
  for (const template of templates) {
    if (!existingTitles.has(template.title.toLowerCase())) {
      const task = createDailyTaskForDate(template.title, date, template.pomodoros_target, true, template.tag);
      newTasks.push(task);
    }
  }
  return [...existingTasks, ...newTasks];
}

// Clear all data
export function clearAllData(): void {
  if (typeof window === 'undefined') return;
  Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
}

// ── Journal entries (one per calendar day) ────────────────────────────
// The DB has UNIQUE(user_id, date); mirror that invariant here by always
// upserting on date rather than creating duplicates.

export function getJournalEntries(): JournalEntry[] {
  return safeGet<JournalEntry[]>(STORAGE_KEYS.JOURNAL_ENTRIES, []);
}

export function getJournalEntryForDate(date: string): JournalEntry | null {
  const entries = getJournalEntries();
  return entries.find(e => e.date === date) ?? null;
}

/**
 * Insert-or-update by date. If an entry already exists for `date`, its
 * `content`/`mood` are replaced and `updated_at` bumped; otherwise a new
 * row is appended.
 *
 * Returns the resulting entry so callers can sync state in one go.
 */
export function upsertJournalEntry(
  date: string,
  content: string,
  mood?: JournalMoodId,
): JournalEntry {
  const entries = getJournalEntries();
  const now = new Date().toISOString();
  const idx = entries.findIndex(e => e.date === date);

  if (idx >= 0) {
    const updated: JournalEntry = {
      ...entries[idx],
      content,
      mood,
      updated_at: now,
    };
    entries[idx] = updated;
    safeSet(STORAGE_KEYS.JOURNAL_ENTRIES, entries);
    return updated;
  }

  const created: JournalEntry = {
    id: generateId(),
    date,
    content,
    mood,
    created_at: now,
    updated_at: now,
  };
  entries.push(created);
  safeSet(STORAGE_KEYS.JOURNAL_ENTRIES, entries);
  return created;
}

export function deleteJournalEntry(date: string): void {
  const entries = getJournalEntries().filter(e => e.date !== date);
  safeSet(STORAGE_KEYS.JOURNAL_ENTRIES, entries);
}

/**
 * Attach an AI-generated writing prompt to an entry. Creates a shell
 * entry if none exists for the date (so the prompt isn't lost just
 * because the user hasn't typed yet). Returns the resulting entry.
 *
 * The normal autosave path (upsertJournalEntry) preserves ai_prompt
 * via spread, so calling this once and then continuing to write is
 * safe — the prompt survives every subsequent save.
 */
export function setJournalAIPrompt(date: string, prompt: string): JournalEntry {
  const entries = getJournalEntries();
  const now = new Date().toISOString();
  const idx = entries.findIndex(e => e.date === date);

  if (idx >= 0) {
    const updated: JournalEntry = {
      ...entries[idx],
      ai_prompt: prompt,
      updated_at: now,
    };
    entries[idx] = updated;
    safeSet(STORAGE_KEYS.JOURNAL_ENTRIES, entries);
    return updated;
  }

  const created: JournalEntry = {
    id: generateId(),
    date,
    content: '',
    ai_prompt: prompt,
    created_at: now,
    updated_at: now,
  };
  entries.push(created);
  safeSet(STORAGE_KEYS.JOURNAL_ENTRIES, entries);
  return created;
}

// ── Shadow goals (the "someday shelf") ────────────────────────────────
// Parked goal ideas with no estimation/scheduling attached. Stored
// separately from goals so the active-goal list stays lean. The shelf is
// rendered newest-first, which is why we keep the array sorted by
// created_at DESC on every write.

function sortShadowGoals(list: ShadowGoal[]): ShadowGoal[] {
  return [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getShadowGoals(): ShadowGoal[] {
  return sortShadowGoals(safeGet<ShadowGoal[]>(STORAGE_KEYS.SHADOW_GOALS, []));
}

export function createShadowGoal(title: string, note = ''): ShadowGoal {
  const now = new Date().toISOString();
  const created: ShadowGoal = {
    id: generateId(),
    title: title.trim(),
    note: note.trim(),
    created_at: now,
    updated_at: now,
  };
  const next = sortShadowGoals([created, ...getShadowGoals()]);
  safeSet(STORAGE_KEYS.SHADOW_GOALS, next);
  return created;
}

export function updateShadowGoal(
  id: string,
  patch: { title?: string; note?: string },
): ShadowGoal | null {
  const list = getShadowGoals();
  const idx = list.findIndex(g => g.id === id);
  if (idx < 0) return null;
  const updated: ShadowGoal = {
    ...list[idx],
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.note !== undefined ? { note: patch.note.trim() } : {}),
    updated_at: new Date().toISOString(),
  };
  list[idx] = updated;
  safeSet(STORAGE_KEYS.SHADOW_GOALS, list);
  return updated;
}

export function deleteShadowGoal(id: string): void {
  const next = getShadowGoals().filter(g => g.id !== id);
  safeSet(STORAGE_KEYS.SHADOW_GOALS, next);
}
