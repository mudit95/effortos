-- =====================================================================
-- 033: Photo journals — media columns + storage bucket
--
-- Journal entries become multi-modal: a user can send a photo via
-- WhatsApp (parallel to the voice-note flow) and the bot saves it as
-- the day's journal entry. The image lives in Supabase Storage; we
-- store the bucket key + a signed URL on the journal_entries row so
-- the dashboard can render it without extra round-trips.
--
-- Storage layout:
--   bucket: journal-media (private, ≤10 MB, image/* only)
--   path:   <user_id>/<uuid>.<ext>
--
-- RLS:
--   - Users can SELECT their own object rows (path[1] == auth.uid()).
--   - Service role manages all rows; the WhatsApp webhook + the
--     dashboard upload path go through service_role to bypass the
--     auth-bound check entirely.
--
-- Apply via Supabase dashboard SQL editor (per HANDOFF.md gotcha #17).
-- =====================================================================

-- 1. journal_entries gets two new optional columns.
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT
    CHECK (media_type IS NULL OR media_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif'));

COMMENT ON COLUMN public.journal_entries.media_url IS
  'Signed URL for the attached photo, expires after 1 year. NULL = text-only entry. Refresh via /api/journal/refresh-media if expiry approaches.';
COMMENT ON COLUMN public.journal_entries.media_type IS
  'MIME type of the attached photo. Mirror of the storage object metadata; cached here so the dashboard can render <img> without an extra fetch.';

-- 2. Storage bucket. Private bucket so a guessed URL can't leak someone
--    else's journal photo. 10 MB ceiling matches the WhatsApp-side cap
--    in lib/whatsapp.ts (5 MB) with headroom for re-uploads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'journal-media',
  'journal-media',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS policies. The first folder segment of the object name
--    must be the user's auth.uid() — that's our per-user prefix isolation.
--    storage.foldername returns a text[] of segments split on '/'.
DROP POLICY IF EXISTS "journal-media: users read own" ON storage.objects;
CREATE POLICY "journal-media: users read own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'journal-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- The webhook + admin paths use service_role; they need full access.
-- Service role bypasses RLS by default, but explicit policy keeps the
-- intent visible in the policy listing.
DROP POLICY IF EXISTS "journal-media: service role manages" ON storage.objects;
CREATE POLICY "journal-media: service role manages"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'journal-media')
  WITH CHECK (bucket_id = 'journal-media');
