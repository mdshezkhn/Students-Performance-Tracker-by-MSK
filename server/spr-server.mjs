// SPR school backend — authenticated, role-enforced, record-level sync API.
// Standalone Node.js (no framework): deploys to a Mainland-China VPS next to
// PostgreSQL (docs/DEPLOYMENT-GUIDE.md). Zero npm runtime dependencies; the
// production driver is `pg` (installed on the server only), tests use PGlite.
//
// Security model (docs/SECURITY-BASELINE.md C2/C4 remediation):
//  * server-side sessions (HttpOnly cookie + CSRF header), scrypt password
//    hashing (node:crypto, OWASP parameters), login rate limiting;
//  * every data operation re-derives school/class/duty from the SESSION —
//    client-supplied ids are never trusted for authorisation;
//  * FET writes observations, CET writes spelling/test/daily — enforced here,
//    not in the browser;
//  * record-level optimistic concurrency: version mismatch = HTTP 409 with
//    BOTH versions; nothing is silently overwritten (no last-write-wins);
//  * idempotency keys: retried requests replay, never duplicate;
//  * append-only audit_events (ids and versions only, never payloads).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

/* ---------------- password hashing: scrypt (node:crypto) ----------------
   OWASP-approved memory-hard KDF, configured N=2^17, r=8, p=1 (~64 MiB).
   Argon2id needs a native addon; scrypt is Node-core and is the documented
   accepted alternative (see docs/SECURITY-BASELINE.md §remediation). */
const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const scrypt = (pw, salt) => new Promise((res, rej) => {
  crypto.scrypt(String(pw), Buffer.from(salt, 'hex'), 64, SCRYPT, (e, k) => e ? rej(e) : res(k));
});
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const k = await scrypt(pw, salt);
  return { salt, hash: k.toString('hex') };
}
async function verifyPassword(pw, salt, hex) {
  const k = await scrypt(pw, salt);
  const a = Buffer.from(k.toString('hex'), 'hex');
  const b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- small helpers ---------------- */
const rid = () => crypto.randomUUID();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowIso = () => new Date().toISOString();
const CATEGORIES = ['observation', 'spelling', 'test', 'daily'];
const DUTY_CATEGORIES = { fet: ['observation'], cet: ['spelling', 'test', 'daily'] };
const SESSION_HOURS = 12;

function bad(res, status, error, extra) {
  const body = Object.assign({ error }, extra || {});
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, HEADERS));
  res.end(JSON.stringify(body));
  return body;
}
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};
function ok(res, obj, status) {
  res.writeHead(status || 200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, HEADERS));
  res.end(JSON.stringify(obj));
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {} }
  });
  return out;
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((res, rej) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { rej(Object.assign(new Error('body too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { rej(Object.assign(new Error('invalid JSON body'), { code: 400 })); }
    });
    req.on('error', rej);
  });
}
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN));
const str = (v, cap) => (v === null || v === undefined ? '' : String(v).slice(0, cap === undefined ? 200 : cap)).trim();

/* login rate limiting: per-username lockout + per-IP throttle (in-memory; a
   single-node school server is the deployment shape — see DEPLOYMENT-GUIDE) */
const failCount = new Map();   // username -> {n, until}
const ipCount = new Map();     // ip -> [ts...]
function loginAllowed(username, ip) {
  const f = failCount.get(username);
  if (f && f.until && Date.now() < f.until) return { ok: false, retryInMs: f.until - Date.now() };
  const now = Date.now();
  const arr = (ipCount.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (arr.length >= 20) { ipCount.set(ip, arr); return { ok: false, retryInMs: 10 * 60 * 1000 - (now - arr[0]) }; }
  arr.push(now); ipCount.set(ip, arr);
  return { ok: true };
}
function loginFailed(username) {
  const f = failCount.get(username) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.until = Date.now() + 15 * 60 * 1000; f.n = 0; }
  failCount.set(username, f);
}
function loginSucceeded(username) { failCount.delete(username); }

/* ---------------- audit (ids + versions only, never payloads) ---------------- */
async function audit(store, ev) {
  try {
    await store.query(
      'insert into audit_events (school_id, actor_id, actor_name, action, target, class_id, outcome, req_id, detail) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [ev.school_id || '', ev.actor_id || '', ev.actor_name || '', ev.action, ev.target || '', ev.class_id || '', ev.outcome || 'ok', ev.req_id || '', JSON.stringify(ev.detail || {})]
    );
  } catch (e) { /* audit must never break the request path; server log gets it */ console.warn('audit failed:', e.message); }
}

