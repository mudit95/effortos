-- =====================================================================
-- 029: Per-user data-creation caps (database triggers)
--
-- The audit flagged that a logged-in attacker can blow up user-owned
-- tables — spam 10k daily_tasks, 50k sessions, etc. — and retention-
-- sweep doesn't touch user-owned data, so the rows stick around forever.
--
-- Triggers (rather than client-side checks or RLS) because:
--   1. Multiple INSERT paths exist: client-direct via supabase-js, server
--      cron, admin batch ops. Triggers catch every path uniformly.
--   2. RLS can't easily express "count + reject" — only USING/WITH CHECK
--      predicates that are evaluated per-row.
--   3. Service role bypasses these triggers' counting in practice because
--      cron handlers don't INSERT on behalf of users (they update existing
--      rows). If any server-side path does need to bypass for a legit
--      batch operation, it can use a direct SQL bypass via the service
--      client. None do today.
--
-- Caps mirror lib/dataCaps.ts:
--   goals (active+paused)  : 50
--   daily_tasks per day    : 200
--   sessions per day       : 50  (UTC day, close enough for abuse-catching)
-- =====================================================================

-- ── 1. goals: active + paused per user ─────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_active_goals_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Only check on inserts that are themselves active/paused — completing
  -- a goal shouldn't be blocked even if the user is at the cap.
  IF NEW.status NOT IN ('active', 'paused') THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO v_count
    FROM goals
   WHERE user_id = NEW.user_id
     AND status IN ('active', 'paused');
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'active_goals_cap_exceeded'
      USING HINT = 'Maximum 50 active or paused goals per user.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS goals_active_cap ON public.goals;
CREATE TRIGGER goals_active_cap
  BEFORE INSERT ON public.goals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_active_goals_cap();


-- ── 2. daily_tasks: per (user, date) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_daily_tasks_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM daily_tasks
   WHERE user_id = NEW.user_id
     AND date = NEW.date;
  IF v_count >= 200 THEN
    RAISE EXCEPTION 'daily_tasks_cap_exceeded'
      USING HINT = 'Maximum 200 tasks per day per user.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_tasks_cap ON public.daily_tasks;
CREATE TRIGGER daily_tasks_cap
  BEFORE INSERT ON public.daily_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_daily_tasks_cap();


-- ── 3. sessions: per user per UTC day ──────────────────────────────
-- We use UTC day rather than user-local day for two reasons:
--   1. The trigger doesn't know the user's timezone without an extra
--      profiles lookup, which we'd rather avoid in the hot path.
--   2. A 50/day cap is generous enough that off-by-a-few-hours doesn't
--      meaningfully change abuse detection. UTC midnight matches the
--      cron-helpers pattern and the coach_log unique index from migration 025.
CREATE OR REPLACE FUNCTION public.enforce_sessions_per_day_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count       INT;
  v_day_start   TIMESTAMPTZ;
  v_day_end     TIMESTAMPTZ;
BEGIN
  v_day_start := date_trunc('day', NEW.start_time AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_day_end   := v_day_start + INTERVAL '1 day';
  SELECT COUNT(*) INTO v_count
    FROM sessions
   WHERE user_id = NEW.user_id
     AND start_time >= v_day_start
     AND start_time <  v_day_end;
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'sessions_per_day_cap_exceeded'
      USING HINT = 'Maximum 50 sessions per day per user.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_per_day_cap ON public.sessions;
CREATE TRIGGER sessions_per_day_cap
  BEFORE INSERT ON public.sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sessions_per_day_cap();
