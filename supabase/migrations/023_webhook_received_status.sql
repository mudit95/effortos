-- =====================================================================
-- 023: Allow webhook_events.status = 'received'
--
-- The Razorpay webhook handler now uses a two-phase pattern:
--   1. Insert webhook_events row with status='received' BEFORE handler runs
--   2. Flip to status='processed' only on handler success
--
-- This closes a permanent-data-loss bug where a transient handler error
-- (DB blip, network hiccup) would leave a row marked 'processed' even
-- though the side effects never landed. Razorpay's retry would then
-- short-circuit on the dedup PK and the event would be lost forever.
--
-- The pre-existing CHECK constraint only allowed ('processed','failed',
-- 'ignored'). Extending it to include 'received' lets us record the
-- intent-to-process atomically with claiming the event_id.
-- =====================================================================

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_status_check;

ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_status_check
  CHECK (status IN ('received', 'processed', 'failed', 'ignored'));
