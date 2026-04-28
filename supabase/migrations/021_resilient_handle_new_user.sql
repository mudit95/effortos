-- 021: Make handle_new_user resilient to profile-insert failures.
--
-- Why: the original trigger (in 004) had no EXCEPTION block, so any error
-- in the profile INSERT (RLS, NOT NULL constraint added by a later
-- migration that didn't backfill, broken FK, etc.) propagates up and
-- kills the auth.users INSERT itself. Supabase Auth then surfaces a
-- generic "Database error saving new user" and the user can't sign up
-- at all — even though their auth row would have been fine on its own.
--
-- The new function:
--   - Tries the profile insert as before.
--   - Catches OTHERS, logs a WARNING (visible in Postgres logs), and
--     RETURNs NEW so the auth.users INSERT still commits.
--   - The app already lazily upserts the profile on first sign-in, so a
--     missing profile here is recoverable without manual intervention.
--
-- Net effect: signups never fail because of profile-table issues again.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO profiles (id, email, name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING '[handle_new_user] profile insert failed for %: %',
        NEW.id, SQLERRM;
      -- Swallow the error so auth.users still gets inserted. The app
      -- backfills the profile on first sign-in. Signup must never fail
      -- because of profile-table glitches.
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The trigger itself is unchanged — same name, same target, same timing.
-- Re-create defensively in case it was dropped.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- Optional: backfill any auth.users that don't have a profile row yet.
-- Safe to re-run because of ON CONFLICT DO NOTHING.
INSERT INTO profiles (id, email, name)
SELECT id, email, COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO NOTHING;
