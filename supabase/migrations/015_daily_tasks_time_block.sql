-- =====================================================================
-- 015_daily_tasks_time_block.sql
-- Adds the `time_block` column to `daily_tasks` so users can drag tasks
-- onto a coarse morning / afternoon / evening grid (the "Schedule" view
-- in the Daily Grind).
--
-- Why three buckets and not hourly slots: the goal is gentle planning
-- without imposing a rigid timetable that wrecks discipline the moment
-- a meeting runs over. Hourly granularity is on the roadmap as a future
-- migration that will swap CHECK for an INTEGER hour column (or add a
-- companion `time_hour` column alongside this one). The CHECK constraint
-- is intentionally easy to relax later — same trade-off as `journal_entries.mood`.
--
-- Tasks default to NULL ("Unscheduled"), which keeps the existing list
-- view unchanged for users who never opt into time boxing.
-- =====================================================================

ALTER TABLE public.daily_tasks
  ADD COLUMN IF NOT EXISTS time_block TEXT
    CHECK (time_block IN ('morning','afternoon','evening'));

-- Partial index: most installs will have plenty of unscheduled tasks
-- (the default). Index only the rows that ARE scheduled, since that's
-- what the Schedule view's per-block queries hit.
CREATE INDEX IF NOT EXISTS idx_daily_tasks_time_block
  ON public.daily_tasks(user_id, date, time_block)
  WHERE time_block IS NOT NULL;

-- RLS: existing "Users CRUD own daily tasks" policy continues to gate
-- by `user_id = auth.uid()`, which already covers reads and writes of
-- this column. No policy changes required.
