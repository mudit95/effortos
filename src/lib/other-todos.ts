/**
 * Other To-Dos — client-side data layer for the side-list of non-Pomodoro
 * tasks (errands like "Pick Susan from school" or "Pay phone bill").
 *
 * These are deliberately quarantined from the main daily_tasks flow:
 *   - separate table (other_todos), separate API, separate UI surface
 *   - never start a Pomodoro
 *   - never appear in morning/afternoon nudges
 *   - only the count appears in the nightly recap
 *
 * Mirrors the patterns in src/lib/api.ts (uses the auth-scoped browser
 * client; RLS does the user filtering).
 */

import type { OtherTodo } from '@/types';
import { createClient } from './supabase/client';

function getSupabase() {
  return createClient();
}

function rowToOtherTodo(row: Record<string, unknown>): OtherTodo {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    estimated_minutes: (row.estimated_minutes as number | null) ?? null,
    completed: row.completed as boolean,
    completed_at: (row.completed_at as string | null) ?? null,
    sort_order: Number(row.sort_order),
    created_at: row.created_at as string,
  };
}

/**
 * List the user's other-to-dos. Open ones first (newest first), completed
 * ones at the bottom (most-recently-completed first). The drawer renders
 * completed items collapsed, so we still fetch them but order them last.
 */
export async function listOtherTodos(opts?: {
  includeCompleted?: boolean;
}): Promise<OtherTodo[]> {
  const supabase = getSupabase();
  const includeCompleted = opts?.includeCompleted ?? true;

  let query = supabase
    .from('other_todos')
    .select('*')
    .order('completed', { ascending: true })       // open (false) first
    .order('sort_order', { ascending: false });    // newest first within group

  if (!includeCompleted) {
    query = query.eq('completed', false);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[other-todos] listOtherTodos failed', error);
    return [];
  }
  return (data || []).map(rowToOtherTodo);
}

/**
 * Create a new other-to-do. Title is required; estimated_minutes is
 * optional (null = no estimate). sort_order defaults to ms-epoch on the
 * server, so the new row sorts to the top of "open" automatically.
 */
export async function createOtherTodo(opts: {
  title: string;
  estimated_minutes?: number | null;
}): Promise<OtherTodo | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const trimmed = opts.title.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from('other_todos')
    .insert({
      user_id: user.id,
      title: trimmed.slice(0, 200),
      estimated_minutes: opts.estimated_minutes ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[other-todos] createOtherTodo failed', error);
    return null;
  }
  return rowToOtherTodo(data);
}

/**
 * Update one or more fields on an other-to-do. Only allowlisted columns
 * are forwarded so a malicious caller can't promote, say, user_id.
 */
export async function updateOtherTodo(
  id: string,
  updates: Partial<Pick<OtherTodo, 'title' | 'estimated_minutes' | 'completed'>>,
): Promise<OtherTodo | null> {
  const supabase = getSupabase();
  const safeUpdates: Record<string, unknown> = {};

  if (updates.title !== undefined) {
    const trimmed = updates.title.trim();
    if (!trimmed) return null;
    safeUpdates.title = trimmed.slice(0, 200);
  }
  if (updates.estimated_minutes !== undefined) {
    safeUpdates.estimated_minutes = updates.estimated_minutes;
  }
  if (updates.completed !== undefined) {
    safeUpdates.completed = updates.completed;
    safeUpdates.completed_at = updates.completed ? new Date().toISOString() : null;
  }

  if (Object.keys(safeUpdates).length === 0) return null;

  const { data, error } = await supabase
    .from('other_todos')
    .update(safeUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    console.error('[other-todos] updateOtherTodo failed', error);
    return null;
  }
  return rowToOtherTodo(data);
}

/**
 * Toggle completion. Convenience wrapper around updateOtherTodo so the UI
 * doesn't have to fetch the row first.
 */
export async function toggleOtherTodoComplete(
  id: string,
  currentlyCompleted: boolean,
): Promise<OtherTodo | null> {
  return updateOtherTodo(id, { completed: !currentlyCompleted });
}

export async function deleteOtherTodo(id: string): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase.from('other_todos').delete().eq('id', id);
  if (error) {
    console.error('[other-todos] deleteOtherTodo failed', error);
    return false;
  }
  return true;
}

/**
 * How many open errands the user has. Used by the OtherTodosDrawer trigger
 * (red dot) and the nightly recap one-liner.
 *
 * Uses the auth-scoped client; RLS filters to the calling user.
 */
export async function countOpenOtherTodos(): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from('other_todos')
    .select('id', { count: 'exact', head: true })
    .eq('completed', false);

  if (error) {
    console.error('[other-todos] countOpenOtherTodos failed', error);
    return 0;
  }
  return count ?? 0;
}
