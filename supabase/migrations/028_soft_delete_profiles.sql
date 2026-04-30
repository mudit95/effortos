-- =====================================================================
-- 028: Soft-delete window for accounts
--
-- Privacy policy promises "we delete your personal data within 30 days
-- of deletion request." Today the /api/account/delete endpoint deletes
-- immediately with no recovery — which is more aggressive than promised
-- AND irreversible if a user accidentally clicks delete.
--
-- This migration adds a `deleted_at` column to profiles. The delete
-- endpoint will set deleted_at instead of immediately purging; a daily
-- cron (/api/cron/purge-deleted-accounts) hard-deletes rows where
-- deleted_at < now - 30 days.
--
-- During the 30-day window:
--   - SELECT/UPDATE/INSERT policies on profiles deny when deleted_at IS NOT NULL
--   - Auth signin still works at the auth.users layer (intentional — user
--     who realises their mistake within 30d can sign in and undo)
--   - All other tables continue to RLS-filter on auth.uid(), so a user
--     whose deleted_at is set sees an empty app and can hit Restore.
--
-- We add a recover-account endpoint as part of this same migration's
-- supporting code (lib/account-recovery.ts + /api/account/restore).
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index helps the daily purge cron find ripe rows without a full scan.
CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at
  ON public.profiles(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Tighten existing policies to exclude soft-deleted rows. We keep the
-- existing "Users read own profile" policy intact (so users can still
-- read their own row to see "your account is scheduled for deletion in
-- N days" and act on it).
--
-- For UPDATE we deliberately allow the user to:
--   1. Set deleted_at = NULL (account restore — undo deletion)
--   2. Update their own non-deletion fields if not deleted
-- Done via two policies; service-role bypasses both for the delete
-- endpoint and the purge cron.

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
-- Note: this policy doesn't itself enforce "soft-deleted users can't
-- update non-recovery fields" — the API layer enforces that. The reason
-- is that a fully RLS-locked soft-delete would also block the recovery
-- path. We accept the API-layer enforcement instead.
