/* Round11 §4: adversarial permission testing against the real backend.
   Every attack is a DIRECT HTTP request — no frontend involved. Synthetic data.
   Each assertion documents the exact HTTP status the server must return.
   Run: node tests/test-server-adversarial.mjs */
import { createApp } from '../server/spr-server.mjs';
import rot from './helpers/rotate.js';

let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log('  ok: ' + label); } else { fail++; console.log('  FAIL: ' + label); } };

function client(base) {
  const j = { cookie: '', csrf: '' };
  return {
    j,
    async req(method, path, body, hdrs) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, hdrs || {});
      if (j.cookie) headers['Cookie'] = j.cookie;
      if (j.csrf && method !== 'GET' && !(hdrs && 'X-CSRF-Token' in hdrs)) headers['X-CSRF-Token'] = j.csrf;
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) if (c.startsWith('spr_session=')) j.cookie = c.split(';')[0];
      let data = null; const txt = await res.text(); if (txt) { try { data = JSON.parse(txt); } catch (e) { data = { raw: txt }; } }
      if (data && data.csrf) j.csrf = data.csrf;   /* the client plays by the rules; attacks below send WRONG tokens explicitly */
      return { status: res.status, data };
    }
  };
}

let ADMIN_PW = process.env.SPR_ADMIN_PW || 'change-me-admin';
if (!process.env.SPR_SESSION_HOURS) { console.error('run with SPR_SESSION_HOURS=0.0042 (section 5 proves session-expiry enforcement; without it the test lies)'); process.exit(2); }
/* NOTE: short sessions for section 5 come from the CLI env (SPR_SESSION_HOURS=0.0042) — ES imports are hoisted, an in-file assignment runs too late */
const srv = await createApp({ cookieSecure: false });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const admin = client(base), fet = client(base), cet = client(base), stranger = client(base), raw = client(base);

