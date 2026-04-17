-- Backfill: fix daily_tasks that were misfiled due to the WhatsApp bot
-- using UTC instead of the user's local timezone for the `date` column.
--
-- Symptom: task rows whose `created_at` (UTC, accurate) falls on day D in the
-- user's timezone, but whose `date` column is set to day D-1.
--
-- Safe to run multiple times: it only updates rows where the mismatch still
-- exists. Always run the SELECT first to confirm the set of rows before the
-- UPDATE.

-- ── 1. Preview: which rows look wrong? ────────────────────────────
-- Shows every task whose stored `date` differs from the local date of its
-- created_at in the profile's timezone.

SELECT
  dt.id,
  dt.user_id,
  p.timezone,
  dt.title,
  dt.date               AS stored_date,
  (dt.created_at AT TIME ZONE p.timezone)::date AS correct_local_date,
  dt.created_at
FROM daily_tasks dt
JOIN profiles p ON p.id = dt.user_id
WHERE dt.date <> (dt.created_at AT TIME ZONE p.timezone)::date
  -- Only touch tasks created in the last 7 days — old misalignments may
  -- have been intentional (e.g., "scheduling tomorrow's tasks tonight").
  AND dt.created_at >= NOW() - INTERVAL '7 days'
ORDER BY dt.created_at DESC;

-- ── 2. Fix: set `date` to the user-local date of created_at ───────
-- Run this AFTER you've eyeballed the preview above and are happy with it.
-- Recommended: wrap in a transaction so you can rollback if something
-- looks off.

BEGIN;

UPDATE daily_tasks dt
SET date = (dt.created_at AT TIME ZONE p.timezone)::date
FROM profiles p
WHERE p.id = dt.user_id
  AND dt.date <> (dt.created_at AT TIME ZONE p.timezone)::date
  AND dt.created_at >= NOW() - INTERVAL '7 days';

-- Verify the update count matches what the preview showed, then:
--   COMMIT;
-- or, if anything looks wrong:
--   ROLLBACK;

COMMIT;
