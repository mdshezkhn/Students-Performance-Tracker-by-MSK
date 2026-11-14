/* Round 12: versioned migrations + archive semantics. Synthetic data only.
   Run: node tests/test-server-migrations.mjs */
import { createApp, MIGRATIONS } from '../server/spr-server.mjs';
import { openStore } from '../server/store.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const jar = () => {
  const j = { cookie: '', csrf: '' };
  return {
    async req(method, path, body, hdrs = {}) {
      const h = { 'Content-Type': 'application/json', ...(j.csrf ? { 'X-CSRF-Token': j.csrf } : {}), ...(j.cookie ? { Cookie: j.cookie } : {}), ...hdrs };
      const res = await fetch(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) if (c.startsWith('spr_session=')) j.cookie = c.split(';')[0];
      let data = null; const t = await res.text(); if (t) { try { data = JSON.parse(t); } catch (e) { data = { raw: t }; } }
      if (data && data.csrf && !j.csrf) j.csrf = data.csrf;
      return { status: res.status, data };
    }
  };
};

console.log('1. clean database: boot applies and records every migration');
{
  const srv = await createApp({ cookieSecure: false });
  const st = srv.sprStore;
  const rows = await st.query('select version, name, checksum from schema_migrations order by version');
  ok(rows.length >= 2, 'schema_migrations has ' + rows.length + ' rows');
  ok(rows.every((r) => MIGRATIONS.find((m) => m.version === r.version && m.checksum === r.checksum)), 'every applied row matches the registered checksum');
  const col = await st.query("select 1 from information_schema.columns where table_name='students' and column_name='archived_at'");
  ok(col.length === 1, '002 executed: students.archived_at exists');
  await new Promise((r) => srv.close(r));
}

console.log('2. pre-existing populated DB: 001 recorded without re-running, data survives, 002 applied');
{
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spr-mig-'));
  const dbPath = path.join(dbDir, 'pgdata');
  const storeA = await openStore({ persistPath: dbPath });
  const srvA = await createApp({ cookieSecure: false, store: storeA });   /* bootstraps + admin + migrations */
  const st = srvA.sprStore;
  /* make it look PRE-migration: wipe the ledger only, keep all tables/data */
  await st.query('delete from schema_migrations');
  await st.query("insert into classes (id, school_id, name) values ('c1aaaabbbbccccdddddddddddddd', (select school_id from users where username='admin'), 'Keep Me')");
  const before = (await st.query('select count(*)::int as n from classes'))[0].n;
  await new Promise((r) => srvA.close(r));
  await storeA.close();

  const storeB = await openStore({ persistPath: dbPath });
  const srvB = await createApp({ cookieSecure: false, store: storeB });   /* re-boot: existing tables, empty ledger */
  const stB = srvB.sprStore;
  const mrows = await stB.query('select version from schema_migrations order by version');
  ok(mrows.length >= 2, 'ledger rebuilt with ' + mrows.length + ' rows');
  const after = (await stB.query('select count(*)::int as n from classes'))[0].n;
  ok(after === before, 'pre-existing classes intact (' + before + ' -> ' + after + ')');
  const users = (await stB.query("select count(*)::int as n from users where username='admin'"))[0].n;
  ok(users === 1, 'admin not duplicated by re-bootstrap (exactly 1)');
  await new Promise((r) => srvB.close(r));
  await storeB.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
}

console.log('3. repeat boot on a migrated DB: nothing re-applies');
{
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spr-mig-'));
  const dbPath = path.join(dbDir, 'pgdata');
  const sA = await openStore({ persistPath: dbPath });
  const a = await createApp({ cookieSecure: false, store: sA }); await new Promise((r) => a.close(r)); await sA.close();
  const sB = await openStore({ persistPath: dbPath });
  const b = await createApp({ cookieSecure: false, store: sB });
  const st = b.sprStore;
  const rows = await st.query('select version, applied_at from schema_migrations');
  ok(rows.length === MIGRATIONS.length, 'ledger stable at ' + rows.length + ' (no duplicates)');
  const admin = (await st.query("select count(*)::int as n from users where username='admin'"))[0].n;
  ok(admin === 1, 'still exactly one admin');
  await new Promise((r2) => b.close(r2)); await sB.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
}

