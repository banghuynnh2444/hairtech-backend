-- HairTech v2: apply in Supabase SQL Editor before restarting the patched backend.
-- Uses the live columns inspected on 2026-09-15. No customer/device rows are deleted.
BEGIN;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagrams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.clients, public.diagrams FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients, public.diagrams TO authenticated;
GRANT ALL ON public.clients, public.diagrams, public.active_sessions, public.devices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.subscriptions TO service_role;
REVOKE ALL ON public.active_sessions, public.devices FROM PUBLIC, anon, authenticated;

-- Restrictive policies also constrain any pre-existing permissive policies.
DROP POLICY IF EXISTS hairtech_owner_access ON public.clients;
CREATE POLICY hairtech_owner_access ON public.clients FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS hairtech_owner_boundary ON public.clients;
CREATE POLICY hairtech_owner_boundary ON public.clients AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS hairtech_owner_access ON public.diagrams;
CREATE POLICY hairtech_owner_access ON public.diagrams FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS hairtech_owner_boundary ON public.diagrams;
CREATE POLICY hairtech_owner_boundary ON public.diagrams AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- Block user access even if an old policy remains or table grants are later widened.
DROP POLICY IF EXISTS hairtech_backend_only ON public.active_sessions;
CREATE POLICY hairtech_backend_only ON public.active_sessions AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS hairtech_backend_only ON public.devices;
CREATE POLICY hairtech_backend_only ON public.devices AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Abort rather than silently remove duplicates if the database already has them.
CREATE UNIQUE INDEX IF NOT EXISTS hairtech_device_user_fingerprint
  ON public.devices (user_id, device_fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS hairtech_one_session_per_user
  ON public.active_sessions (user_id);

CREATE OR REPLACE FUNCTION public.initialize_trial_account(
  p_user_id uuid, p_email text, p_full_name text
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- A Supabase Auth trigger may already have inserted the profile.
  INSERT INTO public.profiles (id, email, full_name)
    VALUES (p_user_id, p_email, p_full_name)
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name;

  -- Only called immediately after backend createUser returns a NEW Auth user.
  -- Preserve an existing trigger-created subscription's billing configuration.
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = p_user_id) THEN
    INSERT INTO public.subscriptions (user_id, plan_tier, status, current_period_start, current_period_end)
      VALUES (p_user_id, 'free_trial', 'active', now(), now() + interval '14 days');
  ELSE
    UPDATE public.subscriptions SET current_period_end = now() + interval '14 days'
      WHERE user_id = p_user_id AND plan_tier = 'free_trial' AND status = 'active';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_device(
  p_user_id uuid, p_fingerprint text, p_device_name text, p_platform text
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_device_id uuid;
BEGIN
  IF p_fingerprint IS NULL OR length(btrim(p_fingerprint)) = 0 OR length(p_fingerprint) > 256 THEN
    RAISE EXCEPTION 'INVALID_DEVICE_FINGERPRINT';
  END IF;

  -- Serialize all device registrations for this user, across requests/processes.
  PERFORM id FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  SELECT id INTO v_device_id FROM public.devices
    WHERE user_id = p_user_id AND device_fingerprint = btrim(p_fingerprint);
  IF v_device_id IS NOT NULL THEN
    UPDATE public.devices SET last_seen = now() WHERE id = v_device_id;
    RETURN v_device_id;
  END IF;

  IF (SELECT count(*) FROM public.devices WHERE user_id = p_user_id) >= 2 THEN
    RAISE EXCEPTION 'DEVICE_LIMIT_EXCEEDED';
  END IF;

  INSERT INTO public.devices (user_id, device_fingerprint, device_name, platform)
    VALUES (p_user_id, btrim(p_fingerprint), p_device_name, p_platform)
    RETURNING id INTO v_device_id;
  RETURN v_device_id;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_trial_account(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_device(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_trial_account(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_device(uuid, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Inspect policies and grants after applying (no customer data returned).
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('clients', 'diagrams', 'devices', 'active_sessions');
