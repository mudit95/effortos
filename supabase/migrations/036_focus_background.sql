-- =====================================================================
-- 036: Focus-mode background preference + custom-upload bucket
--
-- The Pomodoro focus mode currently sits on a fixed dark gradient. This
-- migration adds a per-user preference for a background image / video
-- behind the timer, plus a private Supabase Storage bucket for users
-- who want to upload their own. Bundled defaults (catalogue lives in
-- src/lib/focus-backgrounds.ts) are referenced by stable IDs; custom
-- uploads use the bucket key as their ID.
--
-- UX contract (see BackgroundPicker in FocusMode):
--   - focus_background_id NULL  → solid dark gradient (today's behaviour).
--   - focus_background_id = 'gradient-amber' / etc → bundled default.
--   - focus_background_id starts with 'custom:'  → user upload, the rest
--     of the string is the storage object key.
--   - focus_background_dim is the % opacity of the dark scrim layered
--     over the background so the timer + ambient toggle stay legible.
--     0 = no dim (background fully visible), 100 = pure black; default
--     35% works for most landscape images.
--
-- Reduced-motion users (prefers-reduced-motion: reduce) automatically
-- get the static-image variant of any video background — handled in
-- the BackgroundPicker render path, not in the schema.
--
-- Apply via Supabase dashboard SQL editor (per HANDOFF.md gotcha #17).
-- =====================================================================

-- 1. profiles columns. Both NULL-by-default so existing users see no
--    behavioural change until they explicitly pick a background.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS focus_background_id TEXT,
  ADD COLUMN IF NOT EXISTS focus_background_dim INT NOT NULL DEFAULT 35
    CHECK (focus_background_dim BETWEEN 0 AND 100);

COMMENT ON COLUMN public.profiles.focus_background_id IS
  'Selected focus-mode background. NULL = solid gradient (default). Bundled IDs match focus-backgrounds catalog. Strings starting with "custom:" reference focus-backgrounds bucket objects.';
COMMENT ON COLUMN public.profiles.focus_background_dim IS
  'Dim-overlay opacity (0–100, %) applied over the background so the timer stays readable. 35% works for most landscapes; users can adjust via the picker.';

-- 2. Storage bucket for custom uploads. Private — every read goes
--    through a signed URL keyed to the user's own folder, mirroring the
--    journal-media bucket pattern from migration 033.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'focus-backgrounds',
  'focus-backgrounds',
  false,
  -- 15 MB ceiling. Enough for a 4K still or a short MP4 loop; not
  -- enough to abuse the bucket as personal cloud storage.
  15728640,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS — per-user folder isolation. Same shape as journal-media
--    (mig 033): the first segment of the object name must equal the
--    auth.uid() of the requester.
DROP POLICY IF EXISTS "focus-backgrounds: users read own" ON storage.objects;
CREATE POLICY "focus-backgrounds: users read own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'focus-backgrounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users upload to their own folder. The /api/focus-background/upload
-- route enforces the path prefix server-side; this policy enforces it
-- at the DB layer too (defence in depth).
DROP POLICY IF EXISTS "focus-backgrounds: users insert own" ON storage.objects;
CREATE POLICY "focus-backgrounds: users insert own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'focus-backgrounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "focus-backgrounds: users delete own" ON storage.objects;
CREATE POLICY "focus-backgrounds: users delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'focus-backgrounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "focus-backgrounds: service role manages" ON storage.objects;
CREATE POLICY "focus-backgrounds: service role manages"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'focus-backgrounds')
  WITH CHECK (bucket_id = 'focus-backgrounds');
