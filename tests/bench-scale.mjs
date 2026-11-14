/* Round 23: performance + reliability benchmark (synthetic data ONLY).
   Not a pass/fail suite — it prints measured numbers for the report.
   Scenarios: 1 class / 5 classes / 20 classes; 25 students each; 4 record
   writes per student (2 FET observations + 2 CET scores); concurrent mixed
   writes; full pull; restart durability.
   Run: node tests/bench-scale.mjs */
import { createApp } from '../server/spr-server.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openStore } from '../server/store.mjs';

const ROT = 'Spr-Admin-Rotated-9x7';
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
      let d = null; const t = await res.text(); if (t) { try { d = JSON.parse(t); } catch (e) { d = null; } }
      if (d && d.csrf && !j.csrf) j.csrf = d.csrf;
      return { status: res.status, data: d };
    }
  };
};
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

const srv = await createApp({ cookieSecure: false });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const admin = mkClient(base);
await admin.req('POST', '/api/auth/login', { username: 'admin', password: process.env.SPR_ADMIN_PW || 'change-me-admin' });
await admin.req('POST', '/api/auth/change-password', { current: process.env.SPR_ADMIN_PW || 'change-me-admin', next: ROT });

const sem = (await admin.req('POST', '/api/semesters', { name: '2026-S1' })).data.semester;
const fet = (await admin.req('POST', '/api/admin/users', { username: 'fet', display_name: 'FET', role: 'teacher', password: 'Bench-Fet-Pass-99' })).data.user;
const cet = (await admin.req('POST', '/api/admin/users', { username: 'cet', display_name: 'CET', role: 'teacher', password: 'Bench-Cet-Pass-99' })).data.user;
const fetC = mkClient(base), cetC = mkClient(base);
await fetC.req('POST', '/api/auth/login', { username: 'fet', password: 'Bench-Fet-Pass-99' });
await fetC.req('POST', '/api/auth/change-password', { current: 'Bench-Fet-Pass-99', next: 'Bench-Fet-Pass-99R' });
await cetC.req('POST', '/api/auth/login', { username: 'cet', password: 'Bench-Cet-Pass-99' });
await cetC.req('POST', '/api/auth/change-password', { current: 'Bench-Cet-Pass-99', next: 'Bench-Cet-Pass-99R' });

const STUDENTS = 25;
for (const nClasses of [1, 5, 20]) {
  const clsIds = [];
  for (let c = 0; c < nClasses; c++) {
    const cls = (await admin.req('POST', '/api/admin/classes', { name: 'Bench ' + nClasses + '-' + c })).data.class;
    clsIds.push(cls.id);
    await admin.req('POST', '/api/admin/memberships', { class_id: cls.id, user_id: fet.id, duty: 'fet' });
    await admin.req('POST', '/api/admin/memberships', { class_id: cls.id, user_id: cet.id, duty: 'cet' });
    for (let s = 1; s <= STUDENTS; s++) await admin.req('POST', '/api/students', { class_id: cls.id, student_no: String(s).padStart(2, '0'), name_en: 'Synthetic ' + s });
  }
  /* mixed concurrent writes: 2 observations (FET) + 2 scores (CET) per student */
  const t0 = Date.now();
  const jobs = [];
  for (const cid of clsIds) {
    for (let s = 1; s <= STUDENTS; s++) {
      const sid = (await srv.sprStore.query('select id from students where class_id=$1 and student_no=$2', [cid, String(s).padStart(2, '0')]))[0].id;
      for (let k = 0; k < 2; k++) {
        jobs.push(() => fetC.req('POST', '/api/records', { id: hex(32), class_id: cid, student_id: sid, semester_id: sem.id, category: 'observation', period: 'September', ordinal: k + 1, value: 5 + (s % 5), max_value: 10, note: '', expected_version: 0, idempotency_key: hex(16) }));
        jobs.push(() => cetC.req('POST', '/api/records', { id: hex(32), class_id: cid, student_id: sid, semester_id: sem.id, category: k === 0 ? 'spelling' : 'daily', period: 'September', ordinal: k + 1, value: 6 + (s % 5), max_value: 10, note: '', expected_version: 0, idempotency_key: hex(16) }));
      }
    }
  }
  /* bounded concurrency: teachers do not fire 2000 simultaneous requests;
     8 in flight models a busy staffroom. Unbounded blasts wedge the dev
     store (single PGlite connection) and measure nothing real. */
  const CONC = 8;
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: CONC }, async () => {
    while (idx < jobs.length) { const i = idx++; results.push(await jobs[i]()); }
  });
  await Promise.all(workers);
  const writes = results.length;
  const failures = results.filter((r) => r.status !== 200 && r.status !== 201).length;
  const dt = Date.now() - t0;
  console.log(`classes=${String(nClasses).padStart(2)} students=${nClasses * STUDENTS} writes=${writes} failures=${failures} wall=${dt}ms (${Math.round(writes / (dt / 1000))} writes/s)`);

  const t1 = Date.now();
  const pulls = await Promise.all(clsIds.map((cid) => fetC.req('GET', '/api/classes/' + cid + '/records')));
  const rows = pulls.reduce((a, p) => a + (p.data.records || []).length, 0);
  console.log(`  full pull: ${rows} rows in ${Date.now() - t1}ms (first page per class)`);
}

