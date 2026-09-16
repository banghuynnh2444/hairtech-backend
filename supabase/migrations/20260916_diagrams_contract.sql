-- Phase 0. Apply after 20260915_security_fix.sql using Supabase SQL Editor.
-- Verified source: diagrams(id text, user_id uuid, client_id text, type/name text,
-- notes/image text, history_data jsonb, timestamp bigint [JavaScript milliseconds]).
-- Retains every legacy column; never deletes or fabricates scene content.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.clients, public.diagrams IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='diagrams' AND column_name='id' AND data_type='text')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='clients' AND column_name='id' AND data_type='text') THEN
    RAISE EXCEPTION 'PHASE0_SCHEMA_MISMATCH: expected existing text identifiers; no ID conversion attempted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.diagrams d LEFT JOIN public.clients c ON c.id=d.client_id
    WHERE d.client_id IS NOT NULL AND (c.id IS NULL OR c.user_id IS DISTINCT FROM d.user_id)) THEN
    RAISE EXCEPTION 'PHASE0_CLIENT_OWNERSHIP: repair existing mismatched links after reviewing a backup';
  END IF;
END;
$$;

ALTER TABLE public.diagrams
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS project_data jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- to_jsonb(row) lets an optional old column be inspected without assuming it exists.
-- Prefer canonical fields. Conflicting old title/data remain in their original columns.
UPDATE public.diagrams d SET
  name = COALESCE(d.name, to_jsonb(d)->>'title'),
  type = COALESCE(d.type, 'legacy'),
  thumbnail_url = CASE WHEN d.thumbnail_url IS NOT NULL THEN d.thumbnail_url
    WHEN d.project_data IS NULL AND to_jsonb(d)->>'image' ~ '^https://' THEN to_jsonb(d)->>'image' ELSE NULL END,
  project_data = COALESCE(d.project_data, jsonb_build_object(
    'version', 0,
    'legacy', jsonb_build_object('history_data', to_jsonb(d)->'history_data', 'data', to_jsonb(d)->'data'))),
  created_at = COALESCE(d.created_at, CASE WHEN to_jsonb(d)->>'timestamp' IS NOT NULL
    THEN to_timestamp((to_jsonb(d)->>'timestamp')::double precision / 1000.0)
    ELSE transaction_timestamp() END)
WHERE d.name IS NULL OR d.type IS NULL OR d.project_data IS NULL OR d.created_at IS NULL;
UPDATE public.diagrams SET updated_at=created_at WHERE updated_at IS NULL;

-- The new backend omits deprecated columns. Preserve their values but remove
-- legacy NOT NULL requirements so inserts use only the new contract.
DO $$
DECLARE col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['timestamp','title','data','history_data','image'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='diagrams' AND column_name=col) THEN
      EXECUTE format('ALTER TABLE public.diagrams ALTER COLUMN %I DROP NOT NULL', col);
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.diagrams
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN type SET NOT NULL,
  ALTER COLUMN project_data SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

-- No project_data default: callers must supply an explicit document version.
ALTER TABLE public.diagrams ALTER COLUMN project_data DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.diagrams'::regclass AND conname='hairtech_diagrams_project_version') THEN
    ALTER TABLE public.diagrams ADD CONSTRAINT hairtech_diagrams_project_version CHECK (
      jsonb_typeof(project_data) = 'object' AND project_data ? 'version'
      AND (project_data->'version' = '0'::jsonb OR project_data->'version' = '1'::jsonb)
    );
  END IF;
END;
$$;

-- Composite FK enforces ownership even if a concurrent request changes a client.
-- Existing bad links cause the transaction to abort, not silent reassignment.
CREATE UNIQUE INDEX IF NOT EXISTS hairtech_clients_id_owner ON public.clients(id, user_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.diagrams'::regclass AND conname='hairtech_diagrams_client_owner') THEN
    ALTER TABLE public.diagrams ADD CONSTRAINT hairtech_diagrams_client_owner
      FOREIGN KEY (client_id, user_id) REFERENCES public.clients(id, user_id);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS hairtech_diagrams_owner_client_created
  ON public.diagrams(user_id, client_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.hairtech_diagrams_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hairtech_diagrams_updated_at() FROM PUBLIC;
DROP TRIGGER IF EXISTS hairtech_diagrams_updated_at ON public.diagrams;
CREATE TRIGGER hairtech_diagrams_updated_at BEFORE UPDATE ON public.diagrams
  FOR EACH ROW EXECUTE FUNCTION public.hairtech_diagrams_updated_at();

-- Keep existing RLS/grants from the security migration. Reload API column metadata.
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Metadata only; no customer content or secrets in the result.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_schema='public' AND table_name='diagrams'
ORDER BY ordinal_position;
