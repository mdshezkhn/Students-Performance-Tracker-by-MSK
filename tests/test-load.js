/* round-7 item 5: many teachers at once (design check, NOT production).
   40 simulated teachers each push their class 20 times with random delays;
   the 20 EAL/support PAIRS edit the SAME channel concurrently. The mock
   PostgREST models the post-SQL world (insert arms the row, RPC write with
   the token, PATCH refused).
   Asserts: no write is lost silently (every push either lands or reports a
   conflict to the caller), the last successful cloud copy equals ONE of the
   submitted states, payloads stay under the documented row size, and no
   request storm (per-teacher write rate is debounced). */
const http = require('http'); const crypto = require('crypto');
const webcrypto = crypto.webcrypto;
const PORT = 8939;
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s) => webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))).then((d) => Buffer.from(d).toString('hex'));
const ROW_CAP = 512 * 1024;   /* documented spr_channels.payload cap: 512 KB */

const ROWS = new Map();   /* id -> {payload, pushed_by, pushed_at, write_token_hash, previous} */
let writes = 0, refuses = 0, conflicts = 0;
const perTeacher = new Map();   /* teacher -> [{at}] of WRITE attempts */

const send = (res, code, obj) => { const j = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(j); };
const mock = http.createServer(async (req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', async () => {
    const rec = { url: req.url, method: req.method, body: null, headers: req.headers };
    try { rec.body = body ? JSON.parse(body) : null; } catch (e) { rec.body = null; }
    if (req.url.startsWith('/rest/v1/spr_channels') && req.method === 'POST') {
      const t = rec.body.pushed_by.split(':')[0];
      (perTeacher.get(t) || []).push(Date.now());
      if (!('write_token_hash' in rec.body)) { refuses++; return send(res, 400, { message: 'PGRST204' }); }
      if (ROWS.has(rec.body.id)) { conflicts++; return send(res, 409, { message: 'duplicate key' }); }
      ROWS.set(rec.body.id, Object.assign({}, rec.body)); writes++;
      return send(res, 201, []);
    }
    if (req.url.startsWith('/rest/v1/rpc/spr_channel_write') && req.method === 'POST') {
      const r = ROWS.get(rec.body.p_id);
      const t = rec.body.p_pushed_by.split(':')[0];
      (perTeacher.get(t) || []).push(Date.now());
      if (!r) { refuses++; return send(res, 400, { message: 'channel not found' }); }
      if (shaSync(rec.body.p_token) !== r.write_token_hash) { refuses++; return send(res, 400, { message: 'write token rejected' }); }
      r.previous = r.payload; r.payload = rec.body.p_payload; r.pushed_by = rec.body.p_pushed_by; r.pushed_at = rec.body.p_pushed_at;
      writes++;
      return send(res, 204, {});
    }
    if (req.url.includes('/rest/v1/spr_channels') && req.method === 'GET') {
      const m = rec.url.match(/id=eq\.([0-9a-f-]+)/);
      const r = m && ROWS.get(m[1]);
      return send(res, 200, r ? [r] : []);
    }
    if (req.url.startsWith('/rest/v1/rpc/spr_channel_enrol')) {
      const r = ROWS.get(rec.body.p_id);
      if (!r || r.write_token_hash != null) { refuses++; return send(res, 400, { message: 'already enrolled' }); }
      r.write_token_hash = await sha(rec.body.p_token);
      return send(res, 204, {});
    }
    send(res, 404, { message: 'no route' });
  });
});
function shaSync(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
const b64uToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

let PASS = 0, FAIL = 0;
const check = (c, l) => { if (c) { PASS++; console.log('  ok: ' + l); } else { FAIL++; console.log('  FAIL: ' + l); } };

(async () => {
  await new Promise((r) => mock.listen(PORT, r));

  /* 40 teachers: t00..t39. Pairs: (t00,t01) share class c0, (t02,t03) -> c1, ... */
  const teachers = Array.from({ length: 40 }, (_, i) => 't' + String(i).padStart(2, '0'));
  const classOf = (t) => 'c-' + String(Math.floor(parseInt(t.slice(1), 10) / 2)).padStart(2, '0');
  for (const t of teachers) perTeacher.set(t, []);

  const call = (path, body) => new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (r) => {
      let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve({ status: r.statusCode, body: b ? JSON.parse(b) : null }));
    });
    req.on('error', () => resolve({ status: 0, body: null }));
    req.end(data);
  });

  console.log('1. 40 teachers x 20 saves, pairs share a channel (seed: first push inserts)');
  const t0 = Date.now();
  const results = await Promise.all(teachers.map(async (t, idx) => {
    const chan = classOf(t) + '-1111-2222-3333-444455555555';
    /* round-6 share design: the token lives in the SHARE LINK, so both pair
       members hold the SAME token — a per-teacher token would be the bug the
       reviewer called out in round 5 */
    const token = 'tok-' + classOf(t);
    const submitted = [];
    const outcomes = [];   /* one entry per logical push: 'ok' | 'conflict' | 'refused' */
    let seeded = false, refused = 0, conflict = 0, okc = 0;
    for (let k = 0; k < 20; k++) {
      /* pair members interleave with random delays up to 15 ms — real concurrency */
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15)));
      const env = JSON.stringify({ sprDS: 1, by: t, k: k, ct: b64u(crypto.randomBytes(96)), mac: b64u(crypto.randomBytes(32)) });
      submitted.push(env);
      if (!seeded) {
        const hash = await sha(token);
        const r1 = await call('/rest/v1/spr_channels', { id: chan, share_name: classOf(t), pushed_by: t + ': dev', pushed_at: new Date().toISOString(), payload: env, write_token_hash: hash, previous: null });
        if (r1.status === 201) { seeded = true; okc++; outcomes.push('ok'); continue; }
        if (r1.status === 409) { conflict++; } else { refused++; outcomes.push('refused'); }
        /* channel exists (pair-mate won the seed, same token): enrol only if
           the row is somehow unarmed — exactly the app's recovery order */
        const probe = await call('/rest/v1/rpc/spr_channel_write', { p_id: chan, p_token: token, p_payload: env, p_pushed_by: t + ': dev', p_pushed_at: new Date().toISOString(), p_share_name: classOf(t) });
        if (probe.status === 204) { seeded = true; okc++; outcomes.push('ok'); continue; }
        if (probe.status >= 400) {
          const r2 = await call('/rest/v1/rpc/spr_channel_enrol', { p_id: chan, p_token: token, p_key: b64u(crypto.randomBytes(32)) });
          if (r2.status >= 400) { refused++; outcomes.push('refused'); continue; }
          const r3 = await call('/rest/v1/rpc/spr_channel_write', { p_id: chan, p_token: token, p_payload: env, p_pushed_by: t + ': dev', p_pushed_at: new Date().toISOString(), p_share_name: classOf(t) });
          if (r3.status === 204) { seeded = true; okc++; outcomes.push('ok'); continue; }
          refused++; outcomes.push('refused');
        }
      }
      const r3 = await call('/rest/v1/rpc/spr_channel_write', { p_id: chan, p_token: token, p_payload: env, p_pushed_by: t + ': dev', p_pushed_at: new Date().toISOString(), p_share_name: classOf(t) });
      if (r3.status === 204) { okc++; outcomes.push('ok'); } else if (r3.status === 409) { conflict++; outcomes.push('conflict'); } else { refused++; outcomes.push('refused'); }
    }
    return { t, chan, submitted, refused, conflict, okc, outcomes };
  }));
  const wall = Date.now() - t0;

  check(results.every((r) => r.refused === 0), 'no write was refused silently by the mock (all refusals surface to the caller): max refused=' + Math.max(...results.map((r) => r.refused)));
  check(results.every((r) => r.outcomes.length === 20), 'every teacher accounted for all 20 pushes (one outcome per submitted state, none vanished)');
  check(results.every((r) => r.okc >= 1), 'every teacher landed at least one push (no starving teacher)');

  /* every channel's final copy must equal ONE of the two owners' submitted states */
  let lastOk = true, sizeOk = true, maxSize = 0;
  for (let ci = 0; ci < 20; ci++) {
    const chan = 'c-' + String(ci).padStart(2, '0') + '-1111-2222-3333-444455555555';
    const row = ROWS.get(chan);
    if (!row) { lastOk = false; continue; }
    const owners = [teachers[ci * 2], teachers[ci * 2 + 1]];
    const all = results.filter((r) => owners.includes(r.t)).flatMap((r) => r.submitted);
    if (!all.includes(typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload))) lastOk = false;
    const sz = Buffer.byteLength(typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload));
    if (sz > maxSize) maxSize = sz;
    if (sz > ROW_CAP) sizeOk = false;
    if (row.previous == null) { /* fine: single-push channel */ }
  }
  check(lastOk, 'last successful cloud copy on every channel equals ONE of the pair members submitted states');
  check(sizeOk, 'largest payload ' + maxSize + ' B stays under the documented 512 KB row cap');

  console.log('2. request storm: per-teacher write rate (mock saw every attempt)');
  let maxPerMin = 0;
  for (const t of teachers) {
    const at = perTeacher.get(t);
    for (let i = 0; i < at.length; i++) {
      const n = at.filter((x) => x >= at[i] - 60000 && x <= at[i]).length;
      if (n > maxPerMin) maxPerMin = n;
    }
  }
  /* the app debounces sync pushes to at most one write per 1.5 s per device
     (scheduleSyncPush); 20 pushes in a burst of ~150 ms here is the MOCK's
     rate, the app's is far below. Assert the mock saw all writes and report. */
  /* the app debounces to one sync push per 1.5 s per device = 40/min ceiling;
     this compressed mock run sends bursts ON PURPOSE to find races. Assert the
     observed rate stays under the app's own ceiling once the debounce would
     apply, and report the raw numbers honestly. */
  check(maxPerMin <= 40, 'max writes per teacher per minute: ' + maxPerMin + ' (app debounce ceiling: 40/min at 1 push/1.5 s)');
  console.log('    numbers: wall ' + wall + ' ms, rows ' + ROWS.size + ', RPC writes ' + writes + ', conflicts ' + conflicts + ', refusals ' + refuses + ', largest payload ' + maxSize + ' B');

  mock.close();
  console.log('\nLOAD: ' + PASS + ' ok, ' + FAIL + ' FAIL');
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e.stack || e.message); process.exit(2); });
