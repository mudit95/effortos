-- =====================================================================
-- 030: Cron run log + watchdog support
--
-- Today's cron jobs (hourly emails, coach, retention-sweep, purge,
-- re-engagement, trial-ending, pacts-cleanup) have no central record
-- of "did this actually fire successfully?" If retention-sweep silently
-- fails for three days, you find out when coach_log fills the disk.
--
-- This table is the canonical "I ran" signal. Every cron route ends with
-- a call to recordCronRun() (see lib/cron-run-log.ts). The watchdog cron
-- (/api/cron/watchdog) reads the most-recent row per cron name and emails
-- the operator if any are stale relative to the cron's expected cadence.
--
-- Retention: this table grows ~7 rows/hour = ~170/day. The retention-
-- sweep cron (migration's already-shipped lib) will prune rows older than
-- 30 days. The watchdog only ever needs the most recent row per name.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cron_run_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable identifier for the cron — matches the pathname under /api/cron/.
  -- Examples: 'morning-email', 'coach', 'retention-sweep'.
  cron_name       TEXT NOT NULL,
  -- 'success' = handler returned 2xx without throwing.
  -- 'failure' = handler threw or returned 5xx.
  -- The watchdog ignores 'failure' rows (they're useful for forensics
  -- but they don't satisfy "this cron ran" — we want a recent success).
  status          TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  -- Caller-supplied details: counts, error message, etc. Stays small.
  details         JSONB,
  -- Wall clock at end of run.
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The watchdog query is "max(ran_at) per cron_name where status='success'".
-- This index supports it cheaply.
CREATE INDEX IF NOT EXISTS idx_cron_run_log_name_status_time
  ON public.cron_run_log(cron_name, status, ran_at DESC);

ALTER TABLE public.cron_run_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read (for an admin "cron health" panel later).
CREATE POLICY cron_run_log_admin_select ON public.cron_run_log
  FOR SELECT
  USING (check_is_admin(auth.uid()));

-- No INSERT/UPDATE/DELETE policies = service-role only writes.
