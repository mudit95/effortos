// Data Layer Abstraction
// Delegates to Supabase API when authenticated, localStorage when in demo mode.
// This is the ONLY module the Zustand store should import for data operations.

import * as storage from './storage';
import * as api from './api';
import { createClient, isSupabaseConfigured } from './supabase/client';
import {
  Goal, Session, User, UserSettings, DailyTask, DailySession,
  RepeatingTaskTemplate, TaskTagId, DashboardMode,
} from '@/types';

// ── Provider Detection ─────────────────────────────────────────────────

let _isCloudUser: boolean | null = null;

/**
 * Checks if the current user has a Supabase session.
 * Cached after first check — call resetProvider() to re-check.
 */
async function isCloudUser(): Promise<boolean> {
  if (_isCloudUser !== null) return _isCloudUser;
  if (!isSupabaseConfigured()) {
    _isCloudUser = false;
    return false;
  }
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    _isCloudUser = !!session?.user;
  } catch {
    _isCloudUser = false;
  }
  return _isCloudUser;
}

/** Reset the cached provider — call after login/logout */
export function resetProvider(): void {
  _isCloudUser = null;
}

// ── User ───────────────────────────────────────────────────────────────

export async function getUser(): Promise<User | null> {
  if (await isCloudUser()) return api.getUser();
  return storage.getUser();
}

export async function updateUser(updates: Partial<User>): Promise<User | null> {
  if (await isCloudUser()) {
    const result = await api.updateUser(updates);
    // Also update localStorage cache
    if (result) storage.setUser(result);
    return result;
  }
  return storage.updateUser(updates);
}

export async function updateSettings(settings: Partial<UserSettings>): Promise<User | null> {
  if (await isCloudUser()) {
    const result = await api.updateSettings(settings);
    if (result) storage.setUser(result);
    return result;
  }
  return storage.updateSettings(settings);
}

// ── Goals ──────────────────────────────────────────────────────────────

export async function getGoals(): Promise<Goal[]> {
  if (await isCloudUser()) return api.getGoals();
  return storage.getGoals();
}

export async function getActiveGoal(): Promise<Goal | null> {
  if (await isCloudUser()) return api.getActiveGoal();
  return storage.getActiveGoal();
}

export async function getGoalById(id: string): Promise<Goal | null> {
  if (await isCloudUser()) return api.getGoalById(id);
  return storage.getGoalById(id);
}

export async function createGoal(data: Omit<Goal, 'id' | 'created_at' | 'updated_at'>): Promise<Goal | null> {
  if (await isCloudUser()) return api.createGoal(data);
  return storage.createGoal(data);
}

export async function updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | null> {
  if (await isCloudUser()) return api.updateGoal(id, updates);
  return storage.updateGoal(id, updates);
}

export async function pauseGoal(id: string): Promise<Goal | null> {
  if (await isCloudUser()) return api.pauseGoal(id);
  return storage.pauseGoal(id);
}

export async function resumeGoal(id: string): Promise<Goal | null> {
  if (await isCloudUser()) return api.resumeGoal(id);
  return storage.resumeGoal(id);
}

export async function addFeedback(goalId: string, bias: number): Promise<Goal | null> {
  if (await isCloudUser()) return api.addFeedback(goalId, bias);
  return storage.addFeedback(goalId, bias);
}

// ── Sessions ───────────────────────────────────────────────────────────

export async function getSessions(goalId?: string): Promise<Session[]> {
  if (await isCloudUser()) return api.getSessions(goalId);
  return storage.getSessions(goalId);
}

export async function getCompletedSessions(goalId: string): Promise<Session[]> {
  if (await isCloudUser()) return api.getCompletedSessions(goalId);
  return storage.getCompletedSessions(goalId);
}

export async function createSession(data: Omit<Session, 'id' | 'created_at'>): Promise<Session> {
  if (await isCloudUser()) return api.createSession(data);
  return storage.createSession(data);
}

export async function createManualSession(userId: string, goalId: string, notes?: string): Promise<Session> {
  if (await isCloudUser()) return api.createManualSession(userId, goalId, notes);
  return storage.createManualSession(userId, goalId, notes);
}

