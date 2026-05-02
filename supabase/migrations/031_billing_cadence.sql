-- =====================================================================
-- 031: Annual billing cadence on subscriptions
--
-- Adds a `billing_cadence` column to subscriptions to distinguish monthly
-- (₹499 / ₹999 per month) from annual plans (₹3,999 / ₹7,999 per year,
-- ~33% off monthly × 12).
--
-- Why a column rather than deriving cadence from the Razorpay plan_id:
--   1. Plan IDs change between test mode and live mode — relying on
--      pattern-matching plan_id strings means UI logic needs the env-var
--      values to render correctly. A persisted column is decoupled.
--   2. Admin-granted premium has no Razorpay plan_id at all, but we still
--      want the SettingsModal to say "next renewal" in the right cadence.
--   3. Future cadences (quarterly, bi-annual) drop in here without
--      teaching every consumer about a new plan_id.
--
-- Backfill: every existing row is monthly. The CHECK constraint enforces
-- the enum going forward; the column is NOT NULL with a default so old
-- INSERTs that don't supply it (none in current code, but safety) still
-- get a sensible value.
--
-- Apply via Supabase dashboard SQL editor (per HANDOFF.md gotcha #17 —
-- migration tracking is dashboard-managed, not CLI).
-- =====================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_cadence TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cadence IN ('monthly', 'annual'));

-- Backfill existing rows to 'monthly'. The DEFAULT above already does this
-- for new rows; this UPDATE is a no-op if the table is empty but harmless.
UPDATE public.subscriptions
   SET billing_cadence = 'monthly'
 WHERE billing_cadence IS NULL;

-- Optional reporting index — admin /metrics will want to slice MRR by
-- cadence. Cardinality is 2, so the cost is tiny and the index pays
-- for itself the first time we read it.
CREATE INDEX IF NOT EXISTS idx_subscriptions_cadence
  ON public.subscriptions(billing_cadence);

-- Comment for future readers / pgAdmin.
COMMENT ON COLUMN public.subscriptions.billing_cadence IS
  'Billing cadence: monthly (₹499/₹999) or annual (₹3,999/₹7,999). Set at /api/subscription/create time and never mutated by the webhook — the cadence is decided once at checkout.';
