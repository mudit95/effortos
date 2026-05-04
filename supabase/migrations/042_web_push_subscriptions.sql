-- =====================================================================
-- 042: Web Push subscriptions
--
-- One row per device-subscription. Each browser the user grants push
-- permission on creates a row keyed by the unique endpoint URL the
-- browser issues. We send via VAPID — see /api/push/send.
--
-- Lifecycle:
--   - INSERT on first /api/push/subscribe call from a browser
--   - DELETE on /api/push/unsubscribe (browser-side unsubscribe) OR
--     when /api/push/send gets a 410 Gone from the push service
--     (the browser cleared the subscription)
--
-- We store keys (p256dh + auth) so the server can encrypt the
-- payload. Without these the push service rejects the send.
--
-- Apply via Supabase dashboard SQL editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Endpoint URL is unique per (user, browser). The PRIMARY KEY would
  -- be more natural here but it's a long URL so we keep id as the PK
  -- and add UNIQUE on endpoint.
  endpoint      TEXT NOT NULL UNIQUE,
  -- Encryption key material from PushSubscription.toJSON().
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  -- Optional UA string for debugging "which device is this from".
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Bumped on every successful send. Stale subscriptions (no successful
  -- send in 90 days) get pruned by retention-sweep.
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscriptions (powers a "show my devices"
-- panel in Settings).
DROP POLICY IF EXISTS "Users read own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users read own push subscriptions"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role manages writes. The /api/push/subscribe + /api/push/send
-- endpoints both run service-role.
COMMENT ON TABLE public.push_subscriptions IS
  'Per-(user, browser) Web Push subscription. Encryption keys stored so /api/push/send can encrypt payloads. Pruned at 90 days of inactivity by retention-sweep.';
