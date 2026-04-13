-- Migration 006: De-duplicate subscription rows per user and enforce one row per user.
-- Run this AFTER 005_coupon_razorpay_offer.sql.
--
-- Why: historical admin endpoints used .single() which silently failed when a user
-- had 0 or 2+ rows, causing new INSERTs on every action and leaving duplicates.
-- Going forward we keep exactly one subscriptions row per user; the app logic
-- updates status/trial_ends_at/current_period_end in place.

-- 1) Delete all but the newest row per user_id
WITH ranked AS (
  SELECT id,
         user_id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
  FROM subscriptions
)
DELETE FROM subscriptions
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Enforce uniqueness going forward
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_user_id_unique'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
  END IF;
END$$;
