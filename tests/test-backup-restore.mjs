/* Round 24: backup → restore → verify, into an ISOLATED store.
   A backup command is not proof of restorability — this test proves the
   restore. Synthetic data only. Run: node tests/test-backup-restore.mjs */
import { createApp } from '../server/spr-server.mjs';
import { openStore } from '../server/store.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const ROT = 'Spr-Admin-Rotated-9x7';
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const mkClient = (base) => {
  const j = { cookie: '', csrf: '' };
  return {
    async req(method, p, body) {
      const h = { 'Content-Type': 'application/json' };
      if (j.cookie) h.Cookie = j.cookie;
      if (j.csrf && method !== 'GET') h['X-CSRF-Token'] = j.csrf;
      const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) if (c.startsWith('spr_session=')) j.cookie = c.split(';')[0];
      let d = null; const t = await res.text(); if (t) { try { d = JSON.parse(t); } catch (e) {} }
      if (d && d.csrf && !j.csrf) j.csrf = d.csrf;
      return { status: res.status, data: d };
    }
  };
};

console.log('1. build a small world and take a backup');
let backup = null;
{
  const srv = await createApp({ cookieSecure: false });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const A = mkClient(base);
  await A.req('POST', '/api/auth/login', { username: 'admin', password: 'change-me-admin' });
  await A.req('POST', '/api/auth/change-password', { current: 'change-me-admin', next: ROT });
  const sem = (await A.req('POST', '/api/semesters', { name: '2026-S1' })).data.semester;
  const cls = (await A.req('POST', '/api/admin/classes', { name: 'P4A-bak' })).data.class;
  const t = (await A.req('POST', '/api/admin/users', { username: 'bak-cet', display_name: 'CET', role: 'teacher', password: 'Bak-Cet-Pass-99' })).data.user;
  await A.req('POST', '/api/admin/memberships', { class_id: cls.id, user_id: t.id, duty: 'cet' });
  const stu = (await A.req('POST', '/api/students', { class_id: cls.id, student_no: '08', name_en: 'Synthetic 08' })).data.student;
  const C = mkClient(base);
  await C.req('POST', '/api/auth/login', { username: 'bak-cet', password: 'Bak-Cet-Pass-99' });
  await C.req('POST', '/api/auth/change-password', { current: 'Bak-Cet-Pass-99', next: 'Bak-Cet-Pass-99R' });
  for (let i = 1; i <= 3; i++) {
    await C.req('POST', '/api/records', { id: hex(32), class_id: cls.id, student_id: stu.id, semester_id: sem.id, category: 'spelling', period: 'September', ordinal: i, value: 6 + i, max_value: 10, expected_version: 0, idempotency_key: 'bak-' + i });
  }
  const denied = await C.req('GET', '/api/admin/backup');
  ok(denied.status === 403, 'teacher cannot take a backup (403)');
  const r = await A.req('GET', '/api/admin/backup');
  ok(r.status === 200 && r.data && r.data.kind === 'spr-backup', 'admin backup taken');
  backup = r.data;
  ok(backup.tables.users.length === 2 && backup.tables.records.length === 3 && backup.tables.students.length === 1, 'backup carries users/records/students');
  ok(backup.tables.users.some((u) => u.pw_hash && u.pw_salt), 'password hashes present (restorable) — file must be treated as sensitive');
  ok(!('sessions' in backup.tables), 'runtime sessions are not in the backup');
  await new Promise((r2) => srv.close(r2));
}

console.log('2. restore into an ISOLATED store and verify');
{
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spr-restore-'));
  const store = await openStore({ persistPath: path.join(dbDir, 'pg') });
  const srv = await createApp({ cookieSecure: false, store });   /* boot applies schema */
  const st = srv.sprStore;
  /* restore = insert backup rows (server skipped first-run bootstrap because we insert users ourselves) */
  for (const t of ['schools', 'users', 'classes', 'class_memberships', 'students', 'semesters', 'records', 'audit_events']) {
    for (const row of backup.tables[t] || []) {
      const cols = Object.keys(row);
      await st.query('insert into ' + t + ' (' + cols.join(',') + ') values (' + cols.map((_, i) => '$' + (i + 1)).join(',') + ') on conflict do nothing', cols.map((c) => row[c]));
    }
  }
  /* anyUser now exists -> no bootstrap admin; verify by signing in as the restored teacher */
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const T = mkClient(base);
  const li = await T.req('POST', '/api/auth/login', { username: 'bak-cet', password: 'Bak-Cet-Pass-99R' });
  ok(li.status === 200, 'restored teacher authenticates with their password (hashes survived)');
  const recs = (await T.req('GET', '/api/classes/' + backup.tables.classes[0].id + '/records')).data.records;
  ok(recs.length === 3 && recs.every((x) => x.version === 1), 'all 3 assessment records restored with versions');
  const roster = (await T.req('GET', '/api/classes/' + backup.tables.classes[0].id + '/students')).data.students;
  ok(roster.length === 1 && roster[0].name_en === 'Synthetic 08', 'student roster restored');
  const aud = (await st.query('select count(*)::int as n from audit_events'))[0].n;
  ok(aud >= backup.tables.audit_events.length, 'audit history restored (>= ' + backup.tables.audit_events.length + ' events)');
  /* class assignments recoverable */
  const duty = (await st.query('select duty from class_memberships cm join users u on u.id = cm.user_id where u.username = $1', ['bak-cet']))[0];
  ok(duty && duty.duty === 'cet', 'class assignment (CET duty) restored');
  await new Promise((r) => srv.close(r));
  await store.close();
  fs.rmSync(dbDir, { recursive: true, force: true });
}

console.log('BACKUP-RESTORE: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
