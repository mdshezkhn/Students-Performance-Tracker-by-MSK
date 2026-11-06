import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs'; import crypto from 'crypto';
const SQL = fs.readFileSync(process.argv[2],'utf8');
const policyName = process.argv[3] || 'anon can update channels';
const b64u=b=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function fresh(updPolicy, allPolicy) {
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
  if (updPolicy) await db.exec(`create policy "${updPolicy}" on public.spr_channels for update to anon using (true) with check (true);`);
  if (allPolicy) await db.exec(`create policy "${allPolicy}" on public.spr_channels for all to anon using (true) with check (true);`);
  return db;
}
const key = crypto.randomBytes(32), ct = crypto.randomBytes(64);
const mac = b64u(crypto.createHmac('sha256', key).update(ct).digest());
const id = crypto.randomUUID(), id2 = crypto.randomUUID();
async function scenario(label, updPolicy, allPolicy) {
  console.log('\n=== '+label);
  const db = await fresh(updPolicy, allPolicy);
  await db.query(`insert into public.spr_channels(id,pushed_by,payload) values ($1,'mo',$2)`, [id, JSON.stringify({sprDS:1,ct:b64u(ct),mac,iv:'x'})]);
  try { await db.exec(SQL); console.log('SQL file ran without error'); } catch(e){ console.log('SQL ERROR:', e.message); return; }
  const q = async (sql, params=[]) => { try { await db.exec('set role anon'); const r = await db.query(sql, params); await db.exec('reset role'); return 'OK rows='+(r.affectedRows ?? r.rows.length)+' '+JSON.stringify(r.rows).slice(0,90);} catch(e){ await db.exec('reset role'); return 'REFUSED: '+e.message.slice(0,90);} };
  console.log('direct UPDATE by anon (attack):', await q(`update public.spr_channels set payload='{"evil":1}'::jsonb where id=$1`, [id]));
  const after = await db.query('select payload from public.spr_channels where id=$1',[id]); console.log('  row payload now:', JSON.stringify(after.rows[0].payload).slice(0,60), JSON.stringify(after.rows[0].payload).includes('evil') ? '  <-- OVERWRITTEN, HOLE STILL OPEN':'  (intact)');
  // restore payload for next tests
  await db.query(`update public.spr_channels set payload=$2 where id=$1`,[id, JSON.stringify({sprDS:1,ct:b64u(ct),mac,iv:'x'})]);
  const tok='tok-'+crypto.randomBytes(8).toString('hex');
  console.log('ping unknown row:', await q(`select public.spr_channel_ping($1::uuid,$2)`, [id2, tok]));
  console.log('write before enrol (null hash):', await q(`select public.spr_channel_write($1::uuid,$2,'{"a":1}'::jsonb,'mo',now(),'')`, [id, tok]));
  console.log('enrol with WRONG key:', await q(`select public.spr_channel_enrol($1::uuid,$2,$3)`, [id, tok, b64u(crypto.randomBytes(32))]));
  console.log('enrol with RIGHT key:', await q(`select public.spr_channel_enrol($1::uuid,$2,$3)`, [id, tok, b64u(key)]));
  console.log('ping after enrol:', await q(`select public.spr_channel_ping($1::uuid,$2)`, [id, tok]));
  console.log('write WRONG token:', await q(`select public.spr_channel_write($1::uuid,'nope','{"a":1}'::jsonb,'mo',now(),'')`, [id]));
  console.log('write RIGHT token:', await q(`select public.spr_channel_write($1::uuid,$2,'{"good":1}'::jsonb,'mo',now(),'')`, [id, tok]));
  const r2 = await db.query('select payload, previous is not null as has_prev from public.spr_channels where id=$1',[id]); console.log('  after right write:', JSON.stringify(r2.rows[0]).slice(0,120));
  console.log('re-enrol attempt by attacker with own token+right key (already armed):', await q(`select public.spr_channel_enrol($1::uuid,'evil',$2)`, [id, b64u(key)]));
  console.log('anon DELETE:', await q(`delete from public.spr_channels where id=$1`, [id]));
}
await scenario('A: old policy named exactly as the file guesses ("'+policyName+'")', policyName, null);
await scenario('B: old policy has a DIFFERENT name ("Enable update for anon users")', 'Enable update for anon users', null);
await scenario('C: old policy is an ALL policy ("public full access")', null, 'public full access');

