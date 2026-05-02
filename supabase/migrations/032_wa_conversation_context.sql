-- =====================================================================
-- 032: WhatsApp conversational memory
--
-- Stores a rolling window of inbound + outbound WhatsApp messages per
-- user so the AI parser stops being amnesic. Without this, every message
-- the bot sees is treated as a cold-start exchange — "delete it" can't
-- bind to "the React task we just discussed", and follow-up disambiguation
-- ("yes, the second one") is impossible.
--
-- Read pattern: most recent N messages for a user (default 6 → ~3 turns).
-- Write pattern: append-only on every inbound message + every bot reply.
-- Retention: pruned by the retention-sweep cron at 14 days. Hot reads
-- stay fast even at >100k rows because of the (user_id, created_at DESC)
-- index — they're a backwards index scan with LIMIT 6.
--
-- Why a separate table from coach_log:
--   - coach_log records proactive nudges only (cron-driven), not the
--     reactive request-reply loop.
--   - coach_log rows have one row per nudge_type per UTC day (mig 025
--     unique index). Conversation memory is many-rows-per-day.
--   - Conversation memory is short-lived; coach_log is forensic.
--
-- Apply via Supabase dashboard SQL editor (per HANDOFF.md gotcha #17).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.wa_conversation_context (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 'user' = inbound message from the human via WhatsApp.
  -- 'bot'  = outbound reply we sent (post-formatting, what the user saw).
  role            TEXT NOT NULL CHECK (role IN ('user', 'bot')),
  -- The literal message text, capped at 4096 chars (WhatsApp's outbound
  -- limit; inbound can technically exceed but the parser truncates first).
  content         TEXT NOT NULL,
  -- Optional: the parser's classification of THIS turn. NULL on bot rows
  -- and on user rows where parsing failed. Useful both for memory pruning
  -- (we may eventually weight more recent intent-bearing turns higher)
  -- and for offline analytics.
  intent_type     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The hot read is "last 6 messages for this user, newest first." A
-- composite index on (user_id, created_at DESC) supports it as an
-- index-only scan up to the projected columns.
CREATE INDEX IF NOT EXISTS idx_wa_conv_user_time
  ON public.wa_conversation_context(user_id, created_at DESC);

ALTER TABLE public.wa_conversation_context ENABLE ROW LEVEL SECURITY;

-- Users can read their own memory (powers a future "see my recent
-- conversation with the bot" debug screen).
CREATE POLICY wa_conv_user_select ON public.wa_conversation_context
  FOR SELECT
  USING (auth.uid() = user_id);

-- All writes go through the service-role client from the webhook /
-- crons. No INSERT/UPDATE/DELETE policy = service role only, by RLS
-- design. This matches coach_log (mig 017).

COMMENT ON TABLE public.wa_conversation_context IS
  'Rolling window of WhatsApp inbound + outbound messages per user. Read by parseWhatsAppMessage to inject conversation history into the system prompt. Pruned at 14 days by retention-sweep.';
