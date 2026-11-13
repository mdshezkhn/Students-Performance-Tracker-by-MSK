// Role-based access + authentication tests for the SPR school backend.
// Synthetic data only. Run: node tests/test-server-rbac.mjs
import { createApp } from '../server/spr-server.mjs';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ok: ' + label); } else { fail++; console.log('  FAIL: ' + label); } }

function clientFactory(base) {
  return () => {
    const c = { cookie: null, csrf: null };
    c.req = async (method, path, body, hdrs) => {
      const headers = { 'Content-Type': 'application/json' };
      if (c.csrf && method !== 'GET') headers['X-CSRF-Token'] = c.csrf;
      Object.assign(headers, hdrs || {});   /* explicit headers win (tests send deliberately wrong tokens) */
      if (c.cookie) headers.Cookie = c.cookie;
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie && setCookie.includes('spr_session=') && setCookie.includes('HttpOnly')) c.cookie = setCookie.split(';')[0];
      let json = null;
      try { json = await res.json(); } catch (e) {}
      if (json && json.csrf) c.csrf = json.csrf;
      return { status: res.status, json, setCookie };
    };
    return c;
  };
}

const srv = await createApp({ cookieSecure: false });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const newClient = clientFactory(base);

const ADMIN_PW = process.env.SPR_ADMIN_PW || 'change-me-admin';
const admin = newClient();

console.log('1. authentication');
{
  const r1 = await admin.req('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  ok(r1.status === 401, 'wrong password rejected (401)');
  const r2 = await admin.req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW });
  ok(r2.status === 200 && r2.json.csrf, 'admin login returns session + CSRF');
  ok((r2.setCookie || '').includes('HttpOnly') && (r2.setCookie || '').includes('SameSite=Lax'), 'session cookie is HttpOnly + SameSite=Lax');
  ok(r2.json.user.must_change_pw === true, 'bootstrap admin flagged must_change_pw');
  const noAuth = newClient();
  const r3 = await noAuth.req('GET', '/api/classes');
  ok(r3.status === 401, 'unauthenticated access denied');
  const noCsrf = newClient();
  await noCsrf.req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW });
  const r4 = await noCsrf.req('POST', '/api/semesters', { name: 'X' }, { 'X-CSRF-Token': 'nope' });
  ok(r4.status === 403, 'wrong CSRF token rejected');
}