// ===== round 6: the app's Save & Share request shapes (after the SQL) =====
// Mirrors sbSave exactly: INSERT carries write_token_hash (armed from birth),
// later pushes go through spr_channel_write with the SAME token from BOTH
// teachers, and an old un-armed row is enrolled via the share-key proof
// (mac = base64url(HMAC-SHA256(key, ct)) recomputed server-side).
async function scenarioShare() {
  console.log('\n=== D: Save & Share shapes (two teachers, one token)');
  const db = await fresh(null, null);
  await db.exec(SQL);
  const setAnon = async (sql, params=[]) => { try { await db.exec('set role anon'); const r = await db.query(sql, params); await db.exec('reset role'); return 'OK rows='+(r.affectedRows ?? r.rows.length); } catch(e){ await db.exec('reset role'); return 'REFUSED: '+e.message.slice(0,80);} };
  const skey = crypto.randomBytes(32);
  const seal = (n) => { const ct = crypto.randomBytes(48); return { sprEnc:1, v:2, ct:b64u(ct), mac:b64u(crypto.createHmac('sha256', skey).update(ct).digest()), by:n }; };
  const tok = 'share-' + crypto.randomBytes(8).toString('hex');
  const tokHash = crypto.createHash('sha256').update(tok).digest('hex');
  const sid = crypto.randomUUID();
  // owner: first save ARMS the row (INSERT with the hash — sbSave's insert body)
  console.log('owner INSERT (armed):', await setAnon(
    `insert into public.spr_channels(id,share_name,pushed_by,pushed_at,payload,write_token_hash) values ($1,'','Mo',now(),$2,$3)`,
    [sid, JSON.stringify(seal('Mo')), tokHash]));
  // co-teacher: same token (from the share link), pushes through the RPC
  console.log('co-teacher RPC write:', await setAnon(
    `select public.spr_channel_write($1::uuid,$2,$3,'Anna',now(),'')`, [sid, tok, JSON.stringify(seal('Anna'))]));
  // and back again
  console.log('owner RPC write again:', await setAnon(
    `select public.spr_channel_write($1::uuid,$2,$3,'Mo',now(),'')`, [sid, tok, JSON.stringify(seal('Mo'))]));
  const after = await db.query('select pushed_by, previous->>'+"'"+'by'+"'"+' as prev_by from public.spr_channels where id=$1',[sid]);
  console.log('  row now: pushed_by=' + after.rows[0].pushed_by + ', previous.by=' + after.rows[0].prev_by);
  // old row written BEFORE the SQL (no hash): enrol from the key proof, then write
  const oid = crypto.randomUUID();
  const oldEnv = seal('Mo');
  await db.query(`insert into public.spr_channels(id,share_name,pushed_by,pushed_at,payload) values ($1,'','Mo',now(),$2)`, [oid, JSON.stringify(oldEnv)]);
  console.log('old row RPC write (not enrolled):', await setAnon(
    `select public.spr_channel_write($1::uuid,$2,$3,'Anna',now(),'')`, [oid, tok, JSON.stringify(seal('Anna'))]));
  console.log('old row enrol (share-key proof):', await setAnon(
    `select public.spr_channel_enrol($1::uuid,$2,$3)`, [oid, tok, b64u(skey)]));
  console.log('old row RPC write after enrol:', await setAnon(
    `select public.spr_channel_write($1::uuid,$2,$3,'Anna',now(),'')`, [oid, tok, JSON.stringify(seal('Anna'))]));
  console.log('wrong-token write on armed row:', await setAnon(
    `select public.spr_channel_write($1::uuid,$2,$3::jsonb,'Evil',now(),'')`, [sid, 'evil', JSON.stringify({evil:1})]));
}
await scenarioShare();

// ===== round 7, scenario E: the owner's rollback, proven =====
// Run the SQL, then run the exact rollback statements from
// docs/OWNER-RUNBOOK-supabase.md, then verify the OLD behaviour is back
// (direct anon UPDATE works again) and the data survived.
const ROLLBACK = `
  create policy "anon can update channels"
    on public.spr_channels for update to anon using (true) with check (true);
  grant update, delete on public.spr_channels to anon, authenticated;
`;
async function scenarioE() {
  console.log('\n=== E: run SQL, then the runbook rollback, old behaviour back, data intact');
  const db = await fresh('old update policy', null);
  await db.query(`insert into public.spr_channels(id,pushed_by,payload) values ($1,'mo',$2)`, [id, JSON.stringify({sprDS:1,ct:b64u(ct),mac,iv:'x'})]);
  try { await db.exec(SQL); console.log('SQL ran'); } catch(e){ console.log('SQL ERROR:', e.message); return; }
  const q = async (sql, params=[]) => { try { await db.exec('set role anon'); const r = await db.query(sql, params); await db.exec('reset role'); return 'OK rows='+(r.affectedRows ?? r.rows.length)+' '+JSON.stringify(r.rows).slice(0,80);} catch(e){ await db.exec('reset role'); return 'REFUSED: '+e.message.slice(0,80);} };
  console.log('after SQL, direct UPDATE:', await q(`update public.spr_channels set payload='{"x":1}'::jsonb where id=$1`, [id]));
  try { await db.exec(ROLLBACK); console.log('rollback ran'); } catch(e){ console.log('ROLLBACK ERROR:', e.message); return; }
  console.log('rollback: direct UPDATE again:', await q(`update public.spr_channels set payload='{"legit":true}'::jsonb where id=$1`, [id]));
  const after = await db.query('select payload from public.spr_channels where id=$1',[id]);
  console.log('rollback: payload intact:', JSON.stringify(after.rows[0].payload).includes('legit') ? 'yes' : 'NO');
}
await scenarioE();
