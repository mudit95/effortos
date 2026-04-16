-- 010: Add phone_number to profiles for WhatsApp bot linking
-- Run in Supabase SQL Editor

-- Add phone number column (E.164 format, e.g. +919876543210)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_linked BOOLEAN DEFAULT FALSE;

-- Index for fast lookups when webhook receives a message
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_number
  ON profiles (phone_number)
  WHERE phone_number IS NOT NULL;

-- RLS: users can only read/update their own phone number
-- (existing RLS policies on profiles already handle this)
