-- Prevent customer deletion from cascading into permanent project deletion.
-- Safe to run more than once. No customer or project rows are changed.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.clients, public.diagrams IN SHARE ROW EXCLUSIVE MODE;

-- The legacy schema used ON DELETE CASCADE on diagrams.client_id. Replace every
-- single-column client FK with one deterministic RESTRICT constraint. Keep the
-- composite ownership FK created by the diagram contract migration.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.diagrams'::regclass
      AND con.confrelid = 'public.clients'::regclass
      AND con.contype = 'f'
      AND con.conname <> 'hairtech_diagrams_client_owner'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.diagrams DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.diagrams
  ADD CONSTRAINT diagrams_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE RESTRICT;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Metadata only. Expected delete_action is RESTRICT.
SELECT rc.constraint_name, rc.delete_rule
FROM information_schema.referential_constraints rc
WHERE rc.constraint_schema = 'public'
  AND rc.constraint_name IN (
    'diagrams_client_id_fkey',
    'hairtech_diagrams_client_owner'
  )
ORDER BY rc.constraint_name;
