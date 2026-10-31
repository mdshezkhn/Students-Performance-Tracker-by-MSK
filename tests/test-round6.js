/* round-6 regression suite (2026-10-29, reviewer items 1-3).
   Written FAILING FIRST against round5 ca89b53.
   Item 1: the adopted SQL must close the hole WHATEVER the old policy is
           called (proven by the real-Postgres harness sql-policy-test.mjs,
           run here as a child process when PGlite is installed).
   Item 2: Save & Share channels get their own write token (share config +
           share link), both teachers push through the RPC, old rows enrol
           from the share-key proof (envelope must carry mac).
   Item 3: the persistent-storage line resolves within 3 s in class mode too. */
const fs = require('fs'); const path = require('path'); const webcrypto = require('crypto').webcrypto;
const http = require('http');
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const html0 = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V2_KEY = 'p4c4-markbook-v2', AUTH_KEY = 'spr-auth-v1', SHARE_KEY = 'spr-share-v1';
const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';
const PERSIST_STUB = 'try{Object.defineProperty(navigator,"storage",{value:{persist:async()=>{window.__PERSIST_CALLS=(window.__PERSIST_CALLS||0)+1;return true;},persisted:async()=>true,estimate:async()=>({usage:1,quota:2})},configurable:true});}catch(e){}';
let PASS = 0, FAIL = 0;
function check(cond, label) { if (cond) { PASS++; console.log('  ok: ' + label); } else { FAIL++; console.log('  FAIL: ' + label); } }
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const uuidLike = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/* ---------- mock PostgREST (models BEFORE and AFTER the SQL) ---------- */
let MOCK_MODE = 'after';   /* 'before': no RPCs, no hash column; 'after': full */
const MOCK_PORT = 8917;
const calls = [];
function b64uToBuf(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
function hmacB64u(keyBuf, msgBuf) {
  return webcrypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((k) => webcrypto.subtle.sign('HMAC', k, msgBuf)).then((sig) => b64u(new Uint8Array(sig)));
}
function j(status, obj) { return { ok: status >= 200 && status < 300, status: status, json: async () => obj, text: async () => JSON.stringify(obj) }; }
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const url = req.url.split('?')[0];
    const rec = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    calls.push(rec);
    const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const row = () => MOCK_ROWS.find((r) => r.id === rec.__id) || null;
    if (url === '/rest/v1/rpc/spr_channel_write') {
      if (MOCK_MODE === 'before') return send(404, { message: 'function spr_channel_write does not exist' });
      const r = MOCK_ROWS.find((x) => x.id === rec.body.p_id);
      if (!r) return send(400, { message: 'spr_channel_write: channel not found' });
      if (r.write_token_hash == null) return send(400, { message: 'spr_channel_write: channel has no token enrolled yet' });
      const h = webcrypto.createHash ? null : null;
      const tokHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(String(rec.body.p_token)))).toString('hex');
      if (tokHash !== r.write_token_hash) return send(400, { message: 'spr_channel_write: write token rejected' });
      r.previous = r.payload; r.payload = rec.body.p_payload; r.pushed_by = rec.body.p_pushed_by; r.pushed_at = rec.body.p_pushed_at;
      return send(204, {});
    }
    if (url === '/rest/v1/rpc/spr_channel_enrol') {
      if (MOCK_MODE === 'before') return send(404, { message: 'function spr_channel_enrol does not exist' });
      const r = MOCK_ROWS.find((x) => x.id === rec.body.p_id);
      if (!r) return send(400, { message: 'spr_channel_enrol: channel not found' });
      if (r.write_token_hash != null) return send(400, { message: 'spr_channel_enrol: channel already enrolled' });
      const macCalc = await hmacB64u(b64uToBuf(rec.body.p_key), b64uToBuf(r.payload.ct));
      if (macCalc !== r.payload.mac) return send(400, { message: 'spr_channel_enrol: proof rejected' });
      r.write_token_hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(String(rec.body.p_token)))).toString('hex');
      return send(204, {});
    }
    if (url === '/rest/v1/rpc/spr_channel_ping') {
      if (MOCK_MODE === 'before') return send(404, { message: 'function spr_channel_ping does not exist' });
      const r = MOCK_ROWS.find((x) => x.id === rec.body.p_id);
      if (!r) return send(200, JSON.stringify('no-row'));
      if (r.write_token_hash == null) return send(200, JSON.stringify('no-token'));
      const h2 = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(String(rec.body.p_token || '')))).toString('hex');
      return send(200, JSON.stringify(h2 === r.write_token_hash ? 'ok' : 'bad-token'));
    }
    if (url === '/rest/v1/spr_channels' && req.method === 'POST') {
      const b = rec.body;
      if (MOCK_MODE === 'after' && !('write_token_hash' in b)) return send(400, { message: "Could not find the write_token_hash column of spr_channels in the schema cache (PGRST204)" });
      if (MOCK_ROWS.some((x) => x.id === b.id)) return send(409, { message: 'duplicate key' });
      MOCK_ROWS.push({ id: b.id, payload: b.payload, pushed_by: b.pushed_by, pushed_at: b.pushed_at, write_token_hash: ('write_token_hash' in b) ? b.write_token_hash : null, previous: null });
      return send(201, {});
    }
    const m = req.url.match(/id=eq\.([0-9a-f-]+)/i);
    if (url === '/rest/v1/spr_channels' && req.method === 'PATCH' && m) {
      const r = MOCK_ROWS.find((x) => x.id === m[1]);
      if (!r) return send(404, { message: 'not found' });
      if (MOCK_MODE === 'after') return send(403, { message: 'permission denied' });   /* policy: no direct updates */
      Object.assign(r, rec.body);
      return send(204, {});
    }
    if (url === '/rest/v1/spr_channels' && req.method === 'GET' && m) {
      const r = MOCK_ROWS.find((x) => x.id === m[1]);
      return send(200, r ? [r] : []);
    }
    send(404, { message: 'no such route' });
  });
});
let MOCK_ROWS = [];
function boot(preExtra, urlExtra) {
  const pre = '<script>' + DLG_POLY + CHART_STUB + PERSIST_STUB + (preExtra || '') + '</scr' + 'ipt>';
  const i = html0.lastIndexOf('</body>');
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const logs = [];
  vc.on('warn', (m) => logs.push(String(m).slice(0, 200)));
  vc.on('error', (m) => logs.push('ERR ' + String(m).slice(0, 200)));
  const dom = new JSDOM(html0.slice(0, i) + pre + html0.slice(i), {
    url: 'http://localhost/app/index.html' + (urlExtra || '#/dashboard'), runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc, storageQuota: 10000000,
  });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); } catch (e) {}
  if (!w.TextEncoder) { w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; }
  if (!w.fetch) w.fetch = fetch.bind(globalThis);   /* jsdom has no fetch; the mock runs on 127.0.0.1 */
  w.__logs = logs;
  return { w, d: w.document };
}
async function waitShell(B, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    await sleep(250);
    const b = B.d.querySelector('[data-action="privacy-gate-ack"], [data-action="privacy-ack"]');
    if (b) b.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
    if (!B.d.body.classList.contains('auth-gate')) return true;
  }
  return false;
}

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, r));

  /* ================= 1. the SQL closes the hole whatever the old policy is ================= */
  console.log('1. adopted SQL (docs/supabase-write-token.sql)');
  {
    const sqlPath = path.join(__dirname, '..', 'docs', 'supabase-write-token.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    check(/DO NOT RUN YET/.test(sql), 'DO NOT RUN YET banner kept');
    check(/pg_policies/.test(sql) && /cmd in \('UPDATE', 'DELETE', 'ALL'\)/.test(sql), 'drops EVERY update/delete/ALL policy found in pg_policies (no guessed names)');
    check(!/drop policy if exists "anon can update channels"/.test(sql), 'no dependency on a guessed policy name');
    check(/revoke update, delete on public\.spr_channels from anon, authenticated/.test(sql), 'revokes UPDATE/DELETE from anon+authenticated');
    check(/create policy "spr_channels_read"/.test(sql) && /for select/.test(sql), 'recreates the plain read policy');
    check(/create policy "spr_channels_insert"/.test(sql) && /for insert/.test(sql), 'recreates the plain insert policy');
    check(/spr_channel_ping/.test(sql) && /'no-row'/.test(sql), 'ping answers no-row for an unknown channel');
    check(/CHECK \(copy the result/.test(sql) && /only SELECT and INSERT/.test(sql), 'CHECK query + expected result documented');
    check(/STEP 1[\s\S]*STEP 2[\s\S]*STEP 3/.test(sql), 'three owner steps at the top');
    /* real engine: three policy scenarios (the reviewer's harness) */
    const pgliteDir = path.join(__dirname, '..', 'node_modules', '@electric-sql', 'pglite');
    if (fs.existsSync(pgliteDir)) {
      let out = '';
      try { out = execFileSync(process.execPath, [path.join(__dirname, 'sql-policy-test.mjs'), sqlPath], { encoding: 'utf8', timeout: 300000 }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
      fs.mkdirSync(path.join(__dirname, '..', 'docs', 'qa', 'round6'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa', 'round6', 'sql-policy-test-output.txt'), out);
      const blocks = out.split('===').slice(1);
      check(blocks.length === 5, 'harness ran the 3 policy scenarios + the Save & Share shapes + the round-7 rollback proof (got ' + blocks.length + ')');
      check((out.match(/REFUSED: permission denied/g) || []).length >= 3, 'direct UPDATE by anon is REFUSED in every scenario');
      check(!/HOLE STILL OPEN/.test(out), 'row never overwritten in any scenario');
      check(/ping unknown row: OK rows=\d+ .*no-row/.test(out), 'ping returns no-row (not NULL) on the real engine');
      check((out.match(/anon DELETE: REFUSED/g) || []).length >= 1, 'anon DELETE refused (ALL-policy scenario)');
    } else {
      /* round7 item 1c: never a silent pass */
      console.log('SKIPPED: real-Postgres proof needs PGlite (npm ci --include=dev)');
      process.exit(1);
    }
  }

  /* ================= 2. Save & Share gets its own write token ================= */
  console.log('2. Save & Share write token');
  const CHAN = '7e3a1c2b-4d5e-4f6a-8b9c-0d1e2f3a4b5c';
  const KEY = b64u(webcrypto.getRandomValues(new Uint8Array(32)));
  const TOK = 'share-tok-' + Math.random().toString(36).slice(2, 10);
  const SB = { url: 'http://127.0.0.1:' + MOCK_PORT, key: 'mock-anon' };
  const shareCfg = { provider: 'sb', semId: 'sem1', shareName: 'P1A', channel: CHAN, key: KEY, writeToken: TOK };
  function shareWindow(extra, url) {
    const pre = 'try{localStorage.setItem("' + SHARE_KEY + '",' + JSON.stringify(JSON.stringify(Object.assign({}, shareCfg, extra || {}))) + ');}catch(e){}' +
                'try{localStorage.setItem("spr-sb-v1",' + JSON.stringify(JSON.stringify(SB)) + ');}catch(e){}';
    return boot(pre, url);
  }
  {
    MOCK_ROWS = []; MOCK_MODE = 'after';
    /* envelope must carry mac (the enrol proof depends on it) */
    const A = shareWindow(); await sleep(300); await waitShell(A);
    const hookA = A.w.SPR_SYNC_TEST;
    check(!!hookA && !!hookA.sealSem, 'sealSem reachable for the test');
    const sem = { id: 'sem1', name: 'P1A', className: 'Grade 1', months: ['Sep', 'Oct', 'Nov'], students: [{ id: 's1', nameEn: 'Ben' }], metrics: [], settings: {} };
    const env = await hookA.sealSem(sem, KEY, 'Mo', new Date().toISOString(), 'P1A');
    check(!!env.mac, 'share envelope carries mac (enrol proof possible)');
    const macCalc = await hmacB64u(b64uToBuf(KEY), b64uToBuf(env.ct));
    check(macCalc === env.mac, 'mac verifies against the share key (HMAC-SHA256 of ct)');
    A.w.close();

    /* owner: first save ARMS the row (insert with the token hash) */
    const A2 = shareWindow(); await sleep(300); await waitShell(A2);
    calls.length = 0;
    const OPTS = { token: TOK, keyProof: KEY };
    let out1 = null;
    try { out1 = await A2.w.SPR_SYNC_TEST.sbSave(CHAN, env, '', 'Mo', new Date().toISOString(), true, OPTS); }
    catch (e) { out1 = 'threw: ' + e.message; }
    check(out1 === 'ok', 'owner: first save succeeds (arms the row)');
    check(MOCK_ROWS.length === 1 && MOCK_ROWS[0].write_token_hash != null, 'row armed from its first insert (hash stored)');
    check(MOCK_ROWS[0].write_token_hash === Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(TOK))).toString('hex'), 'armed with sha256(share token)');
    check(!calls.some((c) => c.method === 'PATCH'), 'no direct PATCH on the armed path');

    /* co-teacher: the share link carries the token; joining stores it */
    const preSb = 'try{localStorage.setItem("spr-sb-v1",' + JSON.stringify(JSON.stringify(SB)) + ');}catch(e){}';
    const J2 = boot(preSb, '#join=' + CHAN + '&k=' + encodeURIComponent(KEY) + '&t=' + encodeURIComponent(TOK));
    await sleep(800);
    /* jsdom only: fetch is bridged after the constructor, but the app fires
       maybeJoin during boot. Real browsers have fetch from birth; re-run the
       deferred join the way the browser would have. */
    /* the app defers the join until the notice gate is agreed (the gate and
       the join confirm share one dialog); a real co-teacher reads + agrees
       first, and the join confirm appears right after */
    const cbx = J2.d.getElementById('notice-read');
    if (cbx && !cbx.checked) { cbx.checked = true; cbx.dispatchEvent(new J2.w.Event('change', { bubbles: true })); }
    const ack = J2.d.querySelector('[data-action="privacy-gate-ack"]');
    if (ack && !ack.disabled) ack.dispatchEvent(new J2.w.MouseEvent('click', { bubbles: true }));
    /* wait for the JOIN dialog specifically (the gate also renders a
       data-x=1 button; clicking that would swallow the wrong dialog) */
    const joinGo = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 20000) { const dlg = J2.d.getElementById('dlg'); if (dlg && dlg.open && /Join shared class/.test(dlg.textContent)) return dlg.querySelector('[data-x="1"]'); await sleep(200); } return null; })();
    if (joinGo) { joinGo.dispatchEvent(new J2.w.MouseEvent('click', { bubbles: true })); }
    /* condition, not a sleep: the stored share config appears after the join fetch resolves */
    const joined = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { const j = JSON.parse(J2.w.localStorage.getItem(SHARE_KEY) || '{}'); if (j.channel) return j; await sleep(200); } return JSON.parse(J2.w.localStorage.getItem(SHARE_KEY) || '{}'); })();
    if (!(joined.channel === CHAN && joined.key === KEY && joined.writeToken === TOK)) {
      const dlg = J2.d.getElementById('dlg');
      console.log('    [jdbg] joinGo was clicked:', !!joinGo, '| dlg open:', !!(dlg && dlg.open), '| dlg text:', (dlg && dlg.textContent || '').slice(0, 90));
      console.log('    [jdbg] toasts:', Array.from(J2.d.querySelectorAll('.toast, [class*=toast]')).map(function (t) { return t.textContent.slice(0, 60); }).join(' / '));
      console.log('    [jdbg] stored:', JSON.stringify(joined).slice(0, 80), '| SB cfg:', (J2.w.localStorage.getItem('spr-sb-v1') || '').slice(0, 60));
    }
    check(joined.channel === CHAN && joined.key === KEY && joined.writeToken === TOK, 'opening the share link stores channel + key + token');
    J2.w.close();

    /* both teachers push alternately through the RPC */
    const B = shareWindow(); await sleep(300); await waitShell(B);
    const whoSeq = [];
    for (const [who, win] of [['Mo', A2], ['Anna', B], ['Mo', A2], ['Anna', B]]) {
      const env2 = await win.w.SPR_SYNC_TEST.sealSem(sem, KEY, who, new Date().toISOString(), 'P1A');
      calls.length = 0;
      const out = await win.w.SPR_SYNC_TEST.sbSave(CHAN, env2, '', who, new Date().toISOString(), false, { token: TOK, keyProof: KEY });
      if (out !== 'ok') { check(false, who + ': alternating push failed (' + out + ')'); break; }
      const rpcs = calls.filter((c) => /rpc\/spr_channel_write/.test(c.url));
      check(rpcs.length === 1 && rpcs[0].body.p_token === TOK && !calls.some((c) => c.method === 'PATCH'), who + ': pushed via the RPC with the share token (no PATCH)');
      whoSeq.push(MOCK_ROWS[0].pushed_by);
    }
    check(whoSeq.join(',') === 'Mo,Anna,Mo,Anna', 'cloud copy holds the latest pusher in turn');

    /* old share row (pre-SQL, no hash): enrol from the key proof, then write.
       Its own channel id: rows created before the SQL have no hash column. */
    const OLDCHAN = '3f8e2d1c-5a6b-4c7d-9e0f-1a2b3c4d5e6f';
    MOCK_ROWS.push({ id: OLDCHAN, payload: env, pushed_by: 'Mo', pushed_at: new Date(Date.now() - 3600e3).toISOString(), write_token_hash: null, previous: null });
    const C = shareWindow(); await sleep(300); await waitShell(C);
    calls.length = 0;
    const env3 = await C.w.SPR_SYNC_TEST.sealSem(sem, KEY, 'Anna', new Date().toISOString(), 'P1A');
    const out3 = await C.w.SPR_SYNC_TEST.sbSave(OLDCHAN, env3, '', 'Anna', new Date().toISOString(), false, { token: TOK, keyProof: KEY });
    check(out3 === 'ok', 'old unprotected share row: push enrols from the key proof and succeeds');
    check(calls.some((c) => /rpc\/spr_channel_enrol/.test(c.url) && c.body.p_key === KEY && c.body.p_id === OLDCHAN), 'enrol used the share key as proof');
    check((MOCK_ROWS.find((r) => r.id === OLDCHAN) || {}).write_token_hash != null, 'old row is armed after the auto-enrol');
    A2.w.close(); B.w.close(); C.w.close();
  }

  /* ================= 3. persistent storage resolves in class mode ================= */
  console.log('3. persistent storage line (class mode)');
  {
    const A = boot(await (async () => {
      const dk = webcrypto.getRandomValues(new Uint8Array(32));
      const cls = { sprClass: 1, id: 'c-t', name: 'T', school: '', eal: '', support: '', settings: {}, months: [], students: [{ id: 's1', nameEn: 'Ben' }] };
      const k = await webcrypto.subtle.importKey('raw', dk, 'PBKDF2', false, ['deriveKey']);
      return 'try{sessionStorage.setItem("spr-session",' + JSON.stringify(JSON.stringify({ user: 'Mo', dk: b64u(dk) })) + ');}catch(e){}' +
             'try{localStorage.setItem("spr-auth-v1",' + JSON.stringify(JSON.stringify({ users: [{ username: 'Mo', name: 'Mo', role: 'admin', keyring: {} }], session: { username: 'Mo', name: 'Mo', role: 'admin' } })) + ');}catch(e){}' +
             'try{localStorage.setItem("spr-class-index-v1",' + JSON.stringify(JSON.stringify([{ id: 'c-t', name: 'T', school: '', eal: '', support: '' }])) + ');}catch(e){}' +
             'try{localStorage.setItem("spr-mode-v1","class");}catch(e){}';
    })());
    await sleep(300); await waitShell(A); await sleep(600);
    A.w.location.hash = '#/manage'; await sleep(500);
    const t0 = Date.now();
    let finalTxt = '';
    while (Date.now() - t0 < 3500) { await sleep(200); const m = (A.d.body.textContent || '').match(/Persistent storage:<\/b>\s*([^<.]+)/); if (m && !/checking/.test(m[1])) { finalTxt = m[1].trim(); break; } }
    check(/granted|not granted/.test(finalTxt), 'class mode: line resolves within 3 s (got: ' + (finalTxt || 'still checking') + ')');
    check((A.w.__PERSIST_CALLS || 0) >= 1, 'persist() requested in class mode too');
    A.w.close();
  }

  mock.close();
  console.log('\nROUND6: ' + PASS + ' ok, ' + FAIL + ' FAIL');
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e.stack || e.message); process.exit(2); });
