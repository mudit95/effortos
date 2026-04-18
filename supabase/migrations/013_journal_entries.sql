-- =====================================================================
-- 013_journal_entries.sql
-- Per-day journal entries attached to the calendar. One entry per user
-- per calendar day, enforced by UNIQUE(user_id, date). Content is plain
-- text for now; mood is an optional enum-ish tag. RLS matches the same
-- "user owns their rows" pattern used elsewhere.
--
-- `ON DELETE CASCADE` removes entries when the profile is deleted — the
-- account-delete flow in /api/account/delete already relies on FK
-- cascades for data cleanup.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  -- Keep mood as TEXT + CHECK instead of a CREATE TYPE enum. Enums in
  -- Postgres need ALTER TYPE to extend, which is painful over time;
  -- a CHECK is trivially updated in a later migration.
  mood        TEXT CHECK (mood IN ('great','good','meh','rough','hard')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- Covers the two queries the app makes: listing all of a user's entries
-- (for the calendar dot indicator) and fetching a single day's entry.
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_date
  ON public.journal_entries(user_id, date DESC);

-- updated_at trigger — keeps the timestamp honest even if a client forgets
-- to set it on upsert.
CREATE OR REPLACE FUNCTION public.touch_journal_entry_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entries_touch_updated_at
  ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_touch_updated_at
  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_journal_entry_updated_at();

-- RLS: same "user owns their rows" pattern as daily_tasks, goals, etc.
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users CRUD own journal entries"
  ON public.journal_entries
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
