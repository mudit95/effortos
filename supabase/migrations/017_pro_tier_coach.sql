-- ============================================================
-- 017: Pro Tier + AI Coach System
-- Adds plan_tier to subscriptions, coach_log table,
-- and coaching preferences to profiles.
-- ============================================================

-- 1. Add plan_tier to subscriptions ('starter' or 'pro')
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan_tier IN ('starter', 'pro'));

-- 2. Add coaching preferences to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS coaching_intensity TEXT NOT NULL DEFAULT 'balanced'
    CHECK (coaching_intensity IN ('light', 'balanced', 'intense')),
  ADD COLUMN IF NOT EXISTS coaching_quiet_start INT NOT NULL DEFAULT 22,  -- 10 PM
  ADD COLUMN IF NOT EXISTS coaching_quiet_end INT NOT NULL DEFAULT 7,     -- 7 AM
  ADD COLUMN IF NOT EXISTS coaching_paused_until TIMESTAMPTZ;             -- null = not paused

-- 3. Coach log table — tracks every nudge sent
CREATE TABLE IF NOT EXISTS public.coach_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nudge_type    TEXT NOT NULL,
  -- nudge_type values: morning_kickoff, midday_checkin, evening_wrapup,
  --   streak_saver, idle_detection, goal_milestone, weekly_recap,
  --   pace_warning, task_planning_prompt, bad_day_check,
  --   welcome, plan_tomorrow
  message_sent  TEXT NOT NULL,
  delivered     BOOLEAN NOT NULL DEFAULT true,
  context_json  JSONB,            -- snapshot of user state at send time
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_log_user_date
  ON public.coach_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coach_log_type
  ON public.coach_log(user_id, nudge_type, created_at DESC);

ALTER TABLE public.coach_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own coach log (for future "coaching history" UI)
CREATE POLICY "Users read own coach log"
  ON public.coach_log FOR SELECT
  USING (auth.uid() = user_id);

-- Service role inserts (cron endpoint runs with service role)
CREATE POLICY "Service role manages coach log"
  ON public.coach_log FOR ALL
  USING (true)
  WITH CHECK (true);
