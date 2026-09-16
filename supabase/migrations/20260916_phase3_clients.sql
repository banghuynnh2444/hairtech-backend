-- Phase 3: customer profile fields and deterministic timestamps.
-- Additive and safe to run more than once. Existing customers are retained.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.clients IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.clients
SET created_at = COALESCE(created_at, transaction_timestamp()),
    updated_at = COALESCE(updated_at, created_at, transaction_timestamp())
WHERE created_at IS NULL OR updated_at IS NULL;

ALTER TABLE public.clients
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.clients'::regclass
      AND conname = 'hairtech_clients_name_length'
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT hairtech_clients_name_length
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.clients'::regclass
      AND conname = 'hairtech_clients_phone_length'
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT hairtech_clients_phone_length
      CHECK (phone IS NULL OR char_length(phone) <= 32);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.clients'::regclass
      AND conname = 'hairtech_clients_note_length'
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT hairtech_clients_note_length
      CHECK (note IS NULL OR char_length(note) <= 5000);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hairtech_clients_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hairtech_clients_updated_at() FROM PUBLIC;
DROP TRIGGER IF EXISTS hairtech_clients_updated_at ON public.clients;
CREATE TRIGGER hairtech_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.hairtech_clients_updated_at();

CREATE INDEX IF NOT EXISTS hairtech_clients_owner_created
  ON public.clients(user_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'clients'
ORDER BY ordinal_position;
