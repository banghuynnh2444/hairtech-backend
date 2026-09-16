-- Phase 1: approval + paid subscription + one active device/session. NO free trial.
-- Apply after phase 0. Do not edit/rerun historical migrations after this one.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.profiles, public.subscriptions, public.devices, public.active_sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$ BEGIN
  IF EXISTS (SELECT user_id FROM public.subscriptions GROUP BY user_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'PHASE1_MULTIPLE_SUBSCRIPTIONS: review duplicate subscriptions before migrating';
  END IF;
  IF EXISTS (SELECT user_id FROM public.active_sessions GROUP BY user_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'PHASE1_MULTIPLE_SESSIONS: revoke duplicate sessions, then rerun';
  END IF;
  IF EXISTS (
    SELECT user_id, device_fingerprint FROM public.devices
    GROUP BY user_id, device_fingerprint HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PHASE1_DUPLICATE_DEVICE_FINGERPRINTS: review duplicate device rows before migrating';
  END IF;
END $$;

-- The previous release allowed two active devices. Keep the most recently used one,
-- retain all older rows for audit, and revoke sessions attached to devices made inactive.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id ORDER BY last_seen DESC NULLS LAST, first_seen DESC NULLS LAST, id DESC
  ) AS position
  FROM public.devices
  WHERE is_active
)
UPDATE public.devices AS device
SET is_active = false
FROM ranked
WHERE device.id = ranked.id AND ranked.position > 1;

DELETE FROM public.active_sessions AS session
USING public.devices AS device
WHERE session.device_id = device.id AND device.is_active = false;

CREATE UNIQUE INDEX IF NOT EXISTS hairtech_one_active_device ON public.devices(user_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS hairtech_one_subscription ON public.subscriptions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS hairtech_one_session_per_user ON public.active_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS hairtech_device_user_fingerprint ON public.devices(user_id, device_fingerprint);

-- No implicit plan or duration. Paid provisioning must supply both explicitly.
ALTER TABLE public.subscriptions ALTER COLUMN plan_tier DROP DEFAULT,
  ALTER COLUMN current_period_end DROP DEFAULT;
ALTER TABLE public.active_sessions ALTER COLUMN client_version DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.hairtech_paid_subscriptions_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.plan_tier = 'free_trial' AND NEW.plan_tier = OLD.plan_tier THEN
    RETURN NEW; -- preserve historical billing records; access checks never accept them
  END IF;
  IF NEW.plan_tier IS NULL OR NEW.plan_tier = 'free_trial' THEN
    -- Old auth/profile signup triggers may still attempt an automatic trial INSERT.
    -- Suppress that row without failing account registration or creating an entitlement.
    IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'PAID_PLAN_REQUIRED';
  END IF;
  IF NEW.plan_tier NOT IN ('pro_monthly', 'pro_yearly') THEN RAISE EXCEPTION 'PAID_PLAN_REQUIRED'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hairtech_paid_subscriptions_only ON public.subscriptions;
CREATE TRIGGER hairtech_paid_subscriptions_only BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.hairtech_paid_subscriptions_only();

CREATE OR REPLACE FUNCTION public.initialize_account(p_user_id uuid, p_email text, p_full_name text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id, email, full_name, is_approved)
    VALUES(p_user_id, p_email, p_full_name, false)
    ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email, full_name=EXCLUDED.full_name;
END $$;
-- Keep old RPC signature for compatibility; it no longer creates/extends any plan.
CREATE OR REPLACE FUNCTION public.initialize_trial_account(p_user_id uuid, p_email text, p_full_name text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN PERFORM public.initialize_account(p_user_id, p_email, p_full_name); END $$;
-- Fail closed if an old backend still tries the former two-device flow.
CREATE OR REPLACE FUNCTION public.register_device(p_user_id uuid, p_fingerprint text, p_device_name text, p_platform text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'BACKEND_UPGRADE_REQUIRED'; END $$;

CREATE OR REPLACE FUNCTION public.hairtech_require_entitlement(p_user_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE approved boolean; sub public.subscriptions%ROWTYPE;
BEGIN
  SELECT is_approved INTO approved FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF approved IS DISTINCT FROM true THEN RAISE EXCEPTION 'ACCOUNT_NOT_APPROVED'; END IF;
  SELECT * INTO sub FROM public.subscriptions WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_SUBSCRIPTION'; END IF;
  IF sub.plan_tier NOT IN ('pro_monthly','pro_yearly') OR sub.plan_tier IS NULL THEN RAISE EXCEPTION 'PAID_PLAN_REQUIRED'; END IF;
  IF sub.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'SUBSCRIPTION_INACTIVE'; END IF;
  IF sub.current_period_end IS NULL OR sub.current_period_end <= now() THEN RAISE EXCEPTION 'SUBSCRIPTION_EXPIRED'; END IF;
  IF sub.current_period_start IS NULL OR sub.current_period_start > now() THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_STARTED'; END IF;
  RETURN sub.current_period_end;
END $$;

CREATE OR REPLACE FUNCTION public.open_account_session(
  p_user_id uuid, p_fingerprint text, p_device_name text, p_platform text,
  p_session_hash text, p_client_version text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE dev public.devices%ROWTYPE;
BEGIN
  -- Lock profile then subscription; all checks precede any device/session mutation.
  PERFORM public.hairtech_require_entitlement(p_user_id);
  IF p_fingerprint IS NULL OR length(btrim(p_fingerprint)) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'INVALID_DEVICE_FINGERPRINT'; END IF;
  IF p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_SESSION_HASH'; END IF;
  IF p_device_name IS NULL OR length(btrim(p_device_name)) NOT BETWEEN 1 AND 128
    OR p_platform IS NULL OR length(btrim(p_platform)) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'INVALID_DEVICE_METADATA'; END IF;
  IF length(p_client_version) > 64 THEN RAISE EXCEPTION 'INVALID_DEVICE_METADATA'; END IF;
  SELECT * INTO dev FROM public.devices WHERE user_id=p_user_id AND is_active FOR UPDATE;
  IF FOUND AND dev.device_fingerprint <> btrim(p_fingerprint) THEN RAISE EXCEPTION 'DEVICE_LIMIT_EXCEEDED'; END IF;
  IF dev.id IS NULL THEN
    SELECT * INTO dev FROM public.devices WHERE user_id=p_user_id AND device_fingerprint=btrim(p_fingerprint) FOR UPDATE;
    IF dev.id IS NULL THEN
      INSERT INTO public.devices(user_id,device_fingerprint,device_name,platform,is_active)
        VALUES(p_user_id,btrim(p_fingerprint),p_device_name,p_platform,true) RETURNING * INTO dev;
    ELSE
      UPDATE public.devices SET is_active=true WHERE id=dev.id;
    END IF;
  END IF;
  UPDATE public.devices SET last_seen=now(),device_name=p_device_name,platform=p_platform WHERE id=dev.id;
  INSERT INTO public.active_sessions(user_id,device_id,session_token_hash,client_version,last_heartbeat)
    VALUES(p_user_id,dev.id,p_session_hash,p_client_version,now())
    ON CONFLICT(user_id) DO UPDATE SET device_id=EXCLUDED.device_id,
      session_token_hash=EXCLUDED.session_token_hash,client_version=EXCLUDED.client_version,last_heartbeat=EXCLUDED.last_heartbeat;
  RETURN dev.id;
END $$;

CREATE OR REPLACE FUNCTION public.verify_account_session(
  p_user_id uuid, p_session_hash text, p_device_id uuid,
  p_fingerprint text DEFAULT NULL, p_touch boolean DEFAULT false
) RETURNS timestamptz LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expiry timestamptz;
BEGIN
  expiry := public.hairtech_require_entitlement(p_user_id);
  PERFORM id FROM public.devices WHERE id=p_device_id AND user_id=p_user_id AND is_active
    AND (p_fingerprint IS NULL OR device_fingerprint=btrim(p_fingerprint)) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_NOT_ACTIVE'; END IF;
  PERFORM id FROM public.active_sessions WHERE user_id=p_user_id AND device_id=p_device_id
    AND session_token_hash=p_session_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_TERMINATED'; END IF;
  IF p_touch THEN
    UPDATE public.active_sessions SET last_heartbeat=now() WHERE user_id=p_user_id AND session_token_hash=p_session_hash;
    UPDATE public.devices SET last_seen=now() WHERE id=p_device_id;
  END IF;
  RETURN expiry;
END $$;

CREATE OR REPLACE FUNCTION public.close_account_session(p_user_id uuid,p_session_hash text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  -- An older token must never delete a newer login's session.
  DELETE FROM public.active_sessions WHERE user_id=p_user_id AND session_token_hash=p_session_hash;
END $$;
CREATE OR REPLACE FUNCTION public.reset_account_device(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM id FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  UPDATE public.devices SET is_active=false WHERE user_id=p_user_id AND is_active;
  DELETE FROM public.active_sessions WHERE user_id=p_user_id;
END $$;

CREATE OR REPLACE FUNCTION public.hairtech_revoke_changed_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME='profiles' THEN
    IF NEW.is_approved IS DISTINCT FROM true THEN DELETE FROM public.active_sessions WHERE user_id=NEW.id; END IF;
  ELSIF TG_TABLE_NAME='subscriptions' THEN
    IF TG_OP='DELETE' THEN DELETE FROM public.active_sessions WHERE user_id=OLD.user_id;
    ELSE
      IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN DELETE FROM public.active_sessions WHERE user_id=OLD.user_id; END IF;
      IF NEW.plan_tier NOT IN ('pro_monthly','pro_yearly') OR NEW.status IS DISTINCT FROM 'active'
        OR NEW.current_period_end <= now() OR NEW.current_period_start > now() THEN
        DELETE FROM public.active_sessions WHERE user_id=NEW.user_id;
      END IF;
    END IF;
  ELSE
    IF TG_OP='DELETE' THEN DELETE FROM public.active_sessions WHERE device_id=OLD.id;
    ELSIF NOT NEW.is_active OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.device_fingerprint IS DISTINCT FROM OLD.device_fingerprint THEN
      DELETE FROM public.active_sessions WHERE device_id=OLD.id;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hairtech_approval_revoke ON public.profiles;
CREATE TRIGGER hairtech_approval_revoke AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.hairtech_revoke_changed_access();
DROP TRIGGER IF EXISTS hairtech_subscription_revoke ON public.subscriptions;
CREATE TRIGGER hairtech_subscription_revoke AFTER UPDATE OR DELETE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.hairtech_revoke_changed_access();
DROP TRIGGER IF EXISTS hairtech_device_revoke ON public.devices;
CREATE TRIGGER hairtech_device_revoke BEFORE UPDATE OR DELETE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.hairtech_revoke_changed_access();

-- Existing free-trial records remain for audit, but never authorize an active session.
DELETE FROM public.active_sessions a WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p JOIN public.subscriptions s ON s.user_id=p.id
  JOIN public.devices d ON d.user_id=p.id AND d.id=a.device_id AND d.is_active
  WHERE p.id=a.user_id AND p.is_approved AND s.status='active'
    AND s.plan_tier IN ('pro_monthly','pro_yearly') AND s.current_period_start<=now() AND s.current_period_end>now());

-- Users cannot self-approve or provision their own subscription via direct REST.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE INSERT,UPDATE,DELETE ON public.profiles,public.subscriptions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles,public.subscriptions TO service_role;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['profiles','subscriptions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS hairtech_no_user_insert ON public.%I',tab);
    EXECUTE format('CREATE POLICY hairtech_no_user_insert ON public.%I AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(false)',tab);
    EXECUTE format('DROP POLICY IF EXISTS hairtech_no_user_update ON public.%I',tab);
    EXECUTE format('CREATE POLICY hairtech_no_user_update ON public.%I AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(false) WITH CHECK(false)',tab);
    EXECUTE format('DROP POLICY IF EXISTS hairtech_no_user_delete ON public.%I',tab);
    EXECUTE format('CREATE POLICY hairtech_no_user_delete ON public.%I AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(false)',tab);
  END LOOP;
END $$;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace
    AND proname IN ('initialize_account','initialize_trial_account','register_device','hairtech_require_entitlement',
      'open_account_session','verify_account_session','close_account_session','reset_account_device',
      'hairtech_paid_subscriptions_only','hairtech_revoke_changed_access') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;

SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
  AND indexname IN ('hairtech_one_active_device','hairtech_one_subscription','hairtech_one_session_per_user');