console.log('fixture');
await admin.req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW });
/* round13: forced rotation when the default password bootstrapped the admin */
{
  const me = await admin.req('GET', '/api/me');
  if (me.data && me.data.user && me.data.user.must_change_pw) {
    await admin.req('POST', '/api/auth/change-password', { current: ADMIN_PW, next: 'Spr-Admin-Rotated-9x7' });
    ADMIN_PW = 'Spr-Admin-Rotated-9x7';
  }
}
const fetU = (await admin.req('POST', '/api/admin/users', { username: 'fet1', display_name: 'FET', role: 'teacher', password: 'Fet1-Pass-9x' })).data.user;
const cetU = (await admin.req('POST', '/api/admin/users', { username: 'cet1', display_name: 'CET', role: 'teacher', password: 'Cet1-Pass-9x' })).data.user;
const cls = (await admin.req('POST', '/api/admin/classes', { name: 'Primary 4A' })).data.class;
const otherCls = (await admin.req('POST', '/api/admin/classes', { name: 'Primary 5B (unassigned)' })).data.class;
await admin.req('POST', '/api/admin/memberships', { class_id: cls.id, user_id: fetU.id, duty: 'fet' });
await admin.req('POST', '/api/admin/memberships', { class_id: cls.id, user_id: cetU.id, duty: 'cet' });
const stu = (await admin.req('POST', '/api/students', { class_id: cls.id, student_no: '08', name_en: 'Synthetic 08' })).data.student;
const stuOther = (await admin.req('POST', '/api/students', { class_id: otherCls.id, student_no: '01', name_en: 'Synthetic Other' })).data.student;
const sem = (await admin.req('POST', '/api/semesters', { name: 'S1' })).data.semester;
await rot.login(fet, '/api/auth/login', 'fet1', 'Fet1-Pass-9x');
await rot.login(cet, '/api/auth/login', 'cet1', 'Cet1-Pass-9x');
const obsRec = { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', class_id: cls.id, student_id: stu.id, semester_id: sem.id, category: 'observation', period: 'September', ordinal: 1, value: 8, max_value: 10, note: 'Listening-LO1', expected_version: 0, idempotency_key: 'adv-obs-1' };
const r0 = await fet.req('POST', '/api/records', obsRec);
ok(r0.status === 201, 'baseline: FET writes the observation (201)');

console.log('1. unassigned class by ID manipulation');
{
  const r = await cet.req('GET', '/api/classes/' + otherCls.id + '/records');
  ok(r.status === 403 && r.data.error === 'not your class', 'GET unassigned class records -> 403 not your class (got ' + r.status + ' ' + r.data.error + ')');
  const w = await cet.req('POST', '/api/records', { ...obsRec, id: 'b1b2c3d4e5f60718293a4b5c6d7e8f90', class_id: otherCls.id });
  ok(w.status === 403 && /not assigned/.test(w.data.error || ''), 'write to same-school unassigned class -> 403 not assigned (membership enforced server-side) (got ' + w.status + ' ' + w.data.error + ')');
  const st = await cet.req('GET', '/api/classes/' + otherCls.id + '/students');
  ok(st.status === 403, 'foreign class roster -> 403 (got ' + st.status + ')');
}

console.log('2. another school (row-level isolation)');
{
  const store = srv.sprStore;
  await store.query('insert into schools (id, name) values ($1, $2)', ['sch-other', 'Other School']);
  await store.query('insert into classes (id, school_id, name) values ($1, $2, $3)', ['cls-other-1', 'sch-other', 'Other 1A']);
  await store.query('insert into students (id, school_id, class_id, student_no, name_en) values ($1, $2, $3, $4, $5)', ['stu-other-1', 'sch-other', 'cls-other-1', '01', 'Other Kid']);
  const r1 = await cet.req('GET', '/api/classes/' + 'cls-other-1' + '/records');
  ok(r1.status === 404 || r1.status === 403, 'other school\'s class by id -> 404/403, never data (got ' + r1.status + ')');
  const r2 = await cet.req('POST', '/api/records', { id: 'c1b2c3d4e5f60718293a4b5c6d7e8f90', class_id: 'cls-other-1', student_id: 'stu-other-1', category: 'spelling', period: 'X', value: 1, expected_version: 0 });
  ok(r2.status === 404 && r2.data.error === 'no such class', 'write into other school\'s class -> 404 (got ' + r2.status + ')');
  const r3 = await cet.req('GET', '/api/students?class_id=cls-other-1');
  ok(r3.status !== 200 || !JSON.stringify(r3.data).includes('Other Kid'), 'no other-school student data leaks via query param');
}

console.log('3. cross-role edits');
{
  const w = await cet.req('POST', '/api/records', { ...obsRec, id: 'd1b2c3d4e5f60718293a4b5c6d7e8f90', category: 'observation', expected_version: 0, idempotency_key: 'adv-x1' });
  ok(w.status === 403 && /cannot write/.test(w.data.error), 'CET writing an observation -> 403 role cannot write category (got ' + w.status + ' ' + w.data.error + ')');
  const f = await fet.req('POST', '/api/records', { ...obsRec, id: 'e1b2c3d4e5f60718293a4b5c6d7e8f90', category: 'spelling', value: 5, max_value: 10, expected_version: 0, idempotency_key: 'adv-x2' });
  ok(f.status === 403, 'FET writing spelling -> 403 (got ' + f.status + ')');
}

console.log('4. forged identity in the body (user id / school id / role)');
{
  const w = await cet.req('POST', '/api/records', { ...obsRec, id: 'f1b2c3d4e5f60718293a4b5c6d7e8f90', category: 'observation', school_id: 'sch-other', user_id: fetU.id, expected_version: 0, idempotency_key: 'adv-x3' });
  ok(w.status === 403, 'body user_id/school_id forgery ignored: authorisation still from the SESSION -> 403 (got ' + w.status + ')');
  const g = await cet.req('GET', '/api/me');
  ok(g.status === 200 && g.data.user.username === 'cet1' && g.data.user.role === 'teacher', '/api/me reflects the session, not the body');
}

console.log('5. session expiry + reuse');
{
  const temp = client(base);
  await rot.login(temp, '/api/auth/login', 'cet1', 'Cet1-Pass-9x');
  const alive = await temp.req('GET', '/api/me');
  ok(alive.status === 200, 'fresh session works');
  await new Promise((r) => setTimeout(r, 16500));   /* sessionHours 0.0042 ~= 15 s */
  const dead = await temp.req('GET', '/api/me');
  ok(dead.status === 401, 'expired session -> 401 (got ' + dead.status + ')');
  const deadWrite = await temp.req('POST', '/api/records', { ...obsRec, id: '11b2c3d4e5f60718293a4b5c6d7e8f90', category: 'spelling', expected_version: 0 });
  ok(deadWrite.status === 401, 'write with expired session -> 401, nothing stored (got ' + deadWrite.status + ')');
}

/* with SPR_SESSION_HOURS=0.0042 every session is dead after section 5's sleep: re-login the clients used below */
await rot.login(cet, '/api/auth/login', 'cet1', 'Cet1-Pass-9x');
await rot.login(fet, '/api/auth/login', 'fet1', 'Fet1-Pass-9x');
await admin.req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW });

