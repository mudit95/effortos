-- =====================================================================
-- 040: Lapse-reason capture table
--
-- When a user returns after a 7+ day dormancy, the app surfaces a
-- gentle 4-button survey: "What's been blocking you?" The user picks
-- one of {work, health, motivation, life_event} and we record it
-- here. The data feeds:
--
--   - The recovery card's tuned-message logic (different message per
--     reason — "work crunch" gets a different empathy beat than
--     "lost motivation").
--   - Aggregate analytics on what kinds of blockers correlate with
--     long-term churn vs. recovery, so the coach engine can adapt.
--
-- We DO NOT use this for marketing or shaming. The privacy contract
-- is: only service-role can read aggregate counts; users can read
-- their own rows; nothing is ever sent to third parties.
--
-- Apply via Supabase dashboard SQL editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.lapse_reasons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Days the user was dormant before returning. Captured at survey
  -- time so we can correlate "longer lapse → which reasons predict
  -- recovery vs. churn".
  days_dormant INT NOT NULL CHECK (days_dormant >= 0),
  reason       TEXT NOT NULL CHECK (reason IN (
    'work',          -- Crunch / deadline / meetings overrun
    'health',        -- Illness, injury, mental health
    'motivation',    -- Lost the spark / felt pointless
    'life_event',    -- Move, family, travel, anything outside the system
    'other'          -- Free-text fallback (kept short via UI cap)
  )),
  -- Optional 200-char free-form note. Most users skip it; for the few
  -- who write something, it's the gold-mine signal for product-side
  -- empathy work. Capped at the API layer to prevent storage bloat.
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot read: "has this user already submitted a lapse-reason for the
-- current dormancy episode?" — we don't want to show the survey
-- twice in the same recovery window. The query is by user_id, most
-- recent first.
CREATE INDEX IF NOT EXISTS idx_lapse_reasons_user_recent
  ON public.lapse_reasons(user_id, created_at DESC);

ALTER TABLE public.lapse_reasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own lapse reasons" ON public.lapse_reasons;
CREATE POLICY "Users read own lapse reasons"
  ON public.lapse_reasons FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own lapse reasons" ON public.lapse_reasons;
CREATE POLICY "Users insert own lapse reasons"
  ON public.lapse_reasons FOR INSERT
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.lapse_reasons IS
  'Captured per recovery event. One row per (user, return-after-lapse) survey submission. Used by the recovery card to tune the welcome-back message and by aggregate analytics to understand churn drivers. Never sent off-platform.';
