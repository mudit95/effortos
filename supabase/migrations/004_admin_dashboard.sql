-- =====================================================================
-- 004_admin_dashboard.sql
-- Admin dashboard: is_admin flag, coupons, redemptions, site content
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helper: check_is_admin() — SECURITY DEFINER to avoid RLS recursion
-- ---------------------------------------------------------------------
-- Declared first so RLS policies can reference it.
-- A regular policy that queries profiles directly would recurse infinitely
-- when evaluating SELECT on profiles itself.
CREATE OR REPLACE FUNCTION check_is_admin(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = uid), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- 1. is_admin flag on profiles
-- ---------------------------------------------------------------------
-- If you don't have a profiles table, create a lightweight one keyed to auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Make sure column exists even if profiles table already existed
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (check_is_admin(auth.uid()));

-- Trigger: create profile row on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Backfill profiles for existing auth users
INSERT INTO profiles (id, email, name)
SELECT id, email, COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Coupons
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  -- Type of discount:
  --   'percent_off'     : discount_value is percent (0-100) off checkout
  --   'trial_extension' : discount_value is number of days to extend trial
  --   'free_months'     : discount_value is number of months of premium granted
  kind TEXT NOT NULL CHECK (kind IN ('percent_off', 'trial_extension', 'free_months')),
  discount_value NUMERIC NOT NULL,
  description TEXT,
  max_redemptions INTEGER,        -- NULL = unlimited
  redemption_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(active);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active coupons" ON coupons;
CREATE POLICY "Anyone can read active coupons"
  ON coupons FOR SELECT
  USING (active = TRUE);

DROP POLICY IF EXISTS "Admins manage coupons" ON coupons;
CREATE POLICY "Admins manage coupons"
  ON coupons FOR ALL
  USING (check_is_admin(auth.uid()))
  WITH CHECK (check_is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- 3. Coupon redemptions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by_admin UUID REFERENCES auth.users(id),  -- NULL = user self-redeemed
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE (coupon_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_redemptions_user ON coupon_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_coupon ON coupon_redemptions(coupon_id);

ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own redemptions" ON coupon_redemptions;
CREATE POLICY "Users view own redemptions"
  ON coupon_redemptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage redemptions" ON coupon_redemptions;
CREATE POLICY "Admins manage redemptions"
  ON coupon_redemptions FOR ALL
  USING (check_is_admin(auth.uid()))
  WITH CHECK (check_is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- 4. Site content (editable text blocks)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read site content" ON site_content;
CREATE POLICY "Anyone can read site content"
  ON site_content FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Admins write site content" ON site_content;
CREATE POLICY "Admins write site content"
  ON site_content FOR ALL
  USING (check_is_admin(auth.uid()))
  WITH CHECK (check_is_admin(auth.uid()));

-- Seed default content keys
INSERT INTO site_content (key, value, description) VALUES
  ('landing.hero.title', 'Track effort, not just time.', 'Landing hero headline'),
  ('landing.hero.subtitle', 'AI-powered Pomodoro coaching that adapts to how you actually work.', 'Landing hero subhead'),
  ('paywall.title', 'Your trial has ended', 'Paywall dialog title'),
  ('paywall.subtitle', 'Subscribe to continue tracking your effort.', 'Paywall dialog subtitle')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. updated_at triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coupons_updated ON coupons;
CREATE TRIGGER coupons_updated BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS profiles_updated ON profiles;
CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS site_content_updated ON site_content;
CREATE TRIGGER site_content_updated BEFORE UPDATE ON site_content
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