console.log('6. deactivated account');
{
  await admin.req('POST', '/api/admin/users/' + fetU.id + '/deactivate');
  const w = await fet.req('GET', '/api/me');
  ok(w.status === 401, 'live session of a deactivated account -> 401 immediately (got ' + w.status + ')');
  const l = await rot.login(fet, '/api/auth/login', 'fet1', 'Fet1-Pass-9x');
  ok(l.status === 401, 'deactivated account cannot log in -> 401 (got ' + l.status + ')');
  await admin.req('POST', '/api/admin/users/' + fetU.id + '/activate');
}

console.log('7. replay of a successful write');
{
  const first = await cet.req('POST', '/api/records', { id: 'aabbccddee1f0718293a4b5c6d7e8f90', class_id: cls.id, student_id: stu.id, semester_id: sem.id, category: 'spelling', period: 'October', ordinal: 3, value: 9, max_value: 10, expected_version: 0, idempotency_key: 'adv-replay-1' });
  ok(first.status === 201, 'first write 201');
  const replay = await cet.req('POST', '/api/records', { id: 'aabbccddee1f0718293a4b5c6d7e8f90', class_id: cls.id, student_id: stu.id, semester_id: sem.id, category: 'spelling', period: 'October', ordinal: 3, value: 9, max_value: 10, expected_version: 0, idempotency_key: 'adv-replay-1' });
  ok((replay.status === 200 || replay.status === 201) && replay.data.replayed === true, 'identical replay -> same 201 + replayed:true, no duplicate row (got ' + replay.status + ' ' + JSON.stringify(replay.data).slice(0,80) + ')');
  const rows = await srv.sprStore.query("select count(*)::int as n from records where id = 'aabbccddee1f0718293a4b5c6d7e8f90'");
  ok(rows[0].n === 1, 'exactly one row in the database');
}

console.log('8. conflict resolution across roles');
{
  /* manufacture a conflict on the FET observation: CET (cannot write obs) tries to resolve it */
  const stale = await cet.req('POST', '/api/records/' + obsRec.id + '/resolve', { resolution: 'server', idempotency_key: 'adv-res-1' });
  ok(stale.status === 403, 'CET resolving an OBSERVATION conflict -> 403 (category ownership enforced) (got ' + stale.status + ')');
  const stranger2 = await stranger.req('POST', '/api/records/' + obsRec.id + '/resolve', { resolution: 'server' });
  ok(stranger2.status === 401, 'anonymous resolve -> 401 (got ' + stranger2.status + ')');
}

console.log('9. unauthorised export');
{
  await rot.login(cet, '/api/auth/login', 'cet1', 'Cet1-Pass-9x');
  await rot.login(fet, '/api/auth/login', 'fet1', 'Fet1-Pass-9x');
  const e1 = await stranger.req('GET', '/api/export/class/' + cls.id);
  ok(e1.status === 401, 'anonymous export -> 401 (got ' + e1.status + ')');
  const e2 = await cet.req('GET', '/api/export/class/' + otherCls.id);
  ok(e2.status === 403 || e2.status === 404, 'export of unassigned class -> 403/404 (got ' + e2.status + ')');
  const e3 = await fet.req('GET', '/api/export/class/' + cls.id);
  ok(e3.status === 200 && Array.isArray(e3.data.records), 'assigned teacher export -> 200 (legitimate) (got ' + e3.status + ' ' + JSON.stringify(e3.data).slice(0,60) + ')');
}

