-- 019: Other To-Dos — lightweight side-list of non-Pomodoro tasks
-- ==============================================================
-- A separate table (not a flag on daily_tasks) so these errands can never
-- accidentally leak into morning/afternoon/nightly nudges, the Pomodoro
-- session counters, or weekly task-completion stats. They live a quiet,
-- parallel life: shown only on the OtherTodosDrawer in the UI and via
-- explicit WhatsApp commands. The nightly recap mentions only the COUNT
-- of open errands, never their titles.
--
-- Design notes:
--   - estimated_minutes is nullable: many errands ("call mom") have no
--     meaningful time estimate; forcing a value would create friction.
--   - No date column: errands aren't bucketed by day. They're a parking
--     lot. If a user wants a dated reminder, that's a daily_task.
--   - sort_order is a BIGINT this time (not INT) so we can use ms-epoch
--     directly without overflow concerns.

CREATE TABLE IF NOT EXISTS public.other_todos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 200),
  estimated_minutes INT  CHECK (estimated_minutes IS NULL OR (estimated_minutes > 0 AND estimated_minutes <= 1440)),
  completed         BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at      TIMESTAMPTZ,
  sort_order        BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: list a user's open errands ordered for the drawer.
CREATE INDEX IF NOT EXISTS idx_other_todos_user_open
  ON public.other_todos(user_id, completed, sort_order DESC);

-- Used by the nightly recap count helper.
CREATE INDEX IF NOT EXISTS idx_other_todos_user_completed
  ON public.other_todos(user_id, completed);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.other_todos ENABLE ROW LEVEL SECURITY;

-- Users can only see their own errands.
CREATE POLICY other_todos_select
  ON public.other_todos FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert errands for themselves.
CREATE POLICY other_todos_insert
  ON public.other_todos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own errands.
CREATE POLICY other_todos_update
  ON public.other_todos FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own errands.
CREATE POLICY other_todos_delete
  ON public.other_todos FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypass (for the WhatsApp webhook + nightly cron).
CREATE POLICY other_todos_service
  ON public.other_todos FOR ALL
  USING (auth.role() = 'service_role');
