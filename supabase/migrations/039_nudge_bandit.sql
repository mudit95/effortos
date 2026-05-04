-- =====================================================================
-- 039: Smart nudge timing — Beta-Bernoulli bandit per (user, slot)
--
-- The proactive coach used to fire `morning_kickoff` at 8am local for
-- every user. Per-user circadian patterns vary widely — a 7am person
-- and a 10am person both got the same 8am ping, often missing the
-- moment that would have actually started a session. This migration
-- lays the schema for a bandit that learns each user's best slot.
--
-- V1 scope: `morning_kickoff` only. Candidate slots are local hours
-- 6, 7, 8, 9, 10. Schema generalises to other nudge types so we can
-- flip them on without DB churn.
--
-- Outcome semantics: a nudge is a "success" if the user started a
-- focus session within 30 minutes of delivery. Recorded by the
-- /api/cron/record-nudge-outcomes cron every 5 minutes (migration
-- adds the columns; the cron itself ships in code, not SQL).
--
-- Three additions:
--
--   (a) coach_log gets `nudge_slot`, `outcome`, `outcome_recorded_at`.
--       outcome stays NULL until the backfill cron records it; once
--       recorded it's TRUE/FALSE and feeds the per-user posterior.
--
--   (b) daily_nudge_plan: one row per (user, date, nudge_type)
--       recording the bandit-chosen slot for today. We need this
--       because Thompson sampling is randomised — calling it twice
--       in the same day must yield the same answer or hourly cron
--       runs would disagree. The plan row is the deterministic-cache
--       layer: first eligible cron run of the day samples + inserts;
--       subsequent runs read.
--
--   (c) nudge_slot_priors: population-level Beta(α, β) per slot. New
--       users with <14 outcomes warm-start from these. Updated daily
--       by the priors-rebuild cron from aggregated coach_log.
--
-- Apply via Supabase dashboard SQL editor (per HANDOFF.md gotcha #17).
-- =====================================================================

-- ── 1. coach_log: outcome columns ──────────────────────────────────
ALTER TABLE public.coach_log
  ADD COLUMN IF NOT EXISTS nudge_slot TEXT,
  ADD COLUMN IF NOT EXISTS outcome BOOLEAN,
  ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.coach_log.nudge_slot IS
  'Discrete time-of-day bucket the nudge was sent into (typically the local hour as text, e.g. "8"). NULL on legacy rows pre-mig-039.';
COMMENT ON COLUMN public.coach_log.outcome IS
  'TRUE if user started a focus session within 30 min of delivery; FALSE if no session in that window. NULL until the backfill cron records it.';
COMMENT ON COLUMN public.coach_log.outcome_recorded_at IS
  'When the outcome was determined. Drives the recency cap on backfill so we never re-evaluate old rows.';

-- Index for the priors-rebuild aggregation query
-- "all rows with non-NULL outcome for nudge_type X grouped by slot".
CREATE INDEX IF NOT EXISTS idx_coach_log_outcome
  ON public.coach_log(nudge_type, nudge_slot, outcome)
  WHERE outcome IS NOT NULL;

-- Index for the per-user posterior query
-- "last K outcomes for this (user, nudge_type) per slot".
CREATE INDEX IF NOT EXISTS idx_coach_log_user_nudge_outcome
  ON public.coach_log(user_id, nudge_type, created_at DESC)
  WHERE outcome IS NOT NULL;

-- ── 2. daily_nudge_plan ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_nudge_plan (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Calendar date in user-local frame (YYYY-MM-DD). The cron computes
  -- this from todayKeyInTz before sampling so per-day uniqueness is
  -- in the user's own timezone, not UTC.
  date          DATE NOT NULL,
  nudge_type    TEXT NOT NULL,
  -- Picked slot. For morning_kickoff this is "6"…"10". For future
  -- nudge types it could be a different alphabet ("morning"|"evening"
  -- or hour ranges); the bandit lib treats it as opaque text.
  planned_slot  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date, nudge_type)
);

CREATE INDEX IF NOT EXISTS idx_daily_nudge_plan_user_date
  ON public.daily_nudge_plan(user_id, date);

ALTER TABLE public.daily_nudge_plan ENABLE ROW LEVEL SECURITY;

-- Service role only; the cron is the only writer/reader. Users have
-- no need to see this — it's the bandit's planning ledger.
DROP POLICY IF EXISTS "Service role manages daily nudge plan" ON public.daily_nudge_plan;
CREATE POLICY "Service role manages daily nudge plan"
  ON public.daily_nudge_plan FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.daily_nudge_plan IS
  'Per-(user, date, nudge_type) row recording the bandit-chosen slot for today. Inserted by the proactive-coach cron at first eligible run; read by subsequent runs to keep the day''s plan consistent.';

-- ── 3. nudge_slot_priors ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nudge_slot_priors (
  nudge_type    TEXT NOT NULL,
  slot          TEXT NOT NULL,
  -- Beta(alpha, beta) parameters. Initialised at (1, 1) — uniform
  -- prior — and updated by the priors-rebuild cron from observed
  -- coach_log outcomes. We store as REAL to allow fractional
  -- decay during rebuild (older outcomes weighted less); current
  -- rebuild uses raw counts.
  alpha         REAL NOT NULL DEFAULT 1.0 CHECK (alpha > 0),
  beta          REAL NOT NULL DEFAULT 1.0 CHECK (beta > 0),
  -- Number of observations the priors are computed from. Lets us
  -- distinguish "uniform prior, no data" (n_observations=0) from
  -- "1000 obs, posterior is genuinely flat".
  n_observations INT NOT NULL DEFAULT 0 CHECK (n_observations >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (nudge_type, slot)
);

ALTER TABLE public.nudge_slot_priors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages slot priors" ON public.nudge_slot_priors;
CREATE POLICY "Service role manages slot priors"
  ON public.nudge_slot_priors FOR ALL
  USING (true)
  WITH CHECK (true);

-- Seed the initial rows for morning_kickoff so the first cron run
-- finds them. (1, 1) = uniform prior; the rebuild cron updates from
-- observed outcomes once they accumulate.
INSERT INTO public.nudge_slot_priors (nudge_type, slot, alpha, beta)
VALUES
  ('morning_kickoff', '6',  1.0, 1.0),
  ('morning_kickoff', '7',  1.0, 1.0),
  ('morning_kickoff', '8',  1.0, 1.0),
  ('morning_kickoff', '9',  1.0, 1.0),
  ('morning_kickoff', '10', 1.0, 1.0)
ON CONFLICT (nudge_type, slot) DO NOTHING;

COMMENT ON TABLE public.nudge_slot_priors IS
  'Population-level Beta(alpha, beta) posterior per slot. New users (<14 outcomes for this nudge_type) Thompson-sample from these instead of their sparse own posterior. Updated daily by /api/cron/update-nudge-priors.';
