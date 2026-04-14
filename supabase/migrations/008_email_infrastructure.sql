-- Migration 008: Email infrastructure
-- Adds email_preferences per user and email_log for audit trail + analytics.

-- 1) Email preferences — controls which emails a user receives.
-- Defaults to all-on for new users; updated via Settings modal.
CREATE TABLE IF NOT EXISTS email_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  morning_email BOOLEAN NOT NULL DEFAULT TRUE,
  afternoon_email BOOLEAN NOT NULL DEFAULT TRUE,
  nightly_email BOOLEAN NOT NULL DEFAULT TRUE,
  admin_emails BOOLEAN NOT NULL DEFAULT TRUE,    -- custom emails from admin
  unsubscribed_all BOOLEAN NOT NULL DEFAULT FALSE, -- master kill switch
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',   -- used for scheduling sends
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own prefs
CREATE POLICY "Users manage own email prefs"
  ON email_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admin can read all prefs (for send targeting)
CREATE POLICY "Admins can view all email prefs"
  ON email_preferences FOR SELECT
  USING (check_is_admin(auth.uid()));

-- 2) Email log — one row per email sent, for admin visibility + dedup.
CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email_to TEXT NOT NULL,
  email_type TEXT NOT NULL,   -- 'morning', 'afternoon', 'nightly', 'admin_custom', 'welcome', 'payment_failed', etc.
  subject TEXT NOT NULL,
  resend_id TEXT,              -- ID returned by Resend API
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced')),
  error TEXT,
  metadata JSONB,             -- optional payload data (e.g., admin_sender_id, batch_id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_log_user ON email_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_type ON email_log(email_type, created_at DESC);

ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

-- Users can see their own email history
CREATE POLICY "Users can view own email log"
  ON email_log FOR SELECT
  USING (auth.uid() = user_id);

-- Admin can see all
CREATE POLICY "Admins can view all email logs"
  ON email_log FOR SELECT
  USING (check_is_admin(auth.uid()));

-- Service role inserts (cron endpoints + admin) — RLS bypass via service key

-- 3) Auto-create email_preferences for existing users
INSERT INTO email_preferences (user_id, timezone)
SELECT id, COALESCE(raw_user_meta_data->>'timezone', 'Asia/Kolkata')
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 4) Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_email_prefs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_prefs_updated
  BEFORE UPDATE ON email_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_email_prefs_timestamp();