console.log('2. school setup (admin)');
let fet1, cet1, fet2, mgr, P4A, P4B, S08;
{
  const mk = async (u, role, pw) => (await admin.req('POST', '/api/admin/users', { username: u, display_name: u, role, password: pw })).json.user;
  const uFet1 = await mk('fet1', 'teacher', 'TeacherFet1Pass!x');
  const uCet1 = await mk('cet1', 'teacher', 'TeacherCet1Pass!x');
  const uFet2 = await mk('fet2', 'teacher', 'TeacherFet2Pass!x');
  const uMgr = await mk('head', 'manager', 'ManagerHead1Pass!x');
  ok(!!uFet1.id && !!uCet1.id && !!uFet2.id && !!uMgr.id, 'accounts created');
  const weak = await admin.req('POST', '/api/admin/users', { username: 'weakpw', role: 'teacher', password: 'short' });
  ok(weak.status === 400, 'weak password rejected by the server');
  P4A = (await admin.req('POST', '/api/admin/classes', { name: 'Primary 4A', grade: 'P4' })).json.class.id;
  P4B = (await admin.req('POST', '/api/admin/classes', { name: 'Primary 4B', grade: 'P4' })).json.class.id;
  ok(!!P4A && !!P4B, 'classes created');
  ok((await admin.req('POST', '/api/admin/classes', { name: 'Primary 4A' })).status === 409, 'duplicate class name rejected');
  const r1 = await admin.req('POST', '/api/admin/memberships', { class_id: P4A, user_id: uFet1.id, duty: 'fet' });
  const r2 = await admin.req('POST', '/api/admin/memberships', { class_id: P4A, user_id: uCet1.id, duty: 'cet' });
  const r3 = await admin.req('POST', '/api/admin/memberships', { class_id: P4B, user_id: uFet2.id, duty: 'fet' });
  ok(r1.status === 200 && r2.status === 200 && r3.status === 200, 'memberships assigned');

  fet1 = newClient(); await fet1.req('POST', '/api/auth/login', { username: 'fet1', password: 'TeacherFet1Pass!x' });
  cet1 = newClient(); await cet1.req('POST', '/api/auth/login', { username: 'cet1', password: 'TeacherCet1Pass!x' });
  fet2 = newClient(); await fet2.req('POST', '/api/auth/login', { username: 'fet2', password: 'TeacherFet2Pass!x' });
  mgr = newClient(); await mgr.req('POST', '/api/auth/login', { username: 'head', password: 'ManagerHead1Pass!x' });
  const st = await fet1.req('POST', '/api/students', { class_id: P4A, student_no: '08', name_cn: '合成学生零八', name_en: 'Synthetic Student 08', gender: 'M' });
  S08 = st.json.student.id;
  ok(st.status === 201 && !!S08, 'FET creates roster student (synthetic)');

  const mine = await fet1.req('GET', '/api/classes');
  ok(mine.json.classes.length === 1 && mine.json.classes[0].duty === 'fet', 'FET sees only assigned class with duty');
  const mgrClasses = await mgr.req('GET', '/api/classes');
  ok(mgrClasses.json.classes.length === 2, 'manager sees the whole school (read role)');
}

console.log('3. FET/CET write permissions (server-enforced)');
{
  const obs = await fet1.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: P4A, student_id: S08, category: 'observation', period: 'Nov 2026', note: 'Active participation in pair work.', expected_version: 0, idempotency_key: 'rbac-obs-1' });
  ok(obs.status === 201 && obs.json.record.version === 1, 'FET creates observation (version 1)');
  const spellingByFet = await fet1.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: P4A, student_id: S08, category: 'spelling', period: 'Nov 2026', value: 9, max_value: 10, expected_version: 0, idempotency_key: 'rbac-sp-1' });
  ok(spellingByFet.status === 403, 'FET CANNOT write spelling (403)');
  const spelling = await cet1.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: P4A, student_id: S08, category: 'spelling', period: 'Nov 2026', value: 9, max_value: 10, expected_version: 0, idempotency_key: 'rbac-sp-2' });
  ok(spelling.status === 201, 'CET creates spelling score');
  const test = await cet1.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: P4A, student_id: S08, category: 'test', period: 'Nov 2026', value: 86, max_value: 100, expected_version: 0, idempotency_key: 'rbac-ts-1' });
  ok(test.status === 201, 'CET creates formal test score');
  const daily = await cet1.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: P4A, student_id: S08, category: 'daily', period: 'Nov 2026', value: 4, max_value: 5, expected_version: 0, idempotency_key: 'rbac-dl-1' });
  ok(daily.status === 201, 'CET creates daily assignment score');
  const obsByCet = await cet1.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: P4A, student_id: S08, category: 'observation', period: 'Nov 2026', note: 'tries to sneak in', expected_version: 0, idempotency_key: 'rbac-obs-2' });
  ok(obsByCet.status === 403, 'CET CANNOT write observation (403)');

  const list = await cet1.req('GET', '/api/classes/' + P4A + '/records');
  const cats = list.json.records.map((r) => r.category).sort();
  ok(cats.join(',') === 'daily,observation,spelling,test', 'CET READS the FET observation alongside own scores (no overwrite)');
  const fetList = await fet1.req('GET', '/api/classes/' + P4A + '/records');
  ok(fetList.json.records.some((r) => r.category === 'spelling' && Number(r.value) === 9), 'FET READS the CET spelling score');
}

