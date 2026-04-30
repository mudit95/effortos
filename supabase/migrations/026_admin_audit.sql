-- =====================================================================
-- 026: Admin audit trail
--
-- Every admin endpoint that mutates billing or access state (extend-trial,
-- grant-premium, set-admin, coupon create/disable, custom email send) had
-- no record of WHO did WHAT WHEN. With two admins on a small team and
-- one stressful day, you cannot tell which admin extended a 90-day trial
-- "by accident." Compliance reviews (SOC 2 type 1, India DPDP §10) also
-- expect privileged-action logging.
--
-- This table is append-only operationally — no UPDATE policy, no DELETE
-- policy, only INSERT (via service-role) and SELECT (admins only). The
-- retention-sweep cron deliberately leaves it alone; an audit log that
-- prunes itself is a marketing exercise.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who performed the action. References auth.users via profiles to
  -- benefit from the existing FK cascade — if an admin is deleted their
  -- audit trail stays via NULL (we never want to lose the record itself).
  actor_user_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Stable string identifying the action — see lib/adminAudit.ts for
  -- the canonical list.
  action_type     TEXT NOT NULL,
  -- Optional target user (extend-trial / grant-premium / set-admin all
  -- act on a target). NULL when the action isn't user-scoped (e.g.,
  -- a coupon create that doesn't yet have a redeemer).
  target_user_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Free-form payload. Holds the relevant args (days, months, tier,
  -- coupon code, etc.) — useful for support-ticket triage and as
  -- evidence in disputes.
  payload         JSONB,
  -- Calling IP, captured best-effort from request headers. Useful when
  -- investigating a credential-leak scenario.
  request_ip      TEXT,
  -- User-agent of the admin browser. Same forensics motivation as IP.
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_actor_time
  ON public.admin_actions(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_time
  ON public.admin_actions(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_type_time
  ON public.admin_actions(action_type, created_at DESC);

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

-- Admin SELECT — uses the existing check_is_admin() function from migration 004.
CREATE POLICY admin_actions_admin_select ON public.admin_actions
  FOR SELECT
  USING (check_is_admin(auth.uid()));

-- No INSERT/UPDATE/DELETE policies = only the service-role client can
-- write. Every audit insert must go through lib/adminAudit.ts so the
-- shape of `payload` stays consistent.
