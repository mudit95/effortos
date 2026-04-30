-- =====================================================================
-- 025: Atomic per-day nudge dedup
--
-- The cron-coach handler had a TOCTOU race:
--   1. evaluateNudges() checks notSentToday(...) → false (no row yet)
--   2. evaluateNudges() checks cap (count < 6) → true
--   3. Send WhatsApp
--   4. INSERT coach_log row
--
-- If two cron invocations overlap (Vercel retry, external cron-job.org +
-- Vercel cron both firing, or even the natural "0 * * * *" + a manual
-- replay), step 1+2 both pass for both invocations. Result: same nudge
-- sent twice and the daily cap silently exceeded.
--
-- This index makes step 4 the choke point. Combined with INSERT ... ON
-- CONFLICT DO NOTHING + .select() in the cron handler, the second call
-- gets back an empty result set and skips the WhatsApp send entirely.
--
-- Granularity: per UTC day. The cap itself is conceptually per LOCAL day,
-- but the index expression must be IMMUTABLE — and we don't have a stable
-- per-row tz to feed in. UTC day is sufficient because nudges are tied to
-- specific local hours; a same-local-day retry always falls within the
-- same UTC day for any reasonable timezone.
-- =====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS coach_log_unique_per_user_day_nudge
  ON public.coach_log (
    user_id,
    nudge_type,
    (date_trunc('day', created_at AT TIME ZONE 'UTC'))
  );
