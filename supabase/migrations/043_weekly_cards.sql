-- =====================================================================
-- 043: Weekly AI report card (Wave 3, Pro tier)
--
-- Cache for the weekly insight card. Mirrors daily_cards (mig 037)
-- but keyed by user + ISO week-start (Monday). One row per user per
-- week; first dashboard open of the week pays the AI cost, every
-- subsequent open is a fast DB read.
--
-- Why a separate table from daily_cards:
--   - Different cadence + retention. Daily cards are pruned at 90
--     days; weekly cards we keep for ~1 year so users can scroll
--     back through their year-end.
--   - Different shape. The descriptive payload is week-aggregated
--     (total focus minutes, completion rate, best day, peak hours,
--     mood-vs-output observation). The AI suggestion is multi-line
--     and prescriptive ("78% completion in mornings vs 41% afternoons
--     — try moving deep work to mornings next week").
--   - Different access policy. Weekly is Pro-only; the table itself
--     doesn't enforce that — RLS lets users read their own rows;
--     the API gates the write on Pro tier.
--
-- Apply via Supabase dashboard SQL editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.weekly_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- ISO week-start (Monday) in user-local timezone, as YYYY-MM-DD.
  -- Always Monday — see lib/user-date.weekStartKeyInTz.
  week_start      DATE NOT NULL,
  -- Pre-computed descriptive aggregate. Schema is intentionally JSONB
  -- so we can add fields without migrations. Today's shape:
  --   {
  --     "total_focus_minutes": int,
  --     "total_sessions": int,
  --     "tasks_completed": int,
  --     "tasks_total": int,
  --     "completion_rate": number (0..1),
  --     "best_day_name": string,    -- "Tuesday"
  --     "best_day_sessions": int,
  --     "morning_completion": number,   -- 0..1
  --     "afternoon_completion": number, -- 0..1
  --     "evening_completion": number,   -- 0..1
  --     "current_streak": int,
  --     "longest_streak": int,
  --     "active_goals_count": int,
  --     "mood_summary": string | null,
  --     "tag_breakdown": [{tag, count}],
  --     "active_goal_pct_change": number | null
  --   }
  descriptive     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Pro-tier AI insight. Multi-paragraph; markdown-safe (used in
  -- both the card UI and the email body via lightweight rendering).
  ai_insight      TEXT,
  -- One-line "try X next week" CTA, often a more concrete version
  -- of the insight body. Surfaced as an action chip on the card.
  ai_suggestion   TEXT,
  -- Token cost for accounting; matches the daily_anthropic_usage bucket.
  ai_tokens_used  INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_cards_user_week
  ON public.weekly_cards(user_id, week_start DESC);

ALTER TABLE public.weekly_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own weekly cards" ON public.weekly_cards;
CREATE POLICY "Users read own weekly cards"
  ON public.weekly_cards FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.weekly_cards IS
  'One row per (user, ISO week start). Caches descriptive aggregate + Pro AI insight so the dashboard renders without re-firing Claude on every open. Pruned at 365 days by retention-sweep.';
