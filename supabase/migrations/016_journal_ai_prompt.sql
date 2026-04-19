-- =====================================================================
-- 016_journal_ai_prompt.sql
-- Store a one-time AI-generated writing prompt on each journal entry.
--
-- Product rule: a user can click "Ask for AI Prompt" exactly once per
-- entry. We enforce that on the client by disabling the button when
-- this column is non-null; the column itself accepts any text so we
-- keep regenerate-by-admin flexibility if that's ever needed.
--
-- NULL-by-default means existing rows are unaffected — they simply show
-- the button as available the next time the user opens that day's entry.
-- =====================================================================

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS ai_prompt TEXT;

-- No index needed — we never filter by ai_prompt. The column is only
-- ever read/written alongside the rest of the row in single-entry
-- upserts keyed by (user_id, date).

COMMENT ON COLUMN public.journal_entries.ai_prompt IS
  'One-time AI-generated journal writing prompt for this entry. Null = not yet requested. Non-null = user has burned their single prompt request for this day.';
