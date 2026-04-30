-- =====================================================================
-- 027: Consent log
--
-- DPDP Act §6 + GDPR Art. 7 require a record of when a user gave or
-- withdrew consent for non-essential data processing (analytics, error
-- monitoring, marketing email). This table is the durable record —
-- separate from email_preferences (which is operational) and the
-- localStorage-backed banner state (which the user can clear at any time).
--
-- We store the SUBJECT (the user) and the SCOPE (which kinds of
-- processing they consented to). For unauthenticated visitors who hit
-- the banner before signing up, the user_id is NULL and the row is
-- keyed only by anonymous_id (a UUID stored in their browser cookie);
-- once they sign up we attach user_id retroactively.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.consent_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Anonymous browser id, stored in a first-party cookie. Lets pre-signup
  -- consent be tied back to the eventual account.
  anonymous_id    TEXT,
  -- Boolean flags per processing scope. Add new columns as new scopes
  -- appear; never remove a column without an audit-friendly migration.
  analytics       BOOLEAN NOT NULL DEFAULT FALSE,
  error_tracking  BOOLEAN NOT NULL DEFAULT FALSE,
  marketing       BOOLEAN NOT NULL DEFAULT FALSE,
  -- The actual banner version the user saw — useful when copy changes
  -- and you want to know who agreed to which wording.
  banner_version  TEXT NOT NULL DEFAULT 'v1',
  request_ip      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Either user_id or anonymous_id must be set (preferably both, when
-- known). We don't enforce via CHECK because some pre-signup writes may
-- happen with anonymous_id only and we want flexibility.
CREATE INDEX IF NOT EXISTS idx_consent_user_time
  ON public.consent_log(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_anon_time
  ON public.consent_log(anonymous_id, created_at DESC) WHERE anonymous_id IS NOT NULL;

ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;

-- Users see their own consent history.
CREATE POLICY consent_log_select_own ON public.consent_log
  FOR SELECT
  USING (auth.uid() = user_id);

-- Admin can see everything (for compliance subject-access requests).
CREATE POLICY consent_log_admin_select ON public.consent_log
  FOR SELECT
  USING (check_is_admin(auth.uid()));

-- No INSERT/UPDATE/DELETE policies = service-role only writes.
-- The /api/consent endpoint owns inserts; we never UPDATE, only INSERT
-- a new row when consent changes (audit-friendly, append-only).
