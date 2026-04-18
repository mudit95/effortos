-- =====================================================================
-- 011_coupon_atomic_redeem.sql
-- Atomic coupon redemption — prevents the TOCTOU race where two
-- concurrent calls both read coupon.redemption_count < max_redemptions
-- and then both increment, allowing the cap to be exceeded.
--
-- The function:
--   1. Locks the coupon row (FOR UPDATE)
--   2. Re-checks active, expires_at, and max_redemptions against the locked row
--   3. Refuses if the user has already redeemed
--   4. Inserts coupon_redemptions + increments the counter in the same txn
--
-- It returns a JSONB payload the API layer uses to branch its response.
-- For 'percent_off' coupons the function only reserves (does not increment)
-- because the actual redemption is only finalized at checkout — matching
-- the existing route behaviour.
-- =====================================================================

CREATE OR REPLACE FUNCTION redeem_coupon_atomic(
  p_user_id UUID,
  p_code    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon        RECORD;
  v_normalized    TEXT := upper(trim(p_code));
  v_already       UUID;
BEGIN
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

-- Only authenticated users can redeem on their own behalf. The API passes
-- auth.uid() explicitly (so the function works with service-role too, but
-- authenticated callers are the primary use case via the REST /rpc path).
REVOKE ALL ON FUNCTION redeem_coupon_atomic(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION redeem_coupon_atomic(UUID, TEXT) TO authenticated, service_role;