/* reliability: server restart with a file-backed store, data survives */
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spr-bench-'));
const storeA = await openStore({ persistPath: path.join(dbDir, 'pg') });
const a = await createApp({ cookieSecure: false, store: storeA });
const stA = a.sprStore;
/* seed the file-backed instance so the restart check means something */
{
  const ad = mkClient('http://127.0.0.1:0');
  void ad;
  const ab = await createApp({ cookieSecure: false, store: storeA });
  await new Promise((r) => ab.listen(0, '127.0.0.1', r));
  const bb = 'http://127.0.0.1:' + ab.address().port;
  const ac = mkClient(bb);
  await ac.req('POST', '/api/auth/login', { username: 'admin', password: process.env.SPR_ADMIN_PW || 'change-me-admin' });
  await ac.req('POST', '/api/auth/change-password', { current: process.env.SPR_ADMIN_PW || 'change-me-admin', next: ROT });
  const semB = (await ac.req('POST', '/api/semesters', { name: '2026-S1' })).data.semester;
  const clsB = (await ac.req('POST', '/api/admin/classes', { name: 'Restart' })).data.class;
  const tchR = await ac.req('POST', '/api/admin/users', { username: 'rfx', display_name: 'RF', role: 'teacher', password: 'Bench-Fet-Pass-99' });
  const tch = tchR.data.user;
  await ac.req('POST', '/api/admin/memberships', { class_id: clsB.id, user_id: tch.id, duty: 'fet' });
  const rc = mkClient(bb);
  await rc.req('POST', '/api/auth/login', { username: 'rfx', password: 'Bench-Fet-Pass-99' });
  await rc.req('POST', '/api/auth/change-password', { current: 'Bench-Fet-Pass-99', next: 'Bench-Fet-Pass-99R' });
  const stB1 = (await ac.req('POST', '/api/students', { class_id: clsB.id, student_no: '01', name_en: 'Synthetic R1' })).data.student;
  for (let i = 0; i < 100; i++) await rc.req('POST', '/api/records', { id: hex(32), class_id: clsB.id, student_id: stB1.id, semester_id: semB.id, category: 'observation', period: 'September', ordinal: i + 1, value: 7, max_value: 10, note: '', expected_version: 0, idempotency_key: hex(16) });
  await new Promise((r) => ab.close(r));
}
const before = (await stA.query('select count(*)::int as n from records'))[0].n;
await new Promise((r) => a.close(r)); await storeA.close();
const t2 = Date.now();
const storeB = await openStore({ persistPath: path.join(dbDir, 'pg') });
const b = await createApp({ cookieSecure: false, store: storeB });
const after = (await b.sprStore.query('select count(*)::int as n from records'))[0].n;
console.log(`restart durability: ${before} records -> ${after} after restart; boot=${Date.now() - t2}ms`);
await new Promise((r) => b.close(r)); await storeB.close();
fs.rmSync(dbDir, { recursive: true, force: true });
console.log('BENCH DONE');
process.exit(0);
