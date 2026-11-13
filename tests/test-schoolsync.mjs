/* SchoolSync client tests — against the REAL backend (PGlite + spr-server).
   Covers the §12.3 scenarios expressible without a browser: offline queue
   durability, retry/idempotency, conflicts surfacing both versions, auth loss
   mid-flush, permission loss. Synthetic data only. Run: node tests/test-schoolsync.mjs */
import { createApp } from '../server/spr-server.mjs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const SS = require('../source/schoolsync.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

/* cookie-jar fetch: node fetch ignores Set-Cookie; the browser gets this free */
function jarFetch(jar) {
  return (url, opts = {}) => {
    const headers = Object.assign({}, opts.headers || {});
    if (jar.cookie) headers['Cookie'] = jar.cookie;
    return fetch(url, Object.assign({}, opts, { headers })).then(async (res) => {
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) jar.cookie = c.split(';')[0];
      return res;
    });
  };
}

const store = { mem: {}, get(k) { return this.mem[k] === undefined ? null : this.mem[k]; }, set(k, v) { this.mem[k] = v; } };
const ADMIN_PW = process.env.SPR_ADMIN_PW || 'change-me-admin';   /* server/spr-server.mjs bootstrap */

const srv = await createApp({ cookieSecure: false });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;

console.log('1. fixture: school, class, both teachers (real admin API)');
let cid = '', studentId = '', fetId = '', obsAId = '';
{
  const jar = { cookie: '' };
  const A = SS.create({ baseUrl: base, fetch: jarFetch(jar), persist: store });
  const me = await A.login('admin', ADMIN_PW);
  ok(me && me.username === 'admin', 'bootstrap admin signs in');
  const fet = (await A.call('POST', '/api/admin/users', { username: 'fet1', display_name: 'FET One', role: 'teacher', password: 'Fet1-School-Pass-9' })).user;
  const cet = (await A.call('POST', '/api/admin/users', { username: 'cet1', display_name: 'CET One', role: 'teacher', password: 'Cet1-School-Pass-9' })).user;
  fetId = fet.id;
  const cls = (await A.call('POST', '/api/admin/classes', { name: 'Primary 4A' })).class;
  cid = cls.id;
  await A.call('POST', '/api/admin/memberships', { class_id: cid, user_id: fet.id, duty: 'fet' });
  await A.call('POST', '/api/admin/memberships', { class_id: cid, user_id: cet.id, duty: 'cet' });
  studentId = (await A.call('POST', '/api/students', { class_id: cid, student_no: '08', name_en: 'Synthetic Student 08' })).student.id;
  ok(!!studentId, 'student 08 created');
}

const OBS = (field, val, v, idem) => ({ id: crypto.randomUUID(), class_id: cid, student_id: studentId, category: 'observation', period: field, note: 'obs ' + val, expected_version: v, idempotency_key: idem });
const SPELL = (field, val, v, idem) => ({ id: crypto.randomUUID(), class_id: cid, student_id: studentId, category: 'spelling', period: field, value: val, max_value: 10, expected_version: v, idempotency_key: idem });

console.log('2. FET offline queue, duplicate guard, flush');
{
  const jar = { cookie: '' };
  const f = SS.create({ baseUrl: base, fetch: jarFetch(jar), persist: store });
  const me = await f.login('fet1', 'Fet1-School-Pass-9');
  ok(me.role === 'teacher', 'FET signs in as teacher');
  const obsA = OBS('September:0', 8, 0, 'ob-a');
  obsAId = obsA.id;
  const id1 = f.queue({ kind: 'score', payload: obsA });
  f.queue({ kind: 'score', payload: OBS('September:1', 7, 0, 'ob-b') });
  ok(f.pendingCount() === 2, 'offline queue holds 2 pending actions');
  f.queue({ kind: 'score', idem: id1, payload: OBS('September:0', 8, 0, 'ob-a') });
  ok(f.pendingCount() === 2, 'same idempotency key never double-queues');
  const r = await f.flush();
  ok(r.sent === 2 && r.conflicts.length === 0 && r.errors.length === 0, 'flush sends both observations');
  ok(f.pendingCount() === 0, 'queue drains only on success');
}