console.log('4. class + school isolation');
{
  const crossWrite = await fet2.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: P4A, student_id: S08, category: 'observation', period: 'Nov 2026', note: 'not my class', expected_version: 0, idempotency_key: 'iso-1' });
  ok(crossWrite.status === 403, 'teacher of another class CANNOT write into P4A');
  const crossRead = await fet2.req('GET', '/api/classes/' + P4A + '/records');
  ok(crossRead.status === 403, 'teacher of another class CANNOT read P4A records');
  const crossExport = await fet2.req('GET', '/api/export/class/' + P4A);
  ok(crossExport.status === 403, 'teacher of another class CANNOT export P4A');

  /* a second school inserted directly: same server, must be invisible */
  const st = srv.sprStore;
  await st.query('insert into schools (id, name) values ($1, $2)', ['school-other', 'Other School']);
  await st.query("insert into classes (id, school_id, name) values ('cls-other-1', 'school-other', 'Other 1A')");
  const fet1see = await fet1.req('GET', '/api/classes');
  ok(!fet1see.json.classes.some((c) => c.id === 'cls-other-1'), 'other school\'s class invisible in the class list');
  const forge = await fet1.req('GET', '/api/classes/cls-other-1/records');
  ok(forge.status === 404 || forge.status === 403, 'cross-school class id rejected (no data leak)');

  const mgrWrite = await mgr.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: P4A, student_id: S08, category: 'spelling', period: 'Nov 2026', value: 1, expected_version: 0, idempotency_key: 'iso-2' });
  ok(mgrWrite.status === 403, 'manager (school management) is read-only for records');
  const mgrRead = await mgr.req('GET', '/api/classes/' + P4A + '/records');
  ok(mgrRead.status === 200, 'manager reads class performance');
  const adminApiAsFet = await fet1.req('GET', '/api/admin/users');
  ok(adminApiAsFet.status === 403, 'admin API denied to teachers (no frontend role spoofing)');
}

console.log('5. deactivation + session revocation');
{
  const head = (await admin.req('GET', '/api/admin/users')).json.users.find((u) => u.username === 'head');
  const before = await mgr.req('GET', '/api/me');
  ok(before.status === 200, 'manager session works before deactivation');
  await admin.req('POST', '/api/admin/users/' + head.id + '/deactivate');
  const after = await mgr.req('GET', '/api/me');
  ok(after.status === 401, 'existing session revoked immediately on deactivation');
  const relogin = await mgr.req('POST', '/api/auth/login', { username: 'head', password: 'ManagerHead1Pass!x' });
  ok(relogin.status === 401, 'deactivated account cannot authenticate');
}

console.log('6. login rate limiting');
{
  const c = newClient();
  let got429 = false;
  for (let i = 0; i < 7 && !got429; i++) {
    const r = await c.req('POST', '/api/auth/login', { username: 'fet2', password: 'wrong-' + i });
    if (r.status === 429) got429 = true;
  }
  ok(got429, 'repeated failures trigger rate limiting (429)');
}

console.log('7. audit trail basics');
{
  const ev = (await admin.req('GET', '/api/audit?limit=200')).json.events;
  const actions = new Set(ev.map((e) => e.action));
  ok(actions.has('login.ok') && actions.has('login.fail'), 'audit records logins (ok + fail)');
  ok(actions.has('account.create') && actions.has('account.deactivate'), 'audit records account lifecycle');
  ok(actions.has('record.create') && actions.has('membership.set'), 'audit records record + membership changes');
  ok(actions.has('admin.denied'), 'audit records denied admin attempts');
  const asTeacher = await fet1.req('GET', '/api/audit');
  ok(asTeacher.status === 403, 'audit visible to admins only');
  const blob = JSON.stringify(ev);
  ok(!blob.includes('Synthetic Student') && !blob.includes('pair work'), 'audit carries NO student names or observation text');
}

await srv.sprStore.close();
srv.close();
console.log('RBAC: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
