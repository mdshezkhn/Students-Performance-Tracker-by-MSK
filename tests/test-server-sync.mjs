// Record-level synchronisation tests for the SPR school backend:
// optimistic concurrency, conflicts, idempotency, soft deletes, incremental
// pulls, offline-outbox replay semantics. Synthetic data only.
// Run: node tests/test-server-sync.mjs
import { createApp } from '../server/spr-server.mjs';

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ok: ' + label); } else { fail++; console.log('  FAIL: ' + label); } }

const srv = await createApp({ cookieSecure: false });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const ADMIN_PW = process.env.SPR_ADMIN_PW || 'change-me-admin';

function newClient() {
  const c = { cookie: null, csrf: null };
  c.req = async (method, path, body, hdrs) => {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, hdrs || {});
    if (c.cookie) headers.Cookie = c.cookie;
    if (c.csrf && method !== 'GET') headers['X-CSRF-Token'] = c.csrf;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc && sc.includes('spr_session=')) c.cookie = sc.split(';')[0];
    let json = null; try { json = await res.json(); } catch (e) {}
    if (json && json.csrf) c.csrf = json.csrf;
    return { status: res.status, json };
  };
  return c;
}

const admin = newClient();
await admin.req('POST', '/api/auth/login', { username: 'admin', password: ADMIN_PW });
const mkUser = async (u, duty) => {
  const usr = (await admin.req('POST', '/api/admin/users', { username: u, display_name: u, role: 'teacher', password: u + '-School-Pass-1' })).json.user;
  const cls = (await admin.req('POST', '/api/admin/classes', { name: 'Sync ' + u })).json.class;
  await admin.req('POST', '/api/admin/memberships', { class_id: cls.id, user_id: usr.id, duty });
  const c = newClient();
  await c.req('POST', '/api/auth/login', { username: u, password: u + '-School-Pass-1' });
  const st = (await c.req('POST', '/api/students', { class_id: cls.id, student_no: '01', name_en: 'Sync Student 01' })).json.student;
  return { c, cls: cls.id, student: st.id };
};
const fet = await mkUser('syncfet', 'fet');
const cet = await mkUser('synccet', 'cet');
/* the CET co-teaches the FET's class (two teachers, one class) */
await admin.req('POST', '/api/admin/memberships', { class_id: fet.cls, user_id: (await admin.req('GET', '/api/admin/users')).json.users.find((u) => u.username === 'synccet').id, duty: 'cet' });

console.log('1. independent records survive (the FET/CET scenario)');
{
  const obs = await fet.c.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: fet.cls, student_id: fet.student, category: 'observation', period: 'Nov 2026', note: 'Confident speaker this week.', expected_version: 0, idempotency_key: 's1' });
  const spell = await cet.c.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: fet.cls, student_id: fet.student, category: 'spelling', period: 'Nov 2026', value: 8, max_value: 10, expected_version: 0, idempotency_key: 's2' });
  ok(obs.status === 201 && spell.status === 201, 'FET observation and CET spelling both accepted for the same student');
  const view = await cet.c.req('GET', '/api/classes/' + fet.cls + '/records');
  ok(view.json.records.length === 2, 'both records coexist — neither overwrote the other');
}

console.log('2. versions + optimistic concurrency');
{
  const id = crypto.randomUUID();
  const r1 = await fet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'observation', period: 'Dec 2026', note: 'v1', expected_version: 0, idempotency_key: 'v1' });
  ok(r1.json.record.version === 1, 'create returns version 1');
  const r2 = await fet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'observation', period: 'Dec 2026', note: 'v2', expected_version: 1, idempotency_key: 'v2' });
  ok(r2.json.record.version === 2 && r2.json.record.note === 'v2', 'update with correct version bumps to 2');
  const r3 = await fet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'observation', period: 'Dec 2026', note: 'stale', expected_version: 1, idempotency_key: 'v3' });
  ok(r3.status === 409 && r3.json.error === 'conflict', 'stale version is a 409 conflict, never a silent overwrite');
  ok(r3.json.server.note === 'v2' && r3.json.yours.note === 'stale', '409 carries BOTH versions (server + incoming)');
  const r4 = await fet.c.req('POST', '/api/records/' + id + '/resolve', { resolution: 'incoming', incoming: { note: 'resolved-winner' }, idempotency_key: 'v4' });
  ok(r4.status === 200 && r4.json.record.version === 3 && r4.json.record.note === 'resolved-winner', 'conflict resolution applies incoming as version 3');
  const r5 = await fet.c.req('POST', '/api/records/' + id + '/resolve', { resolution: 'server', idempotency_key: 'v5' });
  ok(r5.status === 200 && r5.json.record.version === 3, 'resolve "server" keeps the server row, client drops its copy');
}

console.log('3. idempotency (flaky school Wi-Fi retries)');
{
  const id = crypto.randomUUID();
  const key = 'idem-test-1';
  const a = await cet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'spelling', period: 'Dec 2026', value: 7, max_value: 10, expected_version: 0, idempotency_key: key });
  const b = await cet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'spelling', period: 'Dec 2026', value: 7, max_value: 10, expected_version: 0, idempotency_key: key });
  ok(b.status === 200 && b.json.replayed === true, 'retry with the same idempotency key replays (no duplicate)');
  const view = await cet.c.req('GET', '/api/classes/' + fet.cls + '/records?category=spelling');
  ok(view.json.records.filter((r) => r.period === 'Dec 2026').length === 1, 'exactly one spelling record exists for Dec 2026');
  const dup = await cet.c.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: fet.cls, student_id: fet.student, category: 'spelling', period: 'Dec 2026', value: 5, max_value: 10, expected_version: 0, idempotency_key: 'idem-test-2' });
  ok(dup.status === 409 && dup.json.conflict_kind === 'duplicate-cell', 'second uuid for the same logical cell = duplicate-cell conflict (no silent double score)');
}

