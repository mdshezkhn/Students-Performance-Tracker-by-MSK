// Repro (2026-11-12): the device-sync deadlock on a STALE cloud row.
//
// Situation on the live project (probed via the publishable key, read-only):
//   row  f7e8f917-…  pushed_by='test: Mo'  pushed_at=2026-10-31
//   payload.mac was computed with the TEST RIG's sync key; the row has NO
//   password wrap; write_token_hash IS NULL.
// Mo's browser holds a DIFFERENT sync key (re-paired since). Mirror of the
// app's sbSave decision tree (source/app.js) against a real Postgres engine
// (PGlite + pgcrypto, anon role, the owner's write-token SQL applied):
//   1. INSERT  -> unique violation (row exists)  = HTTP 409 -> 'conflict'
//   2. RPC write -> 'channel has no token enrolled yet' (e.notEnrolled)
//   3. sbEnrol(keyProof = LOCAL key) -> SQL recomputes HMAC(row ct, local key)
//      -> != payload.mac -> 'proof rejected'  -> push ABORTS. Nothing the app
//      can write; anon UPDATE/DELETE are revoked by the same SQL.
//   4. pull-check: HMAC(local key, ct) != mac -> 'failed its integrity check'.
// Then the recovery the owner can do in the Supabase SQL editor:
//   5. DELETE the stale row -> the app's next push INSERTs and ARMS the row
//      with its own key/token -> healthy.
// Run: node tests/repro-deadlock-20261112.mjs docs/supabase-write-token.sql
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs'; import crypto from 'crypto';
const SQL = fs.readFileSync(process.argv[2], 'utf8');
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hmacB64u = (keyBytes, ctBytes) => b64u(crypto.createHmac('sha256', Buffer.from(keyBytes)).update(Buffer.from(ctBytes)).digest());
const ok = (label, r) => console.log((r.ok ? '  OK      ' : '  REFUSED ') + label + (r.ok ? '' : '  -> ' + r.err));
const refused = (label, e) => ({ ok: false, err: e.message.slice(0, 100) });
async function asAnon(db, fn) { await db.exec('set role anon'); try { return await fn(); } finally { await db.exec('reset role'); } }

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema extensions; create extension pgcrypto with schema extensions;
  grant usage on schema public, extensions to anon, authenticated;
  create table public.spr_channels (id uuid primary key, share_name text not null default '', pushed_by text not null default '', pushed_at timestamptz, payload jsonb);
  alter table public.spr_channels enable row level security;
  grant select, insert, update, delete on public.spr_channels to anon, authenticated;
  create policy "anon read" on public.spr_channels for select to anon using (true);
  create policy "anon insert" on public.spr_channels for insert to anon with check (true);
