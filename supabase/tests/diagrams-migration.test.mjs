import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Use a disposable SQL test runtime. No connection to Supabase or .env is used.
const require = createRequire(process.env.HAIRTECH_SQL_TEST_RUNTIME || import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(new URL('../migrations/20260916_diagrams_contract.sql', import.meta.url), 'utf8');
const security = fs.readFileSync(new URL('../migrations/20260915_security_fix.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let passed = 0;
function ok(label) { console.log('PASS ' + label); passed++; }

async function database(alternate = false) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
    CREATE TABLE profiles(id uuid PRIMARY KEY, email text, full_name text);
    CREATE TABLE subscriptions(user_id uuid, plan_tier text, status text, current_period_start timestamptz, current_period_end timestamptz);
    CREATE TABLE devices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, device_fingerprint text, device_name text, platform text, last_seen timestamptz);
    CREATE TABLE active_sessions(user_id uuid);
    CREATE TABLE clients(id text PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
    CREATE TABLE diagrams(id text PRIMARY KEY, user_id uuid NOT NULL, client_id text REFERENCES clients(id),
      ${alternate ? 'title text NOT NULL, data jsonb NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()'
      : 'type text NOT NULL, name text NOT NULL, notes text, image text, history_data jsonb, timestamp bigint NOT NULL'});
    INSERT INTO clients VALUES ('c1','${owner}','One'),('c2','${other}','Two');
  `);
  await db.exec(security);
  return db;
}
const db = await database();
const history = [{ kind: 'texture', action: { type: 'line', x1: 0, x2: 99 } }, { kind: 'permRod', sizeMM: 19 }];
await db.query('INSERT INTO diagrams VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  ['d1', owner, 'c1', 'perm', 'Before', 'Notes', 'data:image/png;base64,AAAA', JSON.stringify(history), 1789516800123]);
await db.query('INSERT INTO diagrams VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  ['d2', other, 'c2', '3d', 'Second', null, 'https://example.invalid/t.png', '{}', 1789516800456]);
const before = (await db.query('SELECT to_jsonb(d) AS row FROM diagrams d ORDER BY id')).rows;
await db.exec(migration);
const rows = (await db.query('SELECT to_jsonb(d) AS row FROM diagrams d ORDER BY id')).rows;
for (let i = 0; i < before.length; i++) for (const [key, value] of Object.entries(before[i].row)) assert.deepEqual(rows[i].row[key], value);
assert.equal(rows.length, before.length);
assert.deepEqual(rows[0].row.project_data, { version: 0, legacy: { history_data: history, data: null } });
assert.equal(rows[0].row.thumbnail_url, null);
assert.equal(rows[1].row.thumbnail_url, 'https://example.invalid/t.png');
assert.equal(Date.parse(rows[0].row.created_at), 1789516800123);
ok('legacy values, millisecond timestamp and embedded image preserved; HTTPS thumbnail migrated');

const migrated = JSON.stringify(rows);
await db.exec(migration);
assert.equal(JSON.stringify((await db.query('SELECT to_jsonb(d) AS row FROM diagrams d ORDER BY id')).rows), migrated);
ok('rerunning migration does not change project data or timestamps');

const project = { version: 1, drawing_2d: [{ id: 'line1', points: [[1, 2], [3, 4]] }],
  nodes_3d: [{ id: 'n1', root: [0, 1, 0], normal: [0, 1, 0] }], sections: [{ id: 's1', points: [[0, 1, 0]] }],
  perm_rods: [{ id: 'p1', size_mm: 19 }], waves: [{ id: 'w1', wave_type: 'curlS' }],
  timeline: { entries: [{ kind: 'create', entity_id: 'n1' }, { kind: 'clear_all' }], cursor: 1 },
  camera: { position: [0, 0.5, 4.3], target: [0, 0.3, 0], zoom: 1 }, settings: { snap: true } };
await db.query('INSERT INTO diagrams (id,user_id,client_id,type,name,project_data) VALUES ($1,$2,$3,$4,$5,$6)',
  ['new', owner, 'c1', '3d', 'Project', JSON.stringify(project)]);
assert.deepEqual((await db.query("SELECT project_data FROM diagrams WHERE id='new'")).rows[0].project_data, project);
ok('new canonical document roundtrip includes all scene sections, camera, settings and redo history');
const times = (await db.query("SELECT created_at,updated_at FROM diagrams WHERE id='new'")).rows[0];
await db.exec("UPDATE diagrams SET name='Renamed', created_at='2000-01-01', updated_at='2000-01-01' WHERE id='new'");
const renamed = (await db.query("SELECT * FROM diagrams WHERE id='new'")).rows[0];
assert.equal(renamed.created_at.getTime(), times.created_at.getTime());
assert.ok(Date.parse(renamed.updated_at) >= Date.parse(times.updated_at));
assert.deepEqual(renamed.project_data, project);
ok('metadata update preserves project and creation time; database sets update time');

await assert.rejects(db.query('INSERT INTO diagrams(id,user_id,client_id,type,name,project_data) VALUES ($1,$2,$3,$4,$5,$6)',
  ['bad-link', owner, 'c2', '3d', 'Bad', JSON.stringify(project)]), /foreign key/i);
await assert.rejects(db.exec("UPDATE diagrams SET client_id='c2' WHERE id='new'"), /foreign key/i);
ok('database rejects cross-owner client links on create and update');
await assert.rejects(db.exec("UPDATE diagrams SET project_data='{}' WHERE id='new'"), /check constraint/i);
await assert.rejects(db.exec("UPDATE diagrams SET project_data='{\"version\":2}' WHERE id='new'"), /check constraint/i);
ok('database rejects missing and unsupported project versions');
await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';`);
assert.deepEqual((await db.query('SELECT id FROM diagrams ORDER BY id')).rows, [{ id: 'd1' }, { id: 'new' }]);
assert.equal((await db.query("UPDATE diagrams SET name='attack' WHERE id='d2' RETURNING id")).rows.length, 0);
assert.equal((await db.query("DELETE FROM diagrams WHERE id='d2' RETURNING id")).rows.length, 0);
ok('RLS remains active for foreign reads, updates and deletes');
await db.exec('RESET ROLE; SET ROLE anon;');
await assert.rejects(db.query('SELECT id FROM diagrams'), /permission denied/i);
await db.exec('RESET ROLE;');
ok('anonymous access remains denied');
await db.exec("UPDATE diagrams SET thumbnail_url=NULL WHERE id='d2'");
const cleared = (await db.query("SELECT updated_at FROM diagrams WHERE id='d2'")).rows[0].updated_at;
await db.exec(migration);
const stillCleared = (await db.query("SELECT thumbnail_url,updated_at FROM diagrams WHERE id='d2'")).rows[0];
assert.equal(stillCleared.thumbnail_url, null);
assert.equal(stillCleared.updated_at.getTime(), cleared.getTime());
ok('rerun preserves later thumbnail clearing and updated timestamps');
await db.close();

const alt = await database(true);
await alt.query('INSERT INTO diagrams(id,user_id,client_id,title,data,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
  ['alt', owner, 'c1', 'Old title', JSON.stringify({ nodes: [1, 2, 3] }), '2020-01-02T03:04:05Z']);
await alt.exec(migration);
const converted = (await alt.query("SELECT * FROM diagrams WHERE id='alt'")).rows[0];
assert.equal(converted.name, 'Old title');
assert.equal(converted.type, 'legacy');
assert.deepEqual(converted.project_data.legacy.data, { nodes: [1, 2, 3] });
assert.equal(Date.parse(converted.created_at), Date.parse('2020-01-02T03:04:05Z'));
await alt.query('INSERT INTO diagrams(user_id,type,name,project_data) VALUES ($1,$2,$3,$4)', [owner, '3d', 'New', JSON.stringify(project)]);
ok('alternate title/data schema migrates and old required fields do not block new writes');
await alt.close();

const invalid = await database();
await invalid.query('INSERT INTO diagrams(id,user_id,client_id,type,name,timestamp) VALUES ($1,$2,$3,$4,$5,$6)', ['bad', owner, 'c2', '3d', 'Bad link', 1000]);
await assert.rejects(invalid.exec(migration), /PHASE0_CLIENT_OWNERSHIP/);
await invalid.exec('ROLLBACK');
assert.equal((await invalid.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='diagrams' AND column_name='project_data'")).rows[0].n, 0);
assert.equal((await invalid.query('SELECT count(*)::int AS n FROM diagrams')).rows[0].n, 1);
ok('unsafe existing ownership causes full rollback without deleting data');
await invalid.close();
console.log(`${passed} migration checks passed.`);
