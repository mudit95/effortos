-- =====================================================================
-- 041: Anchor habit (habit-stacking)
--
-- Most habit-formation research converges on one finding: a new habit
-- attaches more reliably to an existing daily anchor than to an
-- abstract time slot. James Clear / BJ Fogg / etc. converge here.
-- "After my morning coffee, I focus for 25 min" is dramatically
-- stickier than "I focus at 8 AM."
--
-- This migration adds a single optional column on profiles:
--   anchor_habit_text — short user-named anchor, e.g. "after coffee"
--
-- We deliberately do NOT model anchors as a structured enum. The
-- whole point is the anchor be the user's own words for their own
-- existing routine. A free-text field is the right shape.
--
-- Apply via Supabase dashboard SQL editor.
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS anchor_habit_text TEXT
    CHECK (anchor_habit_text IS NULL OR length(anchor_habit_text) <= 80);

COMMENT ON COLUMN public.profiles.anchor_habit_text IS
  'User-named existing daily anchor that the focus habit will attach to. Free-text, capped at 80 chars by CHECK. Examples: "after morning coffee", "right after lunch", "before bed". The dashboard surfaces this as habit-stacking copy and the proactive coach uses it in nudge phrasing.';
