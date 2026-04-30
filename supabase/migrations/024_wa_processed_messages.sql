-- =====================================================================
-- 024: WhatsApp inbound-message dedup
--
-- Meta retries webhook deliveries on any non-2xx response or timeout,
-- and our handler does heavy synchronous work (Anthropic intent parse,
-- Groq Whisper transcription, multiple Supabase round-trips, outbound
-- Meta send). A 10s+ flow easily blows past Vercel's default function
-- timeout, Meta retries, and the same user message is processed twice
-- — duplicate task inserts, double "carry all" (which would shift tasks
-- *two* days forward), double Anthropic cost, etc.
--
-- Strategy: claim each Meta message_id at the top of the handler via an
-- INSERT against this table. Unique constraint serialises retries; on
-- conflict we return 200 immediately and skip processing. On processing
-- failure we DELETE our claim so the next retry can re-process.
--
-- Retention: a janitor sweep can prune rows older than 7 days. Meta
-- retries top out at ~24h, so a week is plenty of headroom.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.wa_processed_messages (
  message_id   TEXT PRIMARY KEY,
  phone_from   TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the eventual janitor sweep / debugging.
CREATE INDEX IF NOT EXISTS idx_wa_processed_at
  ON public.wa_processed_messages(processed_at);

-- RLS: the webhook handler uses the service-role client (which bypasses
-- RLS), so we just need to enable RLS to lock out anon reads.
ALTER TABLE public.wa_processed_messages ENABLE ROW LEVEL SECURITY;
-- No policies = no non-service access. Intentional.