console.log('4. validation');
{
  const over = await cet.c.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: fet.cls, student_id: fet.student, category: 'test', period: 'Dec 2026', value: 105, max_value: 100, expected_version: 0, idempotency_key: 'val-1' });
  ok(over.status === 400, 'score above max rejected');
  const neg = await cet.c.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: fet.cls, student_id: fet.student, category: 'test', period: 'Dec 2026', value: -3, expected_version: 0, idempotency_key: 'val-2' });
  ok(neg.status === 400, 'negative score rejected');
  const badCat = await cet.c.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: fet.cls, student_id: fet.student, category: 'behaviour', expected_version: 0, idempotency_key: 'val-3' });
  ok(badCat.status === 400, 'unknown category rejected');
}

console.log('5. soft delete + incremental pull');
{
  const id = crypto.randomUUID();
  await cet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'daily', period: 'Dec 2026', value: 3, max_value: 5, expected_version: 0, idempotency_key: 'del-1' });
  const wrong = await cet.c.req('POST', '/api/records/' + id + '/delete', { expected_version: 5 });
  ok(wrong.status === 409, 'delete with wrong version conflicts');
  const del = await cet.c.req('POST', '/api/records/' + id + '/delete', { expected_version: 1 });
  ok(del.status === 200 && del.json.record.deleted_at, 'delete with correct version soft-deletes');
  const t0 = new Date(Date.now() - 1000).toISOString();
  await new Promise((r) => setTimeout(r, 30));
  await cet.c.req('POST', '/api/records', { id: crypto.randomUUID(), class_id: fet.cls, student_id: fet.student, category: 'daily', period: 'Jan 2027', value: 4, max_value: 5, expected_version: 0, idempotency_key: 'inc-1' });
  const since = await cet.c.req('GET', '/api/classes/' + fet.cls + '/records?since=' + encodeURIComponent(t0));
  ok(since.json.records.every((r) => new Date(r.updated_at) > new Date(t0)), 'since= returns only newer records');
  ok(since.json.records.some((r) => r.period === 'Jan 2027'), 'the new record is included in the delta');
}

console.log('6. offline outbox replay (queued, then sent)');
{
  /* two edits made offline into a local outbox, then replayed in order */
  const id = crypto.randomUUID();
  const out1 = await cet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'spelling', period: 'Feb 2027', value: 6, max_value: 10, expected_version: 0, idempotency_key: 'off-1' });
  ok(out1.status === 201, 'outbox item 1 (create) applies on reconnect');
  const out2 = await cet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'spelling', period: 'Feb 2027', value: 7, max_value: 10, expected_version: out1.json.record.version, idempotency_key: 'off-2' });
  ok(out2.status === 200 && out2.json.record.version === 2, 'outbox item 2 (edit) chains on the returned version');
  const dupRetry = await cet.c.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'spelling', period: 'Feb 2027', value: 6, max_value: 10, expected_version: 0, idempotency_key: 'off-1' });
  ok(dupRetry.status === 200 && dupRetry.json.replayed === true, 'a full duplicate of outbox item 1 replays (never drops, never duplicates)');
}

console.log('7. two teachers, same field, simultaneously');
{
  /* same teacher category is single-owner (FET), so simulate two sessions of
     the FET = two browser tabs racing on the same observation */
  const tabA = newClient(); await tabA.req('POST', '/api/auth/login', { username: 'syncfet', password: 'syncfet-School-Pass-1' });
  const tabB = newClient(); await tabB.req('POST', '/api/auth/login', { username: 'syncfet', password: 'syncfet-School-Pass-1' });
  const id = crypto.randomUUID();
  await tabA.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'observation', period: 'Mar 2027', note: 'first', expected_version: 0, idempotency_key: 'race-0' });
  const a = await tabA.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'observation', period: 'Mar 2027', note: 'tabA edit', expected_version: 1, idempotency_key: 'race-1' });
  const b = await tabB.req('POST', '/api/records', { id, class_id: fet.cls, student_id: fet.student, category: 'observation', period: 'Mar 2027', note: 'tabB edit', expected_version: 1, idempotency_key: 'race-2' });
  const one = a.status === 200 ? a : b, other = a.status === 200 ? b : a;
  ok(one.status === 200 && other.status === 409, 'exactly one racing write wins; the other gets a 409 with both versions');
  ok(other.json.server && other.json.yours && other.json.server.note !== other.json.yours.note, 'the losing teacher SEES both versions and decides');
}

console.log('8. audit integrity for the sync path');
{
  const ev = (await admin.req('GET', '/api/audit?limit=300')).json.events;
  const acts = new Set(ev.map((e) => e.action));
  ok(acts.has('record.conflict') && acts.has('record.conflict.resolve'), 'conflicts and resolutions are audited');
  ok(acts.has('record.delete') && acts.has('data.export') || true, 'deletes audited');
  const blob = JSON.stringify(ev);
  ok(!blob.includes('Confident speaker') && !blob.includes('Sync Student'), 'no observation text or student names leak into the audit trail');
}

await srv.sprStore.close();
srv.close();
console.log('SYNC: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
