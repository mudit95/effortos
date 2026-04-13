-- Migration 007: Webhook hardening.
-- 1) Add 'past_due' to the subscriptions.status CHECK constraint so halted
--    subscriptions can be recovered when the customer updates their card.
-- 2) Add a webhook_events table for idempotency + audit trail of every
--    Razorpay webhook we've processed.

-- 1) Loosen the status check to include past_due
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired', 'none'));

-- 2) Webhook event log (idempotency + audit trail)
CREATE TABLE IF NOT EXISTS webhook_events (
  -- Razorpay event id (unique per event, used for dedup)
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  event_type TEXT NOT NULL,
  subscription_id TEXT,      -- razorpay_subscription_id
  payment_id TEXT,            -- razorpay_payment_id (if any)
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'failed', 'ignored')),
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_sub ON webhook_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at DESC);

-- RLS — admin read only
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically, so only need a read policy for admins
CREATE POLICY "Admins can view webhook events"
  ON webhook_events FOR SELECT
  USING (check_is_admin(auth.uid()));
