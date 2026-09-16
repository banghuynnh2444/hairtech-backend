import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Disposable PostgreSQL runtime only. This test never reads .env or live Supabase data.
const require = createRequire(process.env.HAIRTECH_SQL_TEST_RUNTIME || import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(new URL('../migrations/20260916_phase3_clients.sql', import.meta.url), 'utf8');

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
  CREATE TABLE public.clients(id text PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
  INSERT INTO public.clients(id,user_id,name) VALUES ('legacy','${owner}','Khách cũ');
`);

await db.exec(migration);
const legacy = (await db.query("SELECT * FROM clients WHERE id='legacy'")).rows[0];
assert.equal(legacy.name, 'Khách cũ');
assert.equal(legacy.phone, null);
assert.equal(legacy.note, null);
assert.ok(legacy.created_at);
assert.ok(legacy.updated_at);

await db.query(
  'INSERT INTO clients(user_id,name,phone,note) VALUES ($1,$2,$3,$4)',
  [owner, 'Nguyễn Văn A', '0901000000', 'Khách quen'],
);
const created = (await db.query("SELECT * FROM clients WHERE name='Nguyễn Văn A'")).rows[0];
assert.match(created.id, /^[\da-f-]{36}$/);
assert.equal(created.phone, '0901000000');
assert.equal(created.note, 'Khách quen');

const originalCreatedAt = created.created_at.getTime();
await new Promise((resolve) => setTimeout(resolve, 5));
await db.query('UPDATE clients SET phone=$1, created_at=$2 WHERE id=$3', ['0902000000', '2000-01-01', created.id]);
const updated = (await db.query('SELECT * FROM clients WHERE id=$1', [created.id])).rows[0];
assert.equal(updated.created_at.getTime(), originalCreatedAt);
assert.ok(updated.updated_at.getTime() >= created.updated_at.getTime());

await assert.rejects(
  db.query('INSERT INTO clients(user_id,name) VALUES ($1,$2)', [owner, ' '.repeat(4)]),
  /check constraint/i,
);
await assert.rejects(
  db.query('INSERT INTO clients(user_id,name,phone) VALUES ($1,$2,$3)', [owner, 'Bad phone', '1'.repeat(33)]),
  /check constraint/i,
);

const snapshot = JSON.stringify((await db.query('SELECT * FROM clients ORDER BY id')).rows);
await db.exec(migration);
assert.equal(JSON.stringify((await db.query('SELECT * FROM clients ORDER BY id')).rows), snapshot);

await db.close();
console.log('6 phase 3 client migration checks passed.');