console.log('4. archive semantics: reversible, records preserved, audited');
{
  const srv = await createApp({ cookieSecure: false });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const A = jar(); let MIG_ADMIN_PW = process.env.SPR_ADMIN_PW || 'change-me-admin';
  await A.req('POST', base + '/api/auth/login', { username: 'admin', password: MIG_ADMIN_PW });
  { const me = await A.req('GET', base + '/api/me');
    if (me.data && me.data.user && me.data.user.must_change_pw) {
      await A.req('POST', base + '/api/auth/change-password', { current: MIG_ADMIN_PW, next: 'Spr-Admin-Rotated-9x7' });
      MIG_ADMIN_PW = 'Spr-Admin-Rotated-9x7';
    } }
  const cls = (await A.req('POST', base + '/api/admin/classes', { name: 'P4A-mig' })).data.class;
  const stu = (await A.req('POST', base + '/api/students', { class_id: cls.id, student_no: '07', name_en: 'Synthetic Seven' })).data.student;
  const sem = (await A.req('POST', base + '/api/semesters', { class_id: cls.id, name: '2026-S1' })).data.semester;
  /* a CET (duty-holder) writes the record; admin only manages lifecycle */
  const cet = (await A.req('POST', base + '/api/admin/users', { username: 'mig-cet', display_name: 'CET', role: 'teacher', password: 'Mig-Cet-Pass-99' })).data.user;
  await A.req('POST', base + '/api/admin/memberships', { class_id: cls.id, user_id: cet.id, duty: 'cet' });
  const W = jar(); await W.req('POST', base + '/api/auth/login', { username: 'mig-cet', password: 'Mig-Cet-Pass-99' });
  await W.req('POST', base + '/api/auth/change-password', { current: 'Mig-Cet-Pass-99', next: 'Mig-Cet-Pass-99R' });
  const rec = (await W.req('POST', base + '/api/records', { id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', class_id: cls.id, student_id: stu.id, semester_id: sem.id, category: 'spelling', period: 'September', ordinal: 1, value: 8, max_value: 10, expected_version: 0, idempotency_key: 'mig-1' })).data.record;

  const roster = () => A.req('GET', base + '/api/classes/' + cls.id + '/students');
  const rosterAll = () => A.req('GET', base + '/api/classes/' + cls.id + '/students?include=archived');

  ok((await roster()).data.students.some((s) => s.id === stu.id), 'student on the default roster before archiving');

  const arch = await A.req('POST', base + '/api/admin/students/' + stu.id + '/archive');
  ok(arch.status === 200, 'archive accepted');
  ok(!(await roster()).data.students.some((s) => s.id === stu.id), 'archived student leaves the default roster');
  const all = (await rosterAll()).data.students;
  ok(all.some((s) => s.id === stu.id && s.archived_at), 'include=archived still lists them with archived_at');
  const recs = (await A.req('GET', base + '/api/classes/' + cls.id + '/records')).data.records;
  ok(recs.some((r) => r.id === rec.id), 'their records are NOT deleted by archiving');
  const again = await A.req('POST', base + '/api/admin/students/' + stu.id + '/archive');
  ok(again.status === 409, 'double archive rejected 409');

  const res2 = await A.req('POST', base + '/api/admin/students/' + stu.id + '/restore');
  ok(res2.status === 200 && (await roster()).data.students.some((s) => s.id === stu.id), 'restore returns them to the roster');

  const audit = (await A.req('GET', base + '/api/audit?q=student.archive')).data;
  ok(audit && audit.events && audit.events.length >= 1, 'student.archive is in the audit trail');
  const none = await A.req('POST', base + '/api/admin/students/' + 'f'.repeat(32) + '/archive');
  ok(none.status === 404, 'archiving an unknown id -> 404 (no enumeration)');

  /* teacher cannot archive */
  const T2 = jar();
  const fet = (await A.req('POST', base + '/api/admin/users', { username: 'mig-fet', display_name: 'FET', role: 'teacher', password: 'Mig-Fet-Pass-99' })).data.user;
  await A.req('POST', base + '/api/admin/memberships', { class_id: cls.id, user_id: fet.id, duty: 'fet' });
  await T2.req('POST', base + '/api/auth/login', { username: 'mig-fet', password: 'Mig-Fet-Pass-99' });
  await T2.req('POST', base + '/api/auth/change-password', { current: 'Mig-Fet-Pass-99', next: 'Mig-Fet-Pass-99R' });
  const denied = await T2.req('POST', base + '/api/admin/students/' + stu.id + '/archive');
  ok(denied.status === 403, 'teacher cannot archive (403)');
  await new Promise((r) => srv.close(r));
}

console.log('MIGRATIONS: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
