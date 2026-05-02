-- =====================================================================
-- 034: Subscription pause flow
--
-- Cancellation today is a binary all-or-nothing — users who'd take a
-- short break instead are forced to choose between "stay paying" and
-- "lose access." This migration adds a third state: paused.
--
-- Pause semantics:
--   - status = 'paused'        — no charges, no premium access
--   - paused_at = pause time   — when the user clicked Pause
--   - manual resume only       — user clicks "Resume" in Settings,
--                                we call Razorpay subscriptions.resume,
--                                status flips back to active.
--
-- Razorpay maps cleanly: subscriptions.pause(id, { pause_at: 'now' })
-- suspends future charges; subscriptions.resume(id, { resume_at: 'now' })
-- restarts the cycle. The webhook delivers subscription.paused +
-- subscription.resumed events which we use as belt-and-braces sync.
--
-- Why no auto-resume cron in v1: keeps the surface area small. A user
-- who clicks Pause and forgets about it is in the same shape as one
-- who clicks Cancel and forgets. The Settings UI surfaces a clear
-- "Resume" CTA when the subscription is paused so they can revive it
-- in one click. Auto-resume can be a follow-up if data shows users
-- expect it (the SaaS-standard pattern is manual).
--
-- Past-due users CANNOT pause: they need to fix payment first. The
-- /api/subscription/pause endpoint enforces this; the schema doesn't
-- need to (CHECK lists 'paused' as one of many valid states).
--
-- Apply via Supabase dashboard SQL editor (per HANDOFF.md gotcha #17).
-- =====================================================================

-- 1. Loosen the status CHECK to allow 'paused'.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired', 'none'));

-- 2. paused_at column. NULL except when status = 'paused'. We use this
--    for the SettingsModal "Paused since X" line and for any future
--    "auto-resume after 30d" cron.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

COMMENT ON COLUMN public.subscriptions.paused_at IS
  'When the user paused the subscription (NULL otherwise). Set by /api/subscription/pause; cleared by /api/subscription/resume.';