`);
await db.exec(SQL);   // the owner's write-token upgrade (as on the live project)

// --- the stale row: sealed by the TEST RIG under keyA, no token, no wrap ---
const keyA = crypto.randomBytes(32).toString('base64');   // rig's key (base64, as the cfg stores it)
const keyB = crypto.randomBytes(32).toString('base64');   // Mo's browser key (different pairing)
const rowId = 'f7e8f917-b48f-491e-90f5-17cacde78de2';
const ct = crypto.randomBytes(96);
const rigEnv = { sprDS: 1, iv: 'x', ct: b64u(ct), mac: hmacB64u(Buffer.from(keyA, 'base64'), ct) };  // no wrap on purpose
await db.query(`insert into public.spr_channels(id,share_name,pushed_by,pushed_at,payload) values ($1,'devicesync','test: Mo',$2,$3)`, [rowId, '2026-10-31T05:33:42.068Z', JSON.stringify(rigEnv)]);

const token = 'tok-' + crypto.randomBytes(12).toString('hex');   // Mo's local writeToken
const tokHash = crypto.createHash('sha256').update(token).digest('hex');
const newEnv = JSON.stringify({ sprDS: 1, iv: 'y', ct: b64u(crypto.randomBytes(64)), mac: 'z' });   /* sealed under Mo's key; mac value irrelevant: every write is refused before it is verified */

console.log('--- the app-side deadlock (Mo\'s browser, key != rig key) ---');
// (1) sbSave insert path: POST -> unique_violation == PostgREST 409
const insertRes = await asAnon(db, async () => {
  try { await db.query(`insert into public.spr_channels(id,share_name,pushed_by,pushed_at,payload,write_token_hash) values ($1,'devicesync','Mo',now(),$2,$3)`, [rowId, newEnv, tokHash]); return { ok: true }; }
  catch (e) { if ((e.code || '') === '23505') return refused('INSERT (row exists == HTTP 409 conflict)', e); return refused('INSERT', e); }
});
ok('INSERT armed (row exists)', insertRes);
// (2) sbWrite: the only write path for an existing row
const writeRes = await asAnon(db, async () => {
  try { await db.query(`select public.spr_channel_write($1::uuid,$2,$3,'Mo',now(),'')`, [rowId, token, newEnv]); return { ok: true }; }
  catch (e) { return refused('spr_channel_write (expects e.notEnrolled)', e); }
});
ok('write before enrol', writeRes); console.log('           -> app maps this to e.notEnrolled: ' + /no token enrolled/i.test(writeRes.err || ''));
// (3) sbEnrol with the LOCAL key as proof
const enrolRes = await asAnon(db, async () => {
  try { await db.query(`select public.spr_channel_enrol($1::uuid,$2,$3)`, [rowId, token, keyB]); return { ok: true }; }
  catch (e) { return refused('spr_channel_enrol (proof = LOCAL key)', e); }
});
ok('enrol with the local key', enrolRes); console.log('           -> push throws e2; DE-adlock: no write path left for the app');
// sanity: the hash is still NULL -> ping stays no-token
const ping = await asAnon(db, () => db.query(`select public.spr_channel_ping($1::uuid,$2) as s`, [rowId, token]));
console.log('  ping after failed enrol: ' + ping.rows[0].s + '  (app toast: "no write token enrolled yet… next change will enrol it" — which never succeeds)');
// (4) pull-check integrity: HMAC(local key, row ct) vs row mac
const row = (await db.query('select payload from public.spr_channels where id=$1', [rowId])).rows[0].payload;
const ctBytes = Buffer.from(row.ct.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const localMac = hmacB64u(Buffer.from(keyB, 'base64'), ctBytes);
console.log('  pull-check: HMAC(local key, ct) ' + (localMac === row.mac ? 'MATCHES' : '!= row.mac  -> dsOpen throws "failed its integrity check (wrong pairing key, or the row was tampered with)"') );
console.log('  account-lookup recovery: row.wrap is ' + (row.wrap ? 'present' : 'ABSENT (test rig pushed no wrap)') + ' -> dsAccountLookup returns nothing -> dead end');

console.log('\n--- the recovery (owner SQL: delete ONLY the stale row) ---');
const del = await asAnon(db, async () => {
  try { await db.query('delete from public.spr_channels where id=$1', [rowId]); return { ok: true }; } catch (e) { return refused('anon DELETE (correctly revoked)', e); }
});
ok('anon DELETE (still revoked — must be the owner in the dashboard)', del);
await db.query('delete from public.spr_channels where id=$1', [rowId]);   // as the dashboard owner would
console.log('  owner deleted the stale row (Supabase SQL editor)');
// (5) the app's next push: INSERT arms the row with ITS OWN key/token
const keyBEnv = (() => { const c = crypto.randomBytes(64); return { sprDS: 1, iv: 'y', ct: b64u(c), mac: hmacB64u(Buffer.from(keyB, 'base64'), c) }; })();
const reinsert = await asAnon(db, async () => {
  try { await db.query(`insert into public.spr_channels(id,share_name,pushed_by,pushed_at,payload,write_token_hash) values ($1,'devicesync','Mo',now(),$2,$3)`, [rowId, JSON.stringify(keyBEnv), tokHash]); return { ok: true }; }
  catch (e) { return refused('INSERT after repair', e); }
});
ok('next push INSERTs and ARMS the row', reinsert);
const ping2 = await asAnon(db, () => db.query(`select public.spr_channel_ping($1::uuid,$2) as s`, [rowId, token]));
const w2 = await asAnon(db, async () => { try { await db.query(`select public.spr_channel_write($1::uuid,$2,$3,'Mo',now(),'')`, [rowId, token, JSON.stringify(keyBEnv)]); return { ok: true }; } catch (e) { return refused('write after repair', e); } });
ok('RPC write with the device token', w2);
console.log('  ping after repair: ' + ping2.rows[0].s + '   <- Test cloud connection now says: connection is good');
console.log('  (and the ownership check passes: HMAC(local key, ct) == mac -> pushes proceed)');
