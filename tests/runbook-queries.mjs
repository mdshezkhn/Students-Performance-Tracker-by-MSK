// round 7: prove the OWNER-RUNBOOK "before" queries against the PGlite fixture.
// The output pasted into the runbook came from THIS run, not invented.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

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
  create policy "anon can update channels" on public.spr_channels for update to anon using (true) with check (true);
`);
const U = '11111111-2222-3333-4444-555555555555';
await db.query(`insert into public.spr_channels(id, share_name, pushed_by, payload) values ($1,'devicesync','Mo','{"sprDS":1}'), ($2,'ds-ptr','anna','{"sprPTR":1}'), ($3,'P1A','Mo','{"spr":1}')`, [U, crypto.randomUUID(), crypto.randomUUID()]);

console.log('== Query B1: what is in the table right now (run BEFORE anything) ==');
const b1 = await db.query(`
  select case
           when share_name = 'ds-ptr' then 'pointer row (device-sync bootstrap)'
           when payload ? 'sprDS' then 'account channel (device sync)'
           when payload ? 'spr' then 'share channel (Save & Share)'
           else 'other'
         end as kind,
         count(*) as rows
  from public.spr_channels group by 1 order by 2 desc`);
for (const r of b1.rows) console.log(`  ${r.kind}: ${r.rows}`);

console.log('== Query B2: current policies on the table ==');
const b2 = await db.query(`select policyname, cmd from pg_policies where schemaname='public' and tablename='spr_channels' order by policyname`);
for (const r of b2.rows) console.log(`  ${r.policyname} (${r.cmd})`);

console.log('== Query 2 (backup): make a dated backup copy ==');
await db.exec(`create table public.spr_channels_backup_2026_10_30 as select * from public.spr_channels`);
const bk = await db.query(`select count(*) as n from public.spr_channels_backup_2026_10_30`);
console.log(`  backup rows: ${bk.rows[0].n}`);

console.log('== Query 3: pointer rows exist? ==');
const p = await db.query(`select count(*) as n from public.spr_channels where share_name='ds-ptr'`);
console.log(`  pointer rows: ${p.rows[0].n}`);