/* ---------------- authorisation helpers ---------------- */
async function sessionCtx(store, req) {
  const token = parseCookies(req).spr_session;
  if (!token) return null;
  const rows = await store.query(
    'select s.id as sid, s.csrf, s.expires_at, u.id, u.school_id, u.username, u.display_name, u.role, u.active, u.must_change_pw ' +
    'from sessions s join users u on u.id = s.user_id where s.id = $1 and s.revoked_at is null',
    [sha256(token)]
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  if (!r.active) return null;
  return { sid: r.sid, csrf: r.csrf, user: { id: r.id, school_id: r.school_id, username: r.username, display_name: r.display_name, role: r.role, must_change_pw: !!r.must_change_pw } };
}
async function membershipsFor(store, userId) {
  const rows = await store.query('select class_id, duty from class_memberships where user_id = $1', [userId]);
  const map = {};
  rows.forEach((r) => { map[r.class_id] = r.duty; });
  return map;
}
async function classInSchool(store, classId, schoolId) {
  const rows = await store.query('select id from classes where id = $1 and school_id = $2', [classId, schoolId]);
  return rows.length ? true : false;
}
async function studentInClass(store, studentId, classId) {
  const rows = await store.query('select id from students where id = $1 and class_id = $2', [studentId, classId]);
  return rows.length ? true : false;
}
function canWrite(duty, category) { return !!(duty && DUTY_CATEGORIES[duty] && DUTY_CATEGORIES[duty].includes(category)); }

/* ---------------- record write core (optimistic concurrency) ---------------- */
async function writeRecord(store, ctx, body, reqId) {
  const id = String(body.id || '').trim();
  const classId = String(body.class_id || '').trim();
  const studentId = String(body.student_id || '').trim();
  const category = String(body.category || '').trim();
  const period = str(body.period, 40);
  const semesterId = body.semester_id ? String(body.semester_id) : null;
  const ordinal = Number.isInteger(body.ordinal) && body.ordinal > 0 ? body.ordinal : 1;
  const value = num(body.value);
  const maxValue = num(body.max_value);
  const note = str(body.note, 2000);
  const expected = Number(body.expected_version);
  const idemKey = str(body.idempotency_key, 120);

  if (!id || !/^[0-9a-f-]{10,64}$/i.test(id)) return { status: 400, body: { error: 'record id must be a client-generated uuid' } };
  if (!CATEGORIES.includes(category)) return { status: 400, body: { error: 'category must be one of ' + CATEGORIES.join(', ') } };
  if (value !== null && Number.isNaN(value)) return { status: 400, body: { error: 'value must be a number or null' } };
  if (value !== null && value < 0) return { status: 400, body: { error: 'value cannot be negative' } };
  if (maxValue !== null && Number.isNaN(maxValue)) return { status: 400, body: { error: 'max_value must be a number or null' } };
  if (value !== null && maxValue !== null && value > maxValue) return { status: 400, body: { error: 'value exceeds max_value (' + value + ' > ' + maxValue + ')' } };

  /* authorisation: duty comes from the session's memberships, never the body */
  if (!(await classInSchool(store, classId, ctx.user.school_id))) return { status: 404, body: { error: 'no such class' } };
  const duty = (await membershipsFor(store, ctx.user.id))[classId];
  if (!duty && ctx.user.role !== 'admin') return { status: 403, body: { error: 'you are not assigned to this class' } };
  if (!canWrite(duty, category)) return { status: 403, body: { error: 'role ' + (duty || ctx.user.role) + ' cannot write category ' + category } };
  if (!(await studentInClass(store, studentId, classId))) return { status: 400, body: { error: 'student does not belong to this class' } };

  const existing = (await store.query('select * from records where id = $1', [id]))[0] || null;

  if (!existing) {
    if (expected !== 0) return { status: 409, body: { error: 'record does not exist; send expected_version 0 to create it' } };
    const dup = (await store.query(
      'select id from records where class_id=$1 and student_id=$2 and category=$3 and period=$4 and ordinal=$5 and semester_id is not distinct from $6',
      [classId, studentId, category, period, ordinal, semesterId]
    ))[0];
    if (dup) {
      /* same logical cell under a different uuid: treat as a conflict so the
         client adopts the server row instead of silently doubling the score */
      const server = (await store.query('select * from records where id = $1', [dup.id]))[0];
      return { status: 409, body: { error: 'conflict', conflict_kind: 'duplicate-cell', server: pubRec(server), yours: { id, class_id: classId, student_id: studentId, category, period, ordinal, value, note } } };
    }
    const row = (await store.query(
      'insert into records (id, school_id, class_id, student_id, semester_id, category, period, ordinal, value, max_value, note, version, created_by, updated_by) ' +
      'values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$12) returning *',
      [id, ctx.user.school_id, classId, studentId, semesterId, category, period, ordinal, value, maxValue, note, ctx.user.username]
    ))[0];
    await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'record.create', target: id, class_id: classId, req_id: reqId, detail: { category, period, ordinal, version: 1 } });
    return { status: 201, body: { status: 'created', record: pubRec(row) } };
  }

  /* the row exists: verify school + class + ownership again from the DB row */
  if (existing.school_id !== ctx.user.school_id) return { status: 404, body: { error: 'no such record' } };
  if (existing.class_id !== classId || existing.student_id !== studentId) return { status: 400, body: { error: 'record identity (class/student) cannot change; create a new record instead' } };
  if (existing.category !== category) return { status: 400, body: { error: 'record category cannot change' } };
  if (expected !== existing.version) {
    return {
      status: 409,
      body: {
        error: 'conflict',
        conflict_kind: 'version',
        server: pubRec(existing),
        yours: { id, class_id: classId, student_id: studentId, category, period, ordinal, value, max_value: maxValue, note },
        hint: 'resolve with POST /api/records/' + existing.id + '/resolve'
      }
    };
  }
  const row = (await store.query(
    'update records set value=$1, max_value=$2, note=$3, version=version+1, updated_by=$4, updated_at=now() where id=$5 returning *',
    [value, maxValue !== null ? maxValue : existing.max_value, note, ctx.user.username, id]
  ))[0];
  await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'record.update', target: id, class_id: classId, req_id: reqId, detail: { category, period, ordinal, version: row.version } });
  return { status: 200, body: { status: 'updated', record: pubRec(row) } };
}
function pubRec(r) {
  if (!r) return null;
  return {
    id: r.id, class_id: r.class_id, student_id: r.student_id, semester_id: r.semester_id,
    category: r.category, period: r.period, ordinal: r.ordinal,
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    max_value: r.max_value === null || r.max_value === undefined ? null : Number(r.max_value),
    note: r.note, version: r.version, updated_by: r.updated_by, updated_at: r.updated_at,
    deleted_at: r.deleted_at
  };
}