export async function updateSession(id: string, updates: Partial<Session>): Promise<Session | null> {
  if (await isCloudUser()) return api.updateSession(id, updates);
  return storage.updateSession(id, updates);
}

export async function completeSession(id: string, duration: number, notes?: string): Promise<Session | null> {
  if (await isCloudUser()) return api.completeSession(id, duration, notes);
  return storage.completeSession(id, duration, notes);
}

export async function discardSession(id: string): Promise<Session | null> {
  if (await isCloudUser()) return api.discardSession(id);
  return storage.discardSession(id);
}

// ── Analytics ──────────────────────────────────────────────────────────

export async function getDailySessions(goalId: string, days?: number): Promise<DailySession[]> {
  if (await isCloudUser()) return api.getDailySessions(goalId, days);
  return storage.getDailySessions(goalId, days);
}

// ── Timer State ────────────────────────────────────────────────────────

export async function saveTimerState(state: {
  goalId: string; remaining: number; isRunning: boolean; sessionId?: string;
}): Promise<void> {
  // Always save to localStorage for fast recovery
  storage.saveTimerState(state);
  // Also save to cloud if authenticated
  if (await isCloudUser()) {
    api.saveTimerState(state).catch(() => {}); // Fire and forget
  }
}

export async function getTimerState(): Promise<{
  goalId: string; remaining: number; isRunning: boolean; sessionId?: string; savedAt: number;
} | null> {
  // Prefer localStorage for speed (timer recovery needs to be instant)
  const local = storage.getTimerState();
  if (local) return local;
  if (await isCloudUser()) return api.getTimerState();
  return null;
}

export async function clearTimerState(): Promise<void> {
  storage.clearTimerState();
  if (await isCloudUser()) {
    api.clearTimerState().catch(() => {});
  }
}

// ── Dashboard Mode (always localStorage — UI preference, not data) ────

export function getDashboardMode(): DashboardMode {
  return storage.getDashboardMode();
}

export function setDashboardMode(mode: DashboardMode): void {
  storage.setDashboardMode(mode);
}

// ── Daily Tasks ────────────────────────────────────────────────────────

export async function getAllDailyTasks(): Promise<DailyTask[]> {
  if (await isCloudUser()) return api.getAllDailyTasks();
  return storage.getAllDailyTasks();
}

export async function getDailyTasksForDate(date: string): Promise<DailyTask[]> {
  if (await isCloudUser()) return api.getDailyTasksForDate(date);
  return storage.getDailyTasksForDate(date);
}

export async function createDailyTask(
  title: string, pomodorosTarget?: number, repeating?: boolean, tag?: TaskTagId
): Promise<DailyTask | null> {
  if (await isCloudUser()) return api.createDailyTask(title, pomodorosTarget, repeating, tag);
  return storage.createDailyTask(title, pomodorosTarget, repeating, tag);
}

export async function createDailyTaskForDate(
  title: string, date: string, pomodorosTarget?: number, repeating?: boolean, tag?: TaskTagId
): Promise<DailyTask | null> {
  if (await isCloudUser()) return api.createDailyTaskForDate(title, date, pomodorosTarget, repeating, tag);
  return storage.createDailyTaskForDate(title, date, pomodorosTarget, repeating, tag);
}

export async function updateDailyTask(id: string, updates: Partial<DailyTask>): Promise<DailyTask | null> {
  if (await isCloudUser()) return api.updateDailyTask(id, updates);
  return storage.updateDailyTask(id, updates);
}

export async function toggleDailyTaskComplete(id: string): Promise<DailyTask | null> {
  if (await isCloudUser()) return api.toggleDailyTaskComplete(id);
  return storage.toggleDailyTaskComplete(id);
}

export async function incrementTaskPomodoro(id: string): Promise<DailyTask | null> {
  if (await isCloudUser()) return api.incrementTaskPomodoro(id);
  return storage.incrementTaskPomodoro(id);
}

export async function deleteDailyTask(id: string): Promise<void> {
  if (await isCloudUser()) return api.deleteDailyTask(id);
  return storage.deleteDailyTask(id);
}

