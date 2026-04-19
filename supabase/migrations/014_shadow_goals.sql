-- =====================================================================
-- 014_shadow_goals.sql
-- "Shadow goals" are the someday-shelf for goal ideas the user wants to
-- park without committing to estimation, scheduling, or activation. They
-- live entirely separately from `goals` because:
--   - real goals carry estimation/recommended_sessions/state machinery
--     that doesn't apply to a half-formed idea
--   - shadows aren't surfaced anywhere outside the dedicated shelf, so
--     keeping the `goals` table lean keeps the active-goal queries fast
--   - "promote shadow → real goal" is a one-way flow that destroys the
--     shadow row, which is much cleaner with two tables than a status
--     enum gymnastics on `goals`
--
-- ON DELETE CASCADE matches the rest of the per-user tables — when a
-- profile is deleted the account-delete flow relies on FK cascades.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.shadow_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  -- Free-form context: why this matters, rough scope, links, anything the
  -- user wants future-self to see when they revisit the shelf. Defaults to
  -- empty so the add-form can be title-only.
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shelf is rendered newest-first; this index covers that read path and
-- also any per-user count queries.
CREATE INDEX IF NOT EXISTS idx_shadow_goals_user_created
  ON public.shadow_goals(user_id, created_at DESC);

-- updated_at trigger — same pattern as journal_entries / daily_tasks.
CREATE OR REPLACE FUNCTION public.touch_shadow_goal_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shadow_goals_touch_updated_at
  ON public.shadow_goals;
CREATE TRIGGER trg_shadow_goals_touch_updated_at
  BEFORE UPDATE ON public.shadow_goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_shadow_goal_updated_at();

-- RLS: standard "user owns their rows" — matches goals, daily_tasks,
-- journal_entries, sessions, etc.
ALTER TABLE public.shadow_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users CRUD own shadow goals"
  ON public.shadow_goals
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
