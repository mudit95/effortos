-- =====================================================================
-- 035: Streak freezes + lapse tracking
--
-- Streak preservation is the dominant retention mechanic in
-- Pomodoro/habit apps. Industry data is unambiguous: ~80% of users
-- who break a 30+ day streak never return. Today's getStreaks() is
-- unforgiving — a single missed day is terminal. This migration adds
-- a "freeze" concept: a token the user can spend (proactively or
-- retroactively within 24h) to protect a missed day, plus an
-- auto-apply cron path that consumes tokens at user-local midnight
-- when a streak would otherwise break.
--
-- Design contract: see /Users/muditmohilay/Downloads/Pomodoro_app/effortos/STREAK_FREEZES_DESIGN.md
--
-- Defaults baked in:
--   - 1/month freeze tokens free tier, 3/month Pro
--   - Auto-apply only protects streaks ≥ 3 days (below that the user
--     hasn't built habit muscle and protection masks activation)
--   - Retroactive freeze allowed within 24h of the missed day
--   - 7-day lapse threshold drives the welcome-back recovery flow
--
-- Apply via Supabase dashboard SQL editor (per HANDOFF.md gotcha #17).
-- =====================================================================

-- 1. streak_freezes — append-only ledger of consumed freezes.
--
-- One row per (user, date). UNIQUE prevents double-claiming a single
-- calendar day. We never UPDATE or DELETE rows; the count of rows in
-- the current month is the record of what's been spent.
CREATE TABLE IF NOT EXISTS public.streak_freezes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Calendar date (user-local) the freeze covers — i.e., the day the
  -- streak would otherwise have broken. Stored as DATE (no tz info)
  -- because streaks are always evaluated in the user's local frame.
  date        DATE NOT NULL,
  -- 'auto' = applied by midnight cron once we ship it.
  -- 'manual' = user clicked the "Freeze today" CTA or used the
  --            freeze_streak WhatsApp intent.
  source      TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- Hot read: "all freezes for this user, newest first" (StreakCalendar
-- + getStreaksWithFreezes). Composite (user_id, date DESC) keeps it
-- index-only.
CREATE INDEX IF NOT EXISTS idx_streak_freezes_user_date
  ON public.streak_freezes(user_id, date DESC);

ALTER TABLE public.streak_freezes ENABLE ROW LEVEL SECURITY;

-- Users read their own freeze ledger. Writes are service-role only —
-- the /api/streaks/freeze endpoint and the future cron go through
-- createServiceClient(). Matches the coach_log + wa_conversation_context
-- pattern.
CREATE POLICY "Users read own freezes"
  ON public.streak_freezes FOR SELECT
  USING (auth.uid() = user_id);

-- 2. Per-user token bucket on profiles.
--
-- We could compute remaining-tokens by counting streak_freezes rows
-- in the current month, but a stored counter is simpler to gate the
-- /api/streaks/freeze endpoint atomically (decrement on insert; the
-- claim_freeze_token RPC below does both in one transaction).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS freeze_tokens_remaining INT NOT NULL DEFAULT 1
    CHECK (freeze_tokens_remaining >= 0);

-- When the bucket next replenishes. The replenish cron (deferred,
-- see STREAK_FREEZES_DESIGN.md item 4) reads this on each run and
-- bumps the counter back to the tier maximum when the date passes.
-- DEFAULT NULL until first replenish — interpreted as "not yet
-- scheduled, replenish on next cron pass."
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS freeze_tokens_resets_at DATE;

-- last_session_date — the latest day (user-local) the user completed
-- a focus session. Used by the lapse-recovery flow to detect "first
-- visit after a 7+ day absence" without having to re-aggregate the
-- sessions table on every dashboard load.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_session_date DATE;

COMMENT ON COLUMN public.profiles.freeze_tokens_remaining IS
  'Remaining freeze tokens this month. Defaults: 1 free / 3 Pro. Decremented atomically by claim_freeze_token RPC; replenished by cron when freeze_tokens_resets_at passes.';
COMMENT ON COLUMN public.profiles.freeze_tokens_resets_at IS
  'Date when the freeze-token bucket next replenishes. NULL on a fresh profile = replenish on next cron pass.';
COMMENT ON COLUMN public.profiles.last_session_date IS
  'Latest user-local calendar date with a completed focus session. Drives the 7+ day lapse-recovery modal.';

-- 3. claim_freeze_token RPC — atomic insert+decrement.
--
-- Why a Postgres function: the /api/streaks/freeze endpoint needs
-- "insert into streak_freezes AND decrement freeze_tokens_remaining"
-- to either both happen or neither. PostgREST's REST surface can't
-- bundle two writes atomically, but a SECURITY DEFINER function can.
-- Returns the new remaining-tokens value so the caller can update
-- the UI without a follow-up SELECT.
--
-- Concurrency: the UNIQUE(user_id, date) constraint serialises
-- duplicate-claim attempts. The first call wins; the second sees
-- 23505 and we surface a clean "already frozen" error. The decrement
-- is gated on freeze_tokens_remaining > 0 so a parallel claim that
-- already exhausted the bucket sees CHECK violation cleanly.
CREATE OR REPLACE FUNCTION public.claim_freeze_token(
  p_user_id UUID,
  p_date    DATE,
  p_source  TEXT
)
RETURNS TABLE (
  freeze_id        UUID,
  remaining_tokens INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_freeze_id UUID;
  v_remaining INT;
BEGIN
  -- Reject invalid sources up-front — callers should send
  -- 'auto' or 'manual'. Anything else is a bug at the call site.
  IF p_source NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'invalid source: %', p_source USING ERRCODE = '22023';
  END IF;

  -- Atomic decrement. The CHECK on freeze_tokens_remaining (>= 0)
  -- means a concurrent claim that just zeroed the bucket will fail
  -- here cleanly — caller treats as "no tokens, can't freeze."
  UPDATE public.profiles
     SET freeze_tokens_remaining = freeze_tokens_remaining - 1
   WHERE id = p_user_id
     AND freeze_tokens_remaining > 0
   RETURNING freeze_tokens_remaining INTO v_remaining;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no freeze tokens remaining'
      USING ERRCODE = 'P0002', HINT = 'no_tokens';
  END IF;

  -- Insert the freeze row. UNIQUE(user_id, date) catches
  -- "already frozen this date" — we re-raise with a recognisable
  -- code so the API can return a friendly 409.
  BEGIN
    INSERT INTO public.streak_freezes (user_id, date, source)
    VALUES (p_user_id, p_date, p_source)
    RETURNING id INTO v_freeze_id;
  EXCEPTION WHEN unique_violation THEN
    -- Roll back the decrement we just made — it's the same row
    -- as our UPDATE above so this is purely undo.
    UPDATE public.profiles
       SET freeze_tokens_remaining = freeze_tokens_remaining + 1
     WHERE id = p_user_id;
    RAISE EXCEPTION 'date already frozen'
      USING ERRCODE = 'P0001', HINT = 'already_frozen';
  END;

  RETURN QUERY SELECT v_freeze_id, v_remaining;
END;
$$;

-- Lock down execute privs to authenticated + service_role only.
-- Anonymous callers should never invoke claim_freeze_token.
REVOKE ALL ON FUNCTION public.claim_freeze_token(UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_freeze_token(UUID, DATE, TEXT) TO authenticated, service_role;
