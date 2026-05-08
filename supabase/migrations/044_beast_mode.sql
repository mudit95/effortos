-- =====================================================================
-- 044: Beast Mode (Pro feature)
--
-- Beast Mode is the opt-in "the bot won't shut up until you do the
-- thing" tier of coaching. When ON, a 30-minute cron checks each user
-- in their evening window (20:00-23:30 local) and pings them via
-- WhatsApp until two conditions are met:
--   1. A journal_entry exists for today.
--   2. daily_tasks for tomorrow have at least one row.
--
-- Why a separate log table instead of reusing coach_log:
-- coach_log has a UNIQUE(user_id, nudge_type, utc_day) index (mig 025)
-- specifically to prevent duplicate sends of the same nudge type in
-- one day. That's the OPPOSITE of what Beast Mode needs — we
-- explicitly want repeated sends of "plan_tomorrow" until the user
-- caves and plans tomorrow. Carving out exceptions to that index is
-- worse than just having a dedicated, simpler audit table.
--
-- Why Pro-gated:
-- Beast Mode is the feature most likely to convert "I tried the free
-- tier" → paid. It's the bot at its highest-value mode. Free users get
-- the smarter nightly nudge (once per day) regardless; only Pro users
-- get the every-30-minute escalation.
-- =====================================================================

-- ── 1. Per-user toggle on profiles ─────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS beast_mode_enabled BOOLEAN NOT NULL DEFAULT false;

-- Optional analytics: when did the user first turn it on, when did
-- they last toggle it. Cheap; lets us study who sticks with Beast Mode
-- vs who tries it once and bails.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS beast_mode_enabled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.beast_mode_enabled IS
  'Pro-gated. When true, /api/cron/beast-mode pings the user every 30 minutes during their evening window until journal + tomorrow plan are recorded.';

-- ── 2. Audit log for beast nudges ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.beast_nudge_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Which gap was the user being pinged about. Lets the cron query
  -- "have I already pinged this user about journal_today in the last
  --  30 minutes?" cheaply via the index below.
  nudge_kind    TEXT NOT NULL CHECK (nudge_kind IN ('plan_tomorrow','journal_today')),
  message_sent  TEXT NOT NULL,
  delivered     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the hot-path read "what's the last beast nudge I sent this
-- user for this kind?" — answered by a single index seek.
CREATE INDEX IF NOT EXISTS idx_beast_nudge_log_user_kind_time
  ON public.beast_nudge_log(user_id, nudge_kind, created_at DESC);

ALTER TABLE public.beast_nudge_log ENABLE ROW LEVEL SECURITY;

-- User can read their own beast nudges (for an admin / coach dashboard
-- in future). No INSERT/UPDATE/DELETE policy = service-role only writes.
CREATE POLICY beast_nudge_log_self_select ON public.beast_nudge_log
  FOR SELECT
  USING (auth.uid() = user_id);
