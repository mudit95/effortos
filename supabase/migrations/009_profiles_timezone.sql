-- Migration 009: Add timezone to profiles and keep it in sync with email_preferences.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
