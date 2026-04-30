-- =====================================================================
-- 022: RLS Hardening
--
-- Closes 4 security holes flagged in the launch-readiness audit:
--
--   1. subscriptions had `FOR ALL USING (true) WITH CHECK (true)` —
--      effectively granting every authenticated user INSERT/UPDATE/DELETE
--      on every subscription row (own and other users'). The comment
--      claimed it was for service role, but service role bypasses RLS by
--      default — the policy only ever applied to authenticated users.
--
--   2. coach_log had the same pattern.
--
--   3. The `pact_user_stats` view was created without `security_invoker`,
--      so it ran as the view owner (postgres/superuser), bypassing RLS
--      on the underlying profiles + sessions tables. Any authenticated
--      user could SELECT every other user's 7-day session count and name.
--
--   4. `redeem_coupon_atomic(p_user_id, p_code)` accepted any user_id
--      from the caller and inserted that into coupon_redemptions. With
--      `EXECUTE TO authenticated`, any logged-in user could call:
--        rpc('redeem_coupon_atomic', { p_user_id: '<other>', p_code:'X' })
--      and burn coupons against another user's account.
--
-- After this migration, server-side mutating writes to `subscriptions`
-- and `coach_log` MUST go through a service-role client. The
-- corresponding API route changes ship in the same PR — see
--   src/app/api/admin/users/extend-trial/route.ts
--   src/app/api/admin/users/grant-premium/route.ts
--   src/app/api/subscription/{cancel,create,verify}/route.ts
--   src/app/api/coupons/redeem/route.ts
-- =====================================================================

-- ── 1. subscriptions ────────────────────────────────────────────────
-- Drop the broken policy. Service role bypasses RLS automatically;
-- no replacement policy is needed. The pre-existing SELECT policy
-- ("Users can view own subscription") stays — that's the only path
-- non-service-role callers should have.
DROP POLICY IF EXISTS "Service role can manage subscriptions" ON public.subscriptions;


-- ── 2. coach_log ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role manages coach log" ON public.coach_log;


-- ── 3. pact_user_stats view ─────────────────────────────────────────
-- security_invoker = true makes the view evaluate RLS as the *caller*,
-- not the view owner — so the underlying profiles / sessions policies
-- apply to anyone selecting from this view. Requires Postgres 15+
-- (Supabase runs 15+).
ALTER VIEW public.pact_user_stats SET (security_invoker = true);


-- ── 4. redeem_coupon_atomic — bind to auth.uid() ───────────────────
-- Replace the function so it refuses to redeem on behalf of a user
-- other than the authenticated caller. Service-role callers (where
-- auth.uid() is NULL) are still trusted — this matches the existing
-- contract that admin endpoints can run with elevated privileges.
--
-- We also pin search_path explicitly to defeat schema-shadowing
-- attacks against SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION redeem_coupon_atomic(
  p_user_id UUID,
  p_code    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_coupon        RECORD;
  v_normalized    TEXT := upper(trim(p_code));
  v_already       UUID;
  v_caller        UUID := auth.uid();
BEGIN
  -- Cross-user redemption guard.
  -- For authenticated callers (auth.uid() is non-NULL), p_user_id MUST
  -- match. Service-role callers have NULL auth.uid() and are exempted —
  -- they're already trusted to identify users correctly.
  IF v_caller IS NOT NULL AND v_caller IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'forbidden',
                              'message', 'Cannot redeem on behalf of another user');
  END IF;

  -- Lock the coupon row so concurrent redemptions serialise.
  SELECT *
    INTO v_coupon
    FROM coupons
   WHERE code = v_normalized
     AND active = TRUE
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'not_found',
                              'message', 'Invalid or inactive code');
  END IF;

  -- Expired?
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < NOW() THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'expired',
                              'message', 'This code has expired');
  END IF;

  -- Cap reached?
  IF v_coupon.max_redemptions IS NOT NULL
     AND v_coupon.redemption_count >= v_coupon.max_redemptions THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'max_reached',
                              'message', 'Code has reached its redemption limit');
  END IF;

  -- Already redeemed by this user?
  SELECT id INTO v_already
    FROM coupon_redemptions
   WHERE coupon_id = v_coupon.id
     AND user_id  = p_user_id
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'already_redeemed',
                              'message', 'You have already redeemed this code');
  END IF;

  -- For percent_off: DO NOT record or increment — checkout path finalises.
  -- We still return the coupon metadata so the caller can forward razorpay_offer_id.
  IF v_coupon.kind = 'percent_off' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'kind', 'percent_off',
      'percent', v_coupon.discount_value,
      'coupon_id', v_coupon.id,
      'code', v_coupon.code,
      'razorpay_offer_id', v_coupon.razorpay_offer_id
    );
  END IF;

  -- For trial_extension / free_months: record the redemption + bump counter
  -- atomically with the caller's subscription update (the API follows up
  -- with the subscriptions-table write right after this returns).
  INSERT INTO coupon_redemptions (coupon_id, user_id)
    VALUES (v_coupon.id, p_user_id);

  UPDATE coupons
     SET redemption_count = redemption_count + 1
   WHERE id = v_coupon.id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'kind', v_coupon.kind,
    'value', v_coupon.discount_value,
    'coupon_id', v_coupon.id,
    'code', v_coupon.code
  );
END;
$$;

-- Re-grant permissions (CREATE OR REPLACE preserves them, but be explicit).
REVOKE ALL ON FUNCTION redeem_coupon_atomic(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION redeem_coupon_atomic(UUID, TEXT) TO authenticated, service_role;