/* ---------------- app factory ---------------- */
export async function createApp(opts = {}) {
  const store = opts.store || await openStore(opts);
  const cookieSecure = opts.cookieSecure === false || process.env.SPR_COOKIE_SECURE === '0' ? false : true;

  /* schema + first-run admin bootstrap */
  /* strip comments FIRST: schema comments contain semicolons, so splitting
     before stripping would produce junk statements */
  const NL = String.fromCharCode(10);
  const sqlNoComments = SCHEMA_SQL.split(NL).map((l) => l.replace(/--.*/, '')).join(NL);
  for (const stmt of sqlNoComments.split(';')) {
    const clean = stmt.trim();
    if (clean) await store.query(clean);
  }
  const anyUser = await store.query('select id from users limit 1');
  if (!anyUser.length) {
    const schoolId = 'school-' + rid().slice(0, 8);
    const adminUser = process.env.SPR_ADMIN_USER || 'admin';
    const adminPw = process.env.SPR_ADMIN_PW || 'change-me-admin';
    await store.query('insert into schools (id, name) values ($1, $2)', [schoolId, process.env.SPR_SCHOOL_NAME || 'SPR School']);
    const h = await hashPassword(adminPw);
    await store.query(
      'insert into users (id, school_id, username, display_name, role, pw_salt, pw_hash, must_change_pw) values ($1,$2,$3,$4,$5,$6,$7,true)',
      [rid(), schoolId, adminUser, 'Administrator', 'admin', h.salt, h.hash]
    );
    await audit(store, { school_id: schoolId, action: 'bootstrap.admin', target: adminUser, detail: { note: 'first-run admin created with must_change_pw' } });
  }

  const staticDir = opts.staticDir ? path.resolve(opts.staticDir) : null;
  const server = http.createServer(async (req, res) => {
    const reqId = rid();
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname;
    let m = null;
    try {
      if (p === '/api/health') {
        return ok(res, { ok: true, store: store.kind, time: nowIso() });
      }

      /* ---- optional same-origin static hosting (single-box deployments and
         the browser integration test). Enabled by opts.staticDir; path
         traversal is blocked; only whitelisted types are served. ---- */
      if (staticDir && !p.startsWith('/api/')) {
        const rel = p.replace(/^\/+/, '');
        const segs = rel.split('/').filter((seg) => seg && seg !== '.' && seg !== '..');
        const safe = segs.join('/');
          let fp = path.join(staticDir, safe);
          if (safe === '' || safe.endsWith('/')) fp = path.join(fp, 'index.html');
          try {
            const data = await fsPromises.readFile(fp);
            const ext = path.extname(fp).toLowerCase();
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
            res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            return res.end(data);
          } catch (eStatic) { /* fall through to 404 */ }
        return bad(res, 404, 'not found');
      }

      
      /* ---- auth ---- */
      if (p === '/api/auth/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown';
        const body = await readBody(req);
        const username = str(body.username, 60).toLowerCase();
        const allow = loginAllowed(username, ip);
        if (!allow.ok) {
          await audit(store, { action: 'login.throttled', target: username || '-', outcome: 'blocked', req_id: reqId, detail: { ms: allow.retryInMs } });
          return bad(res, 429, 'too many attempts; try again in ' + Math.ceil(allow.retryInMs / 60000) + ' minutes');
        }
        const rows = await store.query('select * from users where lower(username) = $1', [username]);
        const user = rows[0] || null;
        if (!user || !user.active || !(await verifyPassword(String(body.password || ''), user.pw_salt, user.pw_hash))) {
          loginFailed(username);
          await audit(store, { school_id: user ? user.school_id : '', actor_name: username, action: 'login.fail', outcome: 'denied', req_id: reqId });
          return bad(res, 401, 'wrong username or password');
        }
        loginSucceeded(username);
        const token = crypto.randomBytes(32).toString('base64url');
        const csrf = crypto.randomBytes(24).toString('base64url');
        await store.query('insert into sessions (id, user_id, csrf, expires_at) values ($1,$2,$3,$4)',
          [sha256(token), user.id, csrf, new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString()]);
        await audit(store, { school_id: user.school_id, actor_id: user.id, actor_name: user.username, action: 'login.ok', req_id: reqId });
        res.setHeader('Set-Cookie', 'spr_session=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + (SESSION_HOURS * 3600) + (cookieSecure ? '; Secure' : ''));
        return ok(res, { user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, must_change_pw: !!user.must_change_pw }, csrf, server_time: nowIso() });
      }

      /* everything below needs a session */
      const ctx = await sessionCtx(store, req);
      if (!ctx) return bad(res, 401, 'sign in first');
      if (req.method !== 'GET' && p !== '/api/auth/logout') {
        if (req.headers['x-csrf-token'] !== ctx.csrf) return bad(res, 403, 'missing or wrong CSRF token');
      }

      if (p === '/api/auth/logout' && req.method === 'POST') {
        await store.query('update sessions set revoked_at = now() where id = $1', [ctx.sid]);
        await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'logout', req_id: reqId });
        return ok(res, { ok: true });
      }
      if (p === '/api/me' && req.method === 'GET') {
        const memberships = await membershipsFor(store, ctx.user.id);
        return ok(res, { user: ctx.user, memberships, csrf: ctx.csrf, server_time: nowIso() });
      }
      if (p === '/api/auth/change-password' && req.method === 'POST') {
        const body = await readBody(req);
        const rows = await store.query('select * from users where id = $1', [ctx.user.id]);
        const user = rows[0];
        if (!(await verifyPassword(String(body.current || ''), user.pw_salt, user.pw_hash))) {
          await audit(store, { school_id: user.school_id, actor_id: user.id, actor_name: user.username, action: 'password.change', outcome: 'denied', req_id: reqId });
          return bad(res, 403, 'current password is wrong');
        }
        const pw = String(body.next || '');
        if (pw.length < 12) return bad(res, 400, 'new password must be at least 12 characters');
        const h = await hashPassword(pw);
        await store.query('update users set pw_salt=$1, pw_hash=$2, must_change_pw=false, updated_at=now() where id=$3', [h.salt, h.hash, user.id]);
        await store.query('update sessions set revoked_at=now() where user_id=$1 and id<>$2', [user.id, ctx.sid]);
        await audit(store, { school_id: user.school_id, actor_id: user.id, actor_name: user.username, action: 'password.change', req_id: reqId });
        return ok(res, { ok: true });
      }

      /* ---- classes / rosters (read) ---- */
      if (p === '/api/classes' && req.method === 'GET') {
        const rows = await store.query(
          'select c.id, c.name, c.grade from classes c where c.school_id = $1 and c.active order by c.name', [ctx.user.school_id]);
        const mem = await membershipsFor(store, ctx.user.id);
        const classes = rows.map((c) => ({ id: c.id, name: c.name, grade: c.grade, duty: mem[c.id] || null }));
        const visible = ctx.user.role === 'admin' || ctx.user.role === 'manager' ? classes : classes.filter((c) => c.duty);
        return ok(res, { classes: visible });
      }
      if ((m = p.match(/^\/api\/classes\/([0-9a-f-]+)\/records$/)) && req.method === 'GET') {
        const duty = (await membershipsFor(store, ctx.user.id))[m[1]];
        if (!duty && ctx.user.role !== 'admin' && ctx.user.role !== 'manager') return bad(res, 403, 'not your class');
        if (!(await classInSchool(store, m[1], ctx.user.school_id))) return bad(res, 404, 'no such class');
        const since = u.searchParams.get('since');
        const cat = u.searchParams.get('category');
        const rows = await store.query(
          'select * from records where class_id = $1 and ($2::timestamptz is null or updated_at > $2) and ($3::text is null or category = $3) order by updated_at asc limit 5000',
          [m[1], since && !isNaN(Date.parse(since)) ? since : null, cat && CATEGORIES.includes(cat) ? cat : null]
        );
        return ok(res, { records: rows.map(pubRec), server_time: nowIso() });
      }
      if ((m = p.match(/^\/api\/classes\/([0-9a-f-]+)\/students$/)) && req.method === 'GET') {
        const duty = (await membershipsFor(store, ctx.user.id))[m[1]];
        if (!duty && ctx.user.role !== 'admin' && ctx.user.role !== 'manager') return bad(res, 403, 'not your class');
        if (!(await classInSchool(store, m[1], ctx.user.school_id))) return bad(res, 404, 'no such class');
        const rows = await store.query(
          'select id, student_no, name_cn, name_en, gender, under14, active from students where class_id = $1 order by student_no', [m[1]]);
        return ok(res, { students: rows });
      }

      /* ---- students (write: any assigned teacher of the class or admin) ---- */
      if (p === '/api/students' && req.method === 'POST') {
        const body = await readBody(req);
        const classId = String(body.class_id || '');
        if (!(await classInSchool(store, classId, ctx.user.school_id))) return bad(res, 404, 'no such class');
        const duty = (await membershipsFor(store, ctx.user.id))[classId];
        if (!duty && ctx.user.role !== 'admin') return bad(res, 403, 'not your class');
        const dup = (await store.query('select * from students where class_id=$1 and student_no=$2', [classId, str(body.student_no, 20)]))[0];
        if (dup) return ok(res, { status: 'exists', student: dup });
        const gender = body.gender === 'M' || body.gender === 'F' ? body.gender : null;
        const row = (await store.query(
          'insert into students (id, school_id, class_id, student_no, name_cn, name_en, gender, under14, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',
          [rid(), ctx.user.school_id, classId, str(body.student_no, 20), str(body.name_cn, 60), str(body.name_en, 60), gender, body.under14 === true ? true : body.under14 === false ? false : null, ctx.user.username]
        ))[0];
        await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'student.create', target: row.id, class_id: classId, req_id: reqId });
        return ok(res, { status: 'created', student: row }, 201);
      }

      /* ---- records: the collaborative write path ---- */
      if (p === '/api/records' && req.method === 'POST') {
        const body = await readBody(req);
        const idemKey = str(body.idempotency_key, 120);
        if (idemKey) {
          const prior = (await store.query('select result from sync_ops where user_id=$1 and idem_key=$2', [ctx.user.id, idemKey]))[0];
          if (prior) return ok(res, Object.assign({ replayed: true }, prior.result));
        }
        const out = await writeRecord(store, ctx, body, reqId);
        if (idemKey && out.status < 400) {
          await store.query('insert into sync_ops (id, user_id, idem_key, record_id, result) values ($1,$2,$3,$4,$5)',
            [rid(), ctx.user.id, idemKey, String(body.id || ''), JSON.stringify(out.body)]);
        }
        if (out.status === 409 && out.body.error === 'conflict') {
          await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'record.conflict', target: String(body.id || ''), class_id: String(body.class_id || ''), req_id: reqId, detail: { conflict_kind: out.body.conflict_kind } });
        }
        if (out.status >= 400) return bad(res, out.status, out.body.error, out.body);
        return ok(res, out.body, out.status);
      }
      if ((m = p.match(/^\/api\/records\/([0-9a-f-]+)\/resolve$/)) && req.method === 'POST') {
        const body = await readBody(req);
        const recId = m[1];
        const rec = (await store.query('select * from records where id = $1', [recId]))[0];
        if (!rec || rec.school_id !== ctx.user.school_id) return bad(res, 404, 'no such record');
        const duty = (await membershipsFor(store, ctx.user.id))[rec.class_id];
        if (!canWrite(duty, rec.category) && ctx.user.role !== 'admin') return bad(res, 403, 'you cannot resolve this record');
        const idemKey = str(body.idempotency_key, 120);
        if (idemKey) {
          const prior = (await store.query('select result from sync_ops where user_id=$1 and idem_key=$2', [ctx.user.id, idemKey]))[0];
          if (prior) return ok(res, Object.assign({ replayed: true }, prior.result));
        }
        const choice = body.resolution === 'incoming' ? 'incoming' : body.resolution === 'server' ? 'server' : null;
        if (!choice) return bad(res, 400, 'resolution must be "incoming" or "server"');
        let out;
        if (choice === 'incoming') {
          const inc = body.incoming || {};
          const value = num(inc.value); const maxValue = num(inc.max_value); const note = str(inc.note, 2000);
          if (value !== null && Number.isNaN(value)) return bad(res, 400, 'incoming.value must be a number or null');
          const row = (await store.query(
            'update records set value=$1, max_value=$2, note=$3, version=version+1, updated_by=$4, updated_at=now() where id=$5 returning *',
            [value, maxValue !== null ? maxValue : rec.max_value, note, ctx.user.username, recId]
          ))[0];
          out = { status: 'resolved-incoming', record: pubRec(row) };
        } else {
          out = { status: 'resolved-server', record: pubRec(rec) };  // client discards its copy
        }
        await store.query('insert into sync_ops (id, user_id, idem_key, record_id, result) values ($1,$2,$3,$4,$5)', [rid(), ctx.user.id, idemKey || rid(), recId, JSON.stringify(out)]);
        await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'record.conflict.resolve', target: recId, class_id: rec.class_id, req_id: reqId, detail: { chosen: choice, version: out.record ? out.record.version : null } });
        return ok(res, out);
      }
      if ((m = p.match(/^\/api\/records\/([0-9a-f-]+)\/delete$/)) && req.method === 'POST') {
        const body = await readBody(req);
        const rec = (await store.query('select * from records where id = $1', [m[1]]))[0];
        if (!rec || rec.school_id !== ctx.user.school_id) return bad(res, 404, 'no such record');
        const duty = (await membershipsFor(store, ctx.user.id))[rec.class_id];
        if (!canWrite(duty, rec.category) && ctx.user.role !== 'admin') return bad(res, 403, 'you cannot delete this record');
        if (Number(body.expected_version) !== rec.version) return bad(res, 409, 'conflict', { error: 'conflict', server: pubRec(rec) });
        const row = (await store.query('update records set deleted_at=now(), version=version+1, updated_by=$1, updated_at=now() where id=$2 returning *', [ctx.user.username, m[1]]))[0];
        await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'record.delete', target: m[1], class_id: rec.class_id, req_id: reqId, detail: { version: row.version } });
        return ok(res, { status: 'deleted', record: pubRec(row) });
      }

      /* ---- semesters ---- */
      if (p === '/api/semesters' && req.method === 'GET') {
        const rows = await store.query('select id, name, starts_on, ends_on, active from semesters where school_id=$1 order by name', [ctx.user.school_id]);
        return ok(res, { semesters: rows });
      }
      if (p === '/api/semesters' && req.method === 'POST') {
        if (ctx.user.role !== 'admin') return bad(res, 403, 'admin only');
        const body = await readBody(req);
        const name = str(body.name, 60);
        if (!name) return bad(res, 400, 'semester name required');
        const dup = (await store.query('select id from semesters where school_id=$1 and name=$2', [ctx.user.school_id, name]))[0];
        if (dup) return ok(res, { status: 'exists', semester: dup });
        const row = (await store.query('insert into semesters (id, school_id, name, starts_on, ends_on) values ($1,$2,$3,$4,$5) returning *',
          [rid(), ctx.user.school_id, name, body.starts_on || null, body.ends_on || null]))[0];
        await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'semester.create', target: row.id, req_id: reqId });
        return ok(res, { status: 'created', semester: row }, 201);
      }

      /* ---- admin ---- */
      if (p.startsWith('/api/admin/')) {
        if (ctx.user.role !== 'admin') { await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'admin.denied', target: p, outcome: 'denied', req_id: reqId }); return bad(res, 403, 'admin only'); }
        if (p === '/api/admin/users' && req.method === 'POST') {
          const body = await readBody(req);
          const username = str(body.username, 60).toLowerCase();
          const role = ['admin', 'manager', 'teacher'].includes(body.role) ? body.role : null;
          const pw = String(body.password || '');
          if (!/^[a-z0-9._-]{3,40}$/.test(username)) return bad(res, 400, 'username: 3-40 chars, letters/digits/._-');
          if (!role) return bad(res, 400, 'role must be admin, manager or teacher');
          if (pw.length < 12) return bad(res, 400, 'password must be at least 12 characters');
          const dup = (await store.query('select id from users where school_id=$1 and lower(username)=$2', [ctx.user.school_id, username]))[0];
          if (dup) return bad(res, 409, 'that username already exists');
          const h = await hashPassword(pw);
          const row = (await store.query(
            'insert into users (id, school_id, username, display_name, role, pw_salt, pw_hash, must_change_pw) values ($1,$2,$3,$4,$5,$6,$7,true) returning id, username, display_name, role, active',
            [rid(), ctx.user.school_id, username, str(body.display_name, 80) || username, role, h.salt, h.hash]
          ))[0];
          await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'account.create', target: username, req_id: reqId, detail: { role } });
          return ok(res, { status: 'created', user: row }, 201);
        }
        if ((m = p.match(/^\/api\/admin\/users\/([0-9a-f-]+)\/deactivate$/)) && req.method === 'POST') {
          const row = (await store.query('select * from users where id=$1 and school_id=$2', [m[1], ctx.user.school_id]))[0];
          if (!row) return bad(res, 404, 'no such user');
          if (row.id === ctx.user.id) return bad(res, 400, 'you cannot deactivate your own account');
          await store.query('update users set active=false, updated_at=now() where id=$1', [m[1]]);
          await store.query('update sessions set revoked_at=now() where user_id=$1', [m[1]]);
          await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'account.deactivate', target: row.username, req_id: reqId });
          return ok(res, { ok: true });
        }
        if ((m = p.match(/^\/api\/admin\/users\/([0-9a-f-]+)\/reset-password$/)) && req.method === 'POST') {
          const body = await readBody(req);
          const pw = String(body.password || '');
          if (pw.length < 12) return bad(res, 400, 'password must be at least 12 characters');
          const row = (await store.query('select * from users where id=$1 and school_id=$2', [m[1], ctx.user.school_id]))[0];
          if (!row) return bad(res, 404, 'no such user');
          const h = await hashPassword(pw);
          await store.query('update users set pw_salt=$1, pw_hash=$2, must_change_pw=true, updated_at=now() where id=$3', [h.salt, h.hash, m[1]]);
          await store.query('update sessions set revoked_at=now() where user_id=$1', [m[1]]);
          await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'account.password-reset', target: row.username, req_id: reqId });
          return ok(res, { ok: true });
        }
        if (p === '/api/admin/classes' && req.method === 'POST') {
          const body = await readBody(req);
          const name = str(body.name, 60);
          if (!name) return bad(res, 400, 'class name required');
          const dup = (await store.query('select id from classes where school_id=$1 and name=$2', [ctx.user.school_id, name]))[0];
          if (dup) return bad(res, 409, 'that class already exists');
          const row = (await store.query('insert into classes (id, school_id, name, grade) values ($1,$2,$3,$4) returning *',
            [rid(), ctx.user.school_id, name, str(body.grade, 30)]))[0];
          await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'class.create', target: row.id, req_id: reqId, detail: { name } });
          return ok(res, { status: 'created', class: row }, 201);
        }
        if (p === '/api/admin/memberships' && req.method === 'POST') {
          const body = await readBody(req);
          const duty = body.duty === 'fet' || body.duty === 'cet' ? body.duty : null;
          if (!duty) return bad(res, 400, 'duty must be fet or cet');
          const cls = (await store.query('select id from classes where id=$1 and school_id=$2', [String(body.class_id || ''), ctx.user.school_id]))[0];
          if (!cls) return bad(res, 404, 'no such class');
          const usr = (await store.query('select id, username from users where id=$1 and school_id=$2', [String(body.user_id || ''), ctx.user.school_id]))[0];
          if (!usr) return bad(res, 404, 'no such user');
          await store.query('insert into class_memberships (class_id, user_id, duty) values ($1,$2,$3) on conflict (class_id, user_id) do update set duty = excluded.duty', [cls.id, usr.id, duty]);
          await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'membership.set', target: usr.username, class_id: cls.id, req_id: reqId, detail: { duty } });
          return ok(res, { ok: true });
        }
        if (p === '/api/admin/memberships' && req.method === 'DELETE') {
          const classId = String(u.searchParams.get('class_id') || '');
          const userId = String(u.searchParams.get('user_id') || '');
          const cls = (await store.query('select id from classes where id=$1 and school_id=$2', [classId, ctx.user.school_id]))[0];
          if (!cls) return bad(res, 404, 'no such class');
          const usr = (await store.query('select id, username from users where id=$1 and school_id=$2', [userId, ctx.user.school_id]))[0];
          if (!usr) return bad(res, 404, 'no such user');
          await store.query('delete from class_memberships where class_id=$1 and user_id=$2', [classId, userId]);
          await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'membership.remove', target: usr.username, class_id: classId, req_id: reqId });
          return ok(res, { ok: true });
        }
        if (p === '/api/admin/users' && req.method === 'GET') {
          const rows = await store.query('select u.id, u.username, u.display_name, u.role, u.active, u.must_change_pw from users u where u.school_id=$1 order by u.username', [ctx.user.school_id]);
          const mem = await store.query('select class_id, user_id, duty from class_memberships');
          const byUser = {};
          mem.forEach((r) => { (byUser[r.user_id] = byUser[r.user_id] || []).push({ class_id: r.class_id, duty: r.duty }); });
          return ok(res, { users: rows.map((r) => Object.assign(r, { memberships: byUser[r.id] || [] })) });
        }
      }

      /* ---- audit reader: admins only, outside the /api/admin prefix ---- */
      if (p === '/api/audit' && req.method === 'GET') {
        if (ctx.user.role !== 'admin') return bad(res, 403, 'admin only');
        const limit = Math.min(Number(u.searchParams.get('limit') || 100) || 100, 500);
        const rows = await store.query('select id, school_id, actor_name, action, target, class_id, outcome, req_id, detail, at from audit_events where school_id=$1 order by id desc limit $2', [ctx.user.school_id, limit]);
        return ok(res, { events: rows });
      }

      /* ---- class export (migration / reports) ---- */
      if ((m = p.match(/^\/api\/export\/class\/([0-9a-f-]+)$/)) && req.method === 'GET') {
        const duty = (await membershipsFor(store, ctx.user.id))[m[1]];
        if (!duty && ctx.user.role !== 'admin' && ctx.user.role !== 'manager') return bad(res, 403, 'not your class');
        if (!(await classInSchool(store, m[1], ctx.user.school_id))) return bad(res, 404, 'no such class');
        const students = await store.query('select id, student_no, name_cn, name_en, gender from students where class_id=$1 and active order by student_no', [m[1]]);
        const records = await store.query('select * from records where class_id=$1 order by updated_at', [m[1]]);
        await audit(store, { school_id: ctx.user.school_id, actor_id: ctx.user.id, actor_name: ctx.user.username, action: 'data.export', target: m[1], class_id: m[1], req_id: reqId });
        return ok(res, { students: students, records: records.map(pubRec), exported_at: nowIso() });
      }

return bad(res, 404, 'no such API endpoint');
    } catch (e) {
      if (e && e.code === 413) return bad(res, 413, 'request body too large');
      if (e && e.code === 400) return bad(res, 400, e.message);
      console.error('[' + reqId + ']', req.method, p, e.message);
      return bad(res, 500, 'internal error (ref ' + reqId + ')');
    }
  });
  server.sprStore = store;
  return server;
}

/* CLI entry: node server/spr-server.mjs (env: SPR_DB_URL, SPR_PORT, ...) */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.SPR_PORT || 8787);
  createApp({ staticDir: process.env.SPR_STATIC_DIR || null }).then((srv) => {
    srv.listen(port, () => console.log('SPR school backend listening on :' + port + ' (store: ' + srv.sprStore.kind + ')'));
  }).catch((e) => { console.error('startup failed:', e.message); process.exit(1); });
}
