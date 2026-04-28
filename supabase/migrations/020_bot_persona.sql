-- 020: Add bot_persona to profiles for WhatsApp tone selection.
-- Picked during onboarding (or later in Settings) and used by the
-- WhatsApp bot to colour every outgoing message — starting with the
-- welcome-on-link message and continuing through coach replies.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bot_persona TEXT
    CHECK (bot_persona IN ('friend', 'mentor', 'boss', 'colleague'));

-- No default at the DB level — NULL means "user hasn't picked yet"
-- (e.g. profiles created before this migration). The app treats NULL
-- as "friend" so existing users get a sensible voice without us
-- silently overwriting a future choice.
COMMENT ON COLUMN profiles.bot_persona IS
  'WhatsApp bot voice: friend | mentor | boss | colleague. NULL = unset (defaults to friend).';
