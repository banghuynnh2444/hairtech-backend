import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Disposable PostgreSQL runtime only. No live Supabase credentials are loaded.
const require = createRequire(process.env.HAIRTECH_SQL_TEST_RUNTIME || import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(new URL('../migrations/20260917_phase5_client_photos.sql', import.meta.url), 'utf8');
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE SCHEMA storage;
  CREATE TABLE public.clients(id text PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
  CREATE TABLE storage.buckets(
    id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;
  GRANT ALL ON public.clients TO service_role;
  GRANT ALL ON storage.buckets, storage.objects TO service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
  INSERT INTO public.clients VALUES
    ('client-a','${owner}','Owner'),
    ('client-b','${other}','Other');
`);

await db.exec(migration);
await db.exec(migration);
const bucket = (await db.query("SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='client-photos'")).rows[0];
assert.equal(bucket.public, false);
assert.equal(Number(bucket.file_size_limit), 8388608);
assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp']);

await db.exec('SET ROLE service_role');
const prefix = `users/${owner}/clients/client-a/`;
await db.query(`INSERT INTO client_photos(user_id,client_id,kind,storage_path,original_name,mime_type,size_bytes)
  VALUES($1,'client-a','before',$2,'before.jpg','image/jpeg',100)`, [owner, `${prefix}before/a.jpg`]);
await assert.rejects(db.query(`INSERT INTO client_photos(user_id,client_id,kind,storage_path,original_name,mime_type,size_bytes)
  VALUES($1,'client-a','before',$2,'again.jpg','image/jpeg',100)`, [owner, `${prefix}before/b.jpg`]), /unique constraint/i);
await db.query(`INSERT INTO client_photos(user_id,client_id,kind,storage_path,original_name,mime_type,size_bytes)
  VALUES($1,'client-a','reference',$2,'one.png','image/png',200),
        ($1,'client-a','reference',$3,'two.webp','image/webp',300)`,
  [owner, `${prefix}reference/one.png`, `${prefix}reference/two.webp`]);
assert.equal((await db.query("SELECT count(*)::int AS n FROM client_photos WHERE kind='reference'")).rows[0].n, 2);

await assert.rejects(db.query(`INSERT INTO client_photos(user_id,client_id,kind,storage_path,original_name,mime_type,size_bytes)
  VALUES($1,'client-b','after',$2,'bad.jpg','image/jpeg',100)`,
  [owner, `users/${owner}/clients/client-b/after/bad.jpg`]), /foreign key/i);
await assert.rejects(db.query(`INSERT INTO client_photos(user_id,client_id,kind,storage_path,original_name,mime_type,size_bytes)
  VALUES($1,'client-a','after','wrong/path.jpg','bad.jpg','image/jpeg',100)`, [owner]), /check constraint/i);
await assert.rejects(db.exec("DELETE FROM clients WHERE id='client-a'"), /foreign key/i);

await db.exec('RESET ROLE; SET ROLE authenticated');
await assert.rejects(db.query('SELECT id FROM client_photos'), /permission denied|row-level security/i);
await assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('client-photos','attack')"), /row-level security/i);
await db.exec('RESET ROLE');

await db.close();
console.log('8 phase 5 client photo migration checks passed.');
