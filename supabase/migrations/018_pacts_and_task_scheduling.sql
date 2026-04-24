-- 018: Accountability Pacts + Task Scheduling (plan-tomorrow)
-- ============================================================

-- ── 1. Accountability Pacts ─────────────────────────────────
-- Lightweight 1:1 "pact" between two users. Each user can have
-- multiple pacts. Partners see each other's streak and weekly
-- completion rate — nothing else.

CREATE TABLE IF NOT EXISTS public.pacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_email TEXT NOT NULL,
  partner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  invite_code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined', 'ended')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ
);

-- Index for fast lookup by partner
CREATE INDEX IF NOT EXISTS idx_pacts_partner ON public.pacts(partner_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_pacts_invite ON public.pacts(invite_code) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pacts_user ON public.pacts(user_id);

-- RLS
ALTER TABLE public.pacts ENABLE ROW LEVEL SECURITY;

-- Users can see pacts they're involved in
CREATE POLICY pacts_select ON public.pacts FOR SELECT USING (
  auth.uid() = user_id OR auth.uid() = partner_user_id
);

-- Users can insert pacts they create
CREATE POLICY pacts_insert ON public.pacts FOR INSERT WITH CHECK (
  auth.uid() = user_id
);

-- Users can update pacts they're involved in (accept/decline/end)
CREATE POLICY pacts_update ON public.pacts FOR UPDATE USING (
  auth.uid() = user_id OR auth.uid() = partner_user_id
);

-- Service role bypass for cron / admin
CREATE POLICY pacts_service ON public.pacts FOR ALL USING (
  auth.role() = 'service_role'
);


-- ── 2. Daily Tasks — scheduled_date for plan-tomorrow ───────
-- Allows tasks to be created today for a future date. The
-- existing `date` column represents when the task appears;
-- `scheduled_date` is the date the user planned it on (optional,
-- null means it was planned on its own date).

ALTER TABLE public.daily_tasks
  ADD COLUMN IF NOT EXISTS scheduled_from DATE;

-- Comment: scheduled_from = the date when the user planned this
-- task via the "plan tomorrow" flow. NULL = created normally on
-- its own date. This lets us show "carried forward from Apr 22"
-- in the UI.


-- ── 3. Pact stats view (helper for API) ─────────────────────
-- Returns each user's current streak and 7-day completion rate
-- for sharing with pact partners. Uses the sessions table.

CREATE OR REPLACE VIEW public.pact_user_stats AS
SELECT
  p.id AS user_id,
  p.name,
  COALESCE(
    (SELECT COUNT(DISTINCT DATE(s.created_at))
     FROM public.sessions s
     WHERE s.user_id = p.id
       AND s.status = 'completed'
       AND s.created_at >= now() - INTERVAL '7 days'),
    0
  )::INT AS active_days_7d,
  COALESCE(
    (SELECT COUNT(*)
     FROM public.sessions s
     WHERE s.user_id = p.id
       AND s.status = 'completed'
       AND s.created_at >= now() - INTERVAL '7 days'),
    0
  )::INT AS sessions_7d
FROM public.profiles p;
