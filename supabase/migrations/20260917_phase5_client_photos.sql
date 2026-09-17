-- Phase 5: private customer photos backed by Supabase Storage.
-- Database rows contain paths and metadata only; image bytes never enter Postgres.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.clients IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.client_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  client_id text NOT NULL,
  kind text NOT NULL,
  storage_path text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hairtech_client_photos_kind
    CHECK (kind IN ('before', 'after', 'reference')),
  CONSTRAINT hairtech_client_photos_mime
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT hairtech_client_photos_size
    CHECK (size_bytes BETWEEN 1 AND 8388608),
  CONSTRAINT hairtech_client_photos_name
    CHECK (char_length(original_name) BETWEEN 1 AND 255),
  CONSTRAINT hairtech_client_photos_path
    CHECK (
      left(
        storage_path,
        char_length('users/' || user_id::text || '/clients/' || client_id || '/')
      ) = 'users/' || user_id::text || '/clients/' || client_id || '/'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS hairtech_clients_id_owner
  ON public.clients(id, user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.client_photos'::regclass
      AND conname = 'hairtech_client_photos_owner'
  ) THEN
    ALTER TABLE public.client_photos
      ADD CONSTRAINT hairtech_client_photos_owner
      FOREIGN KEY (client_id, user_id)
      REFERENCES public.clients(id, user_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS hairtech_client_photos_storage_path
  ON public.client_photos(storage_path);
CREATE UNIQUE INDEX IF NOT EXISTS hairtech_one_before_after_photo
  ON public.client_photos(user_id, client_id, kind)
  WHERE kind IN ('before', 'after');
CREATE INDEX IF NOT EXISTS hairtech_client_photos_owner_created
  ON public.client_photos(user_id, client_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.hairtech_client_photos_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = '' AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hairtech_client_photos_updated_at() FROM PUBLIC;
DROP TRIGGER IF EXISTS hairtech_client_photos_updated_at ON public.client_photos;
CREATE TRIGGER hairtech_client_photos_updated_at
  BEFORE UPDATE ON public.client_photos
  FOR EACH ROW EXECUTE FUNCTION public.hairtech_client_photos_updated_at();

ALTER TABLE public.client_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_photos FROM anon, authenticated;
GRANT ALL ON TABLE public.client_photos TO service_role;
DROP POLICY IF EXISTS hairtech_client_photos_backend_only ON public.client_photos;
CREATE POLICY hairtech_client_photos_backend_only ON public.client_photos
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-photos',
  'client-photos',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS hairtech_client_photos_storage_backend_only ON storage.objects;
CREATE POLICY hairtech_client_photos_storage_backend_only ON storage.objects
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'client-photos')
  WITH CHECK (bucket_id <> 'client-photos');

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Metadata only; expected bucket is private and the table has RLS enabled.
SELECT b.id, b.public, b.file_size_limit, b.allowed_mime_types
FROM storage.buckets b WHERE b.id = 'client-photos';
SELECT relname, relrowsecurity
FROM pg_class WHERE oid = 'public.client_photos'::regclass;