// ── Repeating Templates ────────────────────────────────────────────────

export async function getRepeatingTemplates(): Promise<RepeatingTaskTemplate[]> {
  if (await isCloudUser()) return api.getRepeatingTemplates();
  return storage.getRepeatingTemplates().filter(t => t.active);
}

export async function addRepeatingTemplate(
  title: string, pomodorosTarget: number, tag?: TaskTagId
): Promise<RepeatingTaskTemplate | null> {
  if (await isCloudUser()) return api.addRepeatingTemplate(title, pomodorosTarget, tag);
  return storage.addRepeatingTemplate(title, pomodorosTarget, tag);
}

export async function removeRepeatingTemplate(id: string): Promise<void> {
  if (await isCloudUser()) return api.removeRepeatingTemplate(id);
  return storage.removeRepeatingTemplate(id);
}

export async function ensureRepeatingTasksForDate(date: string): Promise<DailyTask[]> {
  if (await isCloudUser()) return api.ensureRepeatingTasksForDate(date);
  return storage.ensureRepeatingTasksForDate(date);
}

// ── Migration (localStorage → Supabase) ────────────────────────────────

export async function migrateLocalDataToCloud(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const localUser = storage.getUser();
  if (!localUser) return false;

  // Check if this is a demo user (not a real Supabase user)
  if (localUser.email === 'demo@effortos.app') return false;

  const supabase = createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return false;

  try {
    // Migrate goals (each individually so one failure doesn't block others)
    const localGoals = storage.getGoals();
    for (const goal of localGoals) {
      try {
        // Strip localStorage-only fields; api.createGoal strips id/created_at/updated_at
        await api.createGoal({
          ...goal,
          user_id: authUser.id,
        });
      } catch (e) {
        console.warn('Skipping goal migration for:', goal.title, e);
      }
    }

    // Migrate sessions — strip local IDs, let Supabase generate UUIDs
    const localSessions = storage.getSessions();
    if (localSessions.length > 0) {
      try {
        await supabase.from('sessions').insert(
          localSessions.map(s => ({
            user_id: authUser.id,
            // Don't include goal_id — local IDs won't match Supabase UUIDs
            start_time: s.start_time,
            end_time: s.end_time,
            duration: s.duration,
            status: s.status,
            notes: s.notes,
            manual: s.manual || false,
            device: 'web',
          }))
        );
      } catch (e) {
        console.warn('Skipping session migration:', e);
      }
    }

    // Migrate daily tasks
    const localTasks = storage.getAllDailyTasks();
    if (localTasks.length > 0) {
      try {
        await supabase.from('daily_tasks').insert(
          localTasks.map(t => ({
            user_id: authUser.id,
            title: t.title,
            completed: t.completed,
            repeating: t.repeating,
            pomodoros_target: t.pomodoros_target,
            pomodoros_done: t.pomodoros_done,
            date: t.date,
            tag: t.tag,
            sort_order: t.order || 0,
            completed_at: t.completed_at,
          }))
        );
      } catch (e) {
        console.warn('Skipping daily task migration:', e);
      }
    }

    // Migrate repeating templates
    const localTemplates = storage.getRepeatingTemplates().filter(t => t.active);
    if (localTemplates.length > 0) {
      try {
        await supabase.from('repeating_templates').insert(
          localTemplates.map(t => ({
            user_id: authUser.id,
            title: t.title,
            pomodoros_target: t.pomodoros_target,
            tag: t.tag,
          }))
        );
      } catch (e) {
        console.warn('Skipping template migration:', e);
      }
    }

    // Clear localStorage after migration attempt
    storage.clearAllData();
    // Re-cache the cloud user in localStorage for fast access
    const cloudUser = await api.getUser();
    if (cloudUser) storage.setUser(cloudUser);

    return true;
  } catch (err) {
    console.warn('Migration failed:', err);
    return false;
  }
}

// ── Convenience re-exports (sync, localStorage-only) ───────────────────

export const setUser = storage.setUser;
export const createDemoUser = storage.createDemoUser;
export const clearAllData = storage.clearAllData;
