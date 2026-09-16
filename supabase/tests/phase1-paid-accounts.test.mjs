import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Disposable PostgreSQL runtime only. This test never reads .env or live Supabase data.
const require = createRequire(process.env.HAIRTECH_SQL_TEST_RUNTIME || import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const security = fs.readFileSync(new URL('../migrations/20260915_security_fix.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/20260916_phase1_paid_accounts.sql', import.meta.url), 'utf8');
let passed = 0;
const ok = label => { passed++; console.log('PASS ' + label); };

const ids = {
  historical: '11111111-1111-4111-8111-111111111111',
  pending: '22222222-2222-4222-8222-222222222222',
  invalidSub: '33333333-3333-4333-8333-333333333333',
};
const hash1 = 'a'.repeat(64);
const hash2 = 'b'.repeat(64);
const hash3 = 'c'.repeat(64);

async function database(withSecurity = true) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, email text NOT NULL, full_name text,
      role text NOT NULL DEFAULT 'salon_owner', is_approved boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
      plan_tier text NOT NULL DEFAULT 'free_trial' CHECK (plan_tier IN ('free_trial','pro_monthly','pro_yearly')),
      status text NOT NULL DEFAULT 'active', current_period_start timestamptz NOT NULL DEFAULT now(),
      current_period_end timestamptz NOT NULL DEFAULT now() + interval '7 days',
      cancel_at_period_end boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
      device_fingerprint text NOT NULL, device_name text NOT NULL, platform text NOT NULL,
      is_active boolean NOT NULL DEFAULT true, first_seen timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.active_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
      device_id uuid NOT NULL REFERENCES public.devices(id), session_token_hash text NOT NULL,
      last_heartbeat timestamptz NOT NULL DEFAULT now(), ip_address inet,
      client_version text DEFAULT '2.0.0', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.device_change_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, old_device_id uuid,
      new_device_id uuid, reason text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.clients(id text PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
    CREATE TABLE public.diagrams(id text PRIMARY KEY, user_id uuid NOT NULL, client_id text,
      type text NOT NULL, name text NOT NULL, notes text, image text, history_data jsonb, timestamp bigint);
  `);
  if (withSecurity) await db.exec(security);
  return db;
}

// The previous release allowed two devices. Migration retains rows but keeps the newest active.
const normalize = await database();
await normalize.exec('SET ROLE service_role');
await normalize.query('SELECT public.initialize_trial_account($1,$2,$3)', [ids.historical, 'normalize@example.invalid', 'Normalize']);
await normalize.query(`INSERT INTO devices(user_id,device_fingerprint,device_name,platform,is_active,last_seen)
  VALUES($1,'pc-a','A','windows',true,now()-interval '2 days'),
        ($1,'pc-b','B','windows',true,now()-interval '1 day')`, [ids.historical]);
await normalize.exec('RESET ROLE');
await normalize.exec(migration);
assert.deepEqual((await normalize.query('SELECT device_fingerprint FROM devices WHERE is_active')).rows, [{ device_fingerprint: 'pc-b' }]);
assert.equal((await normalize.query('SELECT count(*)::int AS n FROM devices')).rows[0].n, 2);
ok('legacy two-device accounts retain history and keep only the most recently used device active');
await normalize.close();

// Ambiguous billing data must fail before the transaction makes partial changes.
const unsafe = await database();
await unsafe.exec('SET ROLE service_role');
await unsafe.query('SELECT public.initialize_trial_account($1,$2,$3)', [ids.historical, 'unsafe@example.invalid', 'Unsafe']);
await unsafe.query(`INSERT INTO subscriptions(user_id,plan_tier,status,current_period_start,current_period_end)
  VALUES($1,'free_trial','active',now(),now()+interval '7 days')`, [ids.historical]);
await unsafe.exec('RESET ROLE');
await assert.rejects(unsafe.exec(migration), /PHASE1_MULTIPLE_SUBSCRIPTIONS/);
await unsafe.exec('ROLLBACK');
assert.equal((await unsafe.query("SELECT column_default FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='plan_tier'")).rows[0].column_default, "'free_trial'::text");
assert.equal((await unsafe.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='hairtech_one_active_device'")).rows[0].n, 0);
ok('ambiguous subscription data aborts the complete migration');
await unsafe.close();

const unsafeSessions = await database(false);
await unsafeSessions.query(`INSERT INTO profiles(id,email,full_name)
  VALUES($1,'sessions@example.invalid','Sessions')`, [ids.historical]);
const unsafeDevice = (await unsafeSessions.query(`INSERT INTO devices(user_id,device_fingerprint,device_name,platform)
  VALUES($1,'only-pc','Only PC','windows') RETURNING id`, [ids.historical])).rows[0].id;
await unsafeSessions.query(`INSERT INTO active_sessions(user_id,device_id,session_token_hash)
  VALUES($1,$2,$3),($1,$2,$4)`, [ids.historical, unsafeDevice, hash1, hash2]);
await assert.rejects(unsafeSessions.exec(migration), /PHASE1_MULTIPLE_SESSIONS/);
await unsafeSessions.exec('ROLLBACK');
assert.equal((await unsafeSessions.query('SELECT count(*)::int AS n FROM active_sessions')).rows[0].n, 2);
ok('duplicate existing sessions abort without silently deleting session rows');
await unsafeSessions.close();

const db = await database();
await db.exec('SET ROLE service_role');
await db.query('SELECT public.initialize_trial_account($1,$2,$3)', [ids.historical, 'old@example.invalid', 'Historical']);
const legacyDevice = (await db.query(`INSERT INTO devices(user_id,device_fingerprint,device_name,platform)
  VALUES($1,'old-pc','Old PC','windows') RETURNING id`, [ids.historical])).rows[0].id;
await db.query('INSERT INTO active_sessions(user_id,device_id,session_token_hash) VALUES($1,$2,$3)', [ids.historical, legacyDevice, hash1]);
await db.exec('RESET ROLE');

// Simulate an old database signup trigger that used to auto-create a free trial.
await db.exec(`
  CREATE FUNCTION public.legacy_auto_trial() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN INSERT INTO public.subscriptions(user_id) VALUES(NEW.id); RETURN NEW; END $$;
  CREATE TRIGGER legacy_auto_trial AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.legacy_auto_trial();
`);
await db.exec(migration);
await db.exec(migration);
ok('phase 1 migration applies twice without changing its contract');

assert.equal((await db.query('SELECT count(*)::int AS n FROM active_sessions')).rows[0].n, 0);
assert.equal((await db.query("SELECT column_default FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='plan_tier'")).rows[0].column_default, null);
assert.equal((await db.query("SELECT column_default FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='current_period_end'")).rows[0].column_default, null);
ok('historical trial cannot keep a session and implicit trial defaults are removed');

await db.exec('SET ROLE service_role');
await db.query('SELECT public.initialize_account($1,$2,$3)', [ids.pending, 'pending@example.invalid', 'Pending Salon']);
let pending = (await db.query('SELECT is_approved FROM profiles WHERE id=$1', [ids.pending])).rows[0];
assert.equal(pending.is_approved, false);
assert.equal((await db.query('SELECT count(*)::int AS n FROM subscriptions WHERE user_id=$1', [ids.pending])).rows[0].n, 0);
await db.query('SELECT public.initialize_trial_account($1,$2,$3)', [ids.invalidSub, 'compat@example.invalid', 'Compatibility']);
assert.equal((await db.query('SELECT count(*)::int AS n FROM subscriptions WHERE user_id=$1', [ids.invalidSub])).rows[0].n, 0);
ok('new and compatibility registration create pending profiles without a trial');

await assert.rejects(db.query(`INSERT INTO subscriptions(user_id,plan_tier,status,current_period_start,current_period_end)
  VALUES($1,'free_trial','active',now(),now()+interval '14 days')`, [ids.pending]), /PAID_PLAN_REQUIRED/);
ok('direct free-trial provisioning is rejected');

const open = (user, fingerprint, hash) => db.query(
  'SELECT public.open_account_session($1,$2,$3,$4,$5,$6) AS id',
  [user, fingerprint, 'Windows PC', 'windows', hash, '0.1.0'],
);
await assert.rejects(open(ids.pending, 'pending-pc', hash1), /ACCOUNT_NOT_APPROVED/);
assert.equal((await db.query('SELECT count(*)::int AS n FROM devices WHERE user_id=$1', [ids.pending])).rows[0].n, 0);
await db.query('UPDATE profiles SET is_approved=true WHERE id=$1', [ids.pending]);
await assert.rejects(open(ids.pending, 'pending-pc', hash1), /NO_SUBSCRIPTION/);
assert.equal((await db.query('SELECT count(*)::int AS n FROM active_sessions WHERE user_id=$1', [ids.pending])).rows[0].n, 0);
ok('unapproved or unsubscribed accounts create no device, session or token source');

await db.query(`INSERT INTO subscriptions(user_id,plan_tier,status,current_period_start,current_period_end)
  VALUES($1,'pro_monthly','inactive',now()-interval '1 day',now()+interval '30 days')`, [ids.pending]);
await assert.rejects(open(ids.pending, 'pending-pc', hash1), /SUBSCRIPTION_INACTIVE/);
await db.query("UPDATE subscriptions SET status='active',current_period_end=now()-interval '1 second' WHERE user_id=$1", [ids.pending]);
await assert.rejects(open(ids.pending, 'pending-pc', hash1), /SUBSCRIPTION_EXPIRED/);
await db.query("UPDATE subscriptions SET current_period_start=now()+interval '1 day',current_period_end=now()+interval '31 days' WHERE user_id=$1", [ids.pending]);
await assert.rejects(open(ids.pending, 'pending-pc', hash1), /SUBSCRIPTION_NOT_STARTED/);
ok('inactive, expired and future subscriptions are denied by the database');

await db.query('UPDATE profiles SET is_approved=true WHERE id=$1', [ids.historical]);
await db.query(`UPDATE subscriptions SET plan_tier='pro_monthly',status='active',
  current_period_start=now()-interval '1 day',current_period_end=now()+interval '30 days'
  WHERE user_id=$1`, [ids.historical]);
const firstDevice = (await open(ids.historical, 'old-pc', hash1)).rows[0].id;
assert.equal((await db.query('SELECT count(*)::int AS n FROM devices WHERE user_id=$1 AND is_active', [ids.historical])).rows[0].n, 1);
assert.equal((await db.query('SELECT count(*)::int AS n FROM active_sessions WHERE user_id=$1', [ids.historical])).rows[0].n, 1);
await assert.rejects(open(ids.historical, 'pc-b', hash2), /DEVICE_LIMIT_EXCEEDED/);
assert.equal((await db.query('SELECT count(*)::int AS n FROM devices WHERE user_id=$1', [ids.historical])).rows[0].n, 1);
ok('one active device is retained and a different machine is blocked without mutation');

assert.equal((await open(ids.historical, 'old-pc', hash2)).rows[0].id, firstDevice);
assert.equal((await db.query('SELECT session_token_hash FROM active_sessions WHERE user_id=$1', [ids.historical])).rows[0].session_token_hash, hash2);
await db.query('SELECT public.close_account_session($1,$2)', [ids.historical, hash1]);
assert.equal((await db.query('SELECT count(*)::int AS n FROM active_sessions WHERE user_id=$1', [ids.historical])).rows[0].n, 1);
await assert.rejects(db.query('SELECT public.verify_account_session($1,$2,$3,$4,true)', [ids.historical, hash1, firstDevice, 'old-pc']), /SESSION_TERMINATED/);
const expiry = (await db.query('SELECT public.verify_account_session($1,$2,$3,$4,true) AS expiry', [ids.historical, hash2, firstDevice, 'old-pc'])).rows[0].expiry;
assert.ok(expiry instanceof Date || Number.isFinite(Date.parse(expiry)));
ok('same device replaces one session; an old token cannot revoke the new login');

await assert.rejects(db.query(`INSERT INTO devices(user_id,device_fingerprint,device_name,platform,is_active)
  VALUES($1,'direct-second','Second','windows',true)`, [ids.historical]), /unique constraint/i);
await db.query('SELECT public.reset_account_device($1)', [ids.historical]);
assert.equal((await db.query('SELECT count(*)::int AS n FROM active_sessions WHERE user_id=$1', [ids.historical])).rows[0].n, 0);
assert.equal((await db.query('SELECT count(*)::int AS n FROM devices WHERE user_id=$1 AND is_active', [ids.historical])).rows[0].n, 0);
const replacement = (await open(ids.historical, 'pc-b', hash3)).rows[0].id;
assert.notEqual(replacement, firstDevice);
ok('admin reset invalidates the old device/session and permits a replacement machine');

await db.query('UPDATE profiles SET is_approved=false WHERE id=$1', [ids.historical]);
assert.equal((await db.query('SELECT count(*)::int AS n FROM active_sessions WHERE user_id=$1', [ids.historical])).rows[0].n, 0);
await db.query('UPDATE profiles SET is_approved=true WHERE id=$1', [ids.historical]);
await open(ids.historical, 'pc-b', hash3);
await db.query("UPDATE subscriptions SET current_period_end=now()-interval '1 second' WHERE user_id=$1", [ids.historical]);
assert.equal((await db.query('SELECT count(*)::int AS n FROM active_sessions WHERE user_id=$1', [ids.historical])).rows[0].n, 0);
ok('approval revocation and subscription expiry immediately revoke the session');

await db.exec('RESET ROLE; SET ROLE authenticated');
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [ids.historical]);
await assert.rejects(db.query('UPDATE profiles SET is_approved=true WHERE id=$1', [ids.historical]), /permission denied/i);
await assert.rejects(open(ids.historical, 'pc-b', hash3), /permission denied/i);
ok('desktop roles cannot self-approve, provision access or invoke backend session RPCs');
await db.exec('RESET ROLE');
await db.close();

console.log(`${passed} phase 1 SQL checks passed.`);
