-- =====================================================================
-- 012_daily_tasks_goal_id.sql
-- Adds the `goal_id` column to `daily_tasks` so a task can be linked to
-- a goal. The TypeScript `DailyTask` type and the store have been
-- carrying `goal_id` for a while, and `updateDailyTask` in src/lib/api.ts
-- was recently extended to write it — but the column itself was never
-- added, so cloud users silently lost the association on every write.
--
-- `ON DELETE SET NULL` keeps orphaned tasks around when a goal is
-- deleted (matches the behaviour of `sessions.goal_id` in migration.sql).
-- =====================================================================

ALTER TABLE public.daily_tasks
  ADD COLUMN IF NOT EXISTS goal_id UUID
    REFERENCES public.goals(id) ON DELETE SET NULL;

-- Partial index: most daily tasks won't have a goal, so we index only the
-- rows that do. Used by per-goal rollups (e.g. "tasks linked to goal X").
CREATE INDEX IF NOT EXISTS idx_daily_tasks_goal
  ON public.daily_tasks(goal_id)
  WHERE goal_id IS NOT NULL;

-- RLS: the existing "Users CRUD own daily tasks" policy already gates by
-- `user_id = auth.uid()`, and goals are gated the same way, so no policy
-- changes are required. A user can only set `goal_id` to a goal they own
-- via the UI — if someone crafts a request to reference another user's
-- goal the foreign-key constraint will still accept it at the DB level
-- (RLS doesn't check references), so we validate on the API side before
-- writing. TODO: add a CHECK constraint that asserts the referenced
-- goal belongs to the same user_id — doable with a trigger since CHECK
-- can't run subqueries.