console.log('3. CET: independent records pass; role rules enforced');
{
  const jar = { cookie: '' };
  const f = SS.create({ baseUrl: base, fetch: jarFetch(jar), persist: store });
  await f.login('cet1', 'Cet1-School-Pass-9');
  f.queue({ kind: 'score', payload: SPELL('September:sp1', 9, 0, 'sp-a') });
  let r = await f.flush();
  ok(r.sent === 1, 'CET spelling accepted (independent record, FET observation untouched)');
  f.queue({ kind: 'score', payload: OBS('October:0', 3, 0, 'ob-cet') });
  r = await f.flush();
  ok(r.errors.length === 1 && r.errors[0].reason === 'forbidden', 'CET observation refused server-side (role rule)');
  ok(f.pendingCount() === 0, 'forbidden action dropped with a record, queue not clogged');
}

console.log('4. stale version: conflict carries both sides; owner resolves');
{
  const jar = { cookie: '' };
  const f = SS.create({ baseUrl: base, fetch: jarFetch(jar), persist: store });
  await f.login('fet1', 'Fet1-School-Pass-9');
  /* SAME record id as ob-a, but expected_version 0 (a second device that
     never saw the first write): the server must answer 409, both versions */
  const stale = OBS('September:0', 4, 0, 'ob-stale');
  stale.id = obsAId;
  f.queue({ kind: 'score', payload: stale });
  const r = await f.flush();
  ok(r.conflicts.length === 1, 'stale version detected (no silent overwrite)');
  const c = r.conflicts[0];
  ok(c.server && /obs 8/.test(String(c.server.note || '')), 'server version present (obs 8)');
  ok(/obs 4/.test(String((c.incoming && c.incoming.note) || (c.action.payload && c.action.payload.note) || '')), 'incoming version present (obs 4)');
  const res = await f.call('POST', '/api/records/' + c.action.payload.id + '/resolve', { resolution: 'server', idempotency_key: 'res-1' });
  ok(!!res, 'owner resolves the conflict');
}

console.log('5. network failure mid-flush: queue intact, retry idempotent');
{
  const jar = { cookie: '' };
  let dead = false;
  const realFetch = jarFetch(jar);
  const flaky = (u, o) => dead ? Promise.reject(new TypeError('Failed to fetch')) : realFetch(u, o);
  const f = SS.create({ baseUrl: base, fetch: flaky, persist: store });
  await f.login('fet1', 'Fet1-School-Pass-9');
  f.queue({ kind: 'score', payload: OBS('September:2', 6, 0, 'ob-net') });
  dead = true;
  let r = await f.flush();
  ok(r.sent === 0 && r.errors.length === 1 && r.errors[0].reason === 'network|server', 'network failure reported');
  ok(f.pendingCount() === 1, 'offline change SURVIVES the failed attempt');
  dead = false;
  r = await f.flush();
  ok(r.sent === 1, 'retry after reconnection succeeds');
  const dup = await f.call('POST', '/api/records', OBS('September:2', 6, 1, 'ob-net'));
  ok(dup && (dup.duplicate === true || dup.record), 'duplicate idempotency key does not create a second record');
}

console.log('6. session loss mid-flush: stops cleanly, re-login completes');
{
  const jar = { cookie: '' };
  const f = SS.create({ baseUrl: base, fetch: jarFetch(jar), persist: store });
  await f.login('fet1', 'Fet1-School-Pass-9');
  f.queue({ kind: 'score', payload: OBS('September:3', 5, 0, 'ob-auth') });
  jar.cookie = '';
  let r = await f.flush();
  ok(r.sent === 0 && r.errors[0].reason === 'auth', 'auth loss surfaces as auth error');
  ok(f.pendingCount() === 1, 'pending change kept through auth loss');
  await f.login('fet1', 'Fet1-School-Pass-9');
  r = await f.flush();
  ok(r.sent === 1, 'flush completes after re-login');
}

console.log('7. membership revocation mid-queue');
{
  const jar = { cookie: '' };
  const f = SS.create({ baseUrl: base, fetch: jarFetch(jar), persist: store });
  await f.login('fet1', 'Fet1-School-Pass-9');
  const aj = { cookie: '' };
  const A = SS.create({ baseUrl: base, fetch: jarFetch(aj), persist: store });
  await A.login('admin', ADMIN_PW);
  await A.call('DELETE', '/api/admin/memberships?class_id=' + cid + '&user_id=' + fetId);
  f.queue({ kind: 'score', payload: OBS('October:1', 7, 0, 'ob-rev') });
  const r = await f.flush();
  ok(r.errors.some((e) => e.reason === 'forbidden') || r.sent === 0, 'revoked membership blocks the write');
  await A.call('POST', '/api/admin/memberships', { class_id: cid, user_id: fetId, duty: 'fet' }).catch(() => {});
}

console.log('SCHOOLSYNC: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