console.log('10. CSRF + cookie flags + error disclosure');
{
  const noTok = await rot.login(raw, '/api/auth/login', 'cet1', 'Cet1-Pass-9x');
  const bad = await raw.req('POST', '/api/records', { ...obsRec, id: 'ab1b2c3d4e5f60718293a4b5c6d7e8f90', category: 'spelling' }, { 'X-CSRF-Token': 'wrong' });
  ok(bad.status === 403, 'write without/with wrong CSRF token -> 403 (got ' + bad.status + ')');
  const probe = await fetch(base + '/api/classes/' + cls.id + '/records');
  const cookieHdr = (probe.headers.get('set-cookie') || '');
  void cookieHdr;
  const loginProbe = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'cet1', password: rot.effective('cet1', 'Cet1-Pass-9x') }) });
  const sc2 = (loginProbe.headers.getSetCookie ? loginProbe.headers.getSetCookie() : []).join(';');
  ok(/HttpOnly/i.test(sc2) && /SameSite=Lax/i.test(sc2), 'session cookie carries HttpOnly + SameSite=Lax (' + sc2.slice(0, 60) + '...)');
  await rot.login(cet, '/api/auth/login', 'cet1', 'Cet1-Pass-9x');
  const err = await cet.req('GET', '/api/classes/' + cls.id + '/records?since=not-a-date');
  ok(err.status === 200 || err.status === 400, 'garbage query param does not 500 (got ' + err.status + ')');
  const nf = await cet.req('GET', '/api/nothing');
  ok(nf.status === 404 && !/stack|at |node:/.test(JSON.stringify(nf.data)), '404 carries no stack trace');
}

console.log('11. audit-log immutability at the API layer');
{
  const del = await admin.req('DELETE', '/api/audit');
  ok(del.status === 404 || del.status === 405, 'no audit deletion endpoint (got ' + del.status + ')');
  const post = await admin.req('POST', '/api/audit', { id: 'fake' });
  ok(post.status === 404 || post.status === 405, 'no audit creation endpoint (got ' + post.status + ')');
  await rot.login(cet, '/api/auth/login', 'cet1', 'Cet1-Pass-9x');
  await admin.req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW });
  const asTeacher = await cet.req('GET', '/api/audit?limit=5');
  ok(asTeacher.status === 403, 'teachers cannot read the audit trail (got ' + asTeacher.status + ')');
  const trySql = await admin.req('GET', "/api/audit?limit=5'; drop table audit_events;--");
  ok(trySql.status === 200 || trySql.status === 400, 'SQL-injection-shaped query param does not break the API (got ' + trySql.status + ')');
  const stillThere = await srv.sprStore.query('select count(*)::int as n from audit_events');
  ok(stillThere[0].n > 0, 'audit_events still populated after injection attempt');

console.log('12. audit-log immutability at the DATABASE layer');
{
  /* round11 §7: app-level append-only is not proof — a DB trigger must make
     mutation physically fail for ANY writer, including the app role itself. */
  await srv.sprStore.query("insert into audit_events (action) values ('immutability-probe')");
  let upd = null, dele = null;
  try { await srv.sprStore.query("update audit_events set action='tampered' where id=(select max(id) from audit_events)"); upd = 'NOT BLOCKED'; }
  catch (e) { upd = /append-only/.test(String(e.message)) ? 'blocked (append-only trigger)' : 'blocked'; }
  try { await srv.sprStore.query('delete from audit_events where id=(select max(id) from audit_events)'); dele = 'NOT BLOCKED'; }
  catch (e) { dele = 'blocked'; }
  ok(upd.startsWith('blocked'), 'direct DB UPDATE of audit_events -> exception (' + upd + ')');
  ok(dele === 'blocked', 'direct DB DELETE of audit_events -> exception');
  const kept = await srv.sprStore.query("select count(*)::int as n from audit_events where action='immutability-probe'");
  ok(kept[0].n === 1, 'probe row survived both attempts');
}
}

console.log('ADVERSARIAL: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
