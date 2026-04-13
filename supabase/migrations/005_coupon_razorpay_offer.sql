-- =====================================================================
-- 005_coupon_razorpay_offer.sql
-- Link percent_off coupons to a pre-created Razorpay Offer.
-- =====================================================================

-- Razorpay Offer IDs (offer_XXX) are created once in the Razorpay dashboard
-- and applied at subscription creation time via the `offer_id` parameter.
-- Admins paste the offer_id into the coupon so our system can forward it.

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS razorpay_offer_id TEXT;

-- We also want to store the coupon on the subscription row so we know
-- which coupon was applied (for analytics and for recording redemption
-- only after the payment is verified).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS applied_coupon_id UUID REFERENCES coupons(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS applied_coupon_code TEXT;
