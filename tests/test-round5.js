/* round-5 regression suite (2026-10-29, reviewer items 1-4).
   Written FAILING FIRST against main 199de24.
   Item 1 runs the app's REAL sync code (dsPushNow) against a local mock of
   PostgREST that models the world BEFORE and AFTER the write-token SQL. */
const fs = require('fs'); const path = require('path'); const webcrypto = require('crypto').webcrypto;
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');
const html0 = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V2_KEY = 'p4c4-markbook-v2', AUTH_KEY = 'spr-auth-v1', DS_KEY = 'spr-devicesync-v1';
const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';

let PASS = 0, FAIL = 0;
function check(cond, label) { if (cond) { PASS++; console.log('  ok: ' + label); } else { FAIL++; console.log('  FAIL: ' + label); } }

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256hex(s) { const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join(''); }
async function sealDbNode(dbObj, dk) {
  const k = await webcrypto.subtle.importKey('raw', dk, 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(dbObj))));
  return { iv: b64u(iv), ct: b64u(ct) };
}

/* ---------------- mock PostgREST: models before/after the SQL ---------------- */
const MOCK_PORT = 8941;
let MOCK_MODE = 'before';               /* 'before' = no SQL run; 'after' = SQL run */
const row = { exists: false, id: null, payload: null, pushed_by: null, pushed_at: null, share_name: null, write_token_hash: null, previous: null };
const calls = [];
function b64uToBuf(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }
function bufToB64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function hmacSha256B64(keyBuf, msgBuf) {
  return webcrypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']).then((k) => webcrypto.subtle.sign('HMAC', k, msgBuf)).then((sig) => bufToB64u(new Uint8Array(sig)));
}
const server = http.createServer(async (req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const u = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: u.pathname, body: body ? JSON.parse(body) : null });
    const j = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (u.pathname === '/rest/v1/spr_channels' && req.method === 'POST') {
      const b = JSON.parse(body);
      if (MOCK_MODE === 'before' && 'write_token_hash' in b) return j(400, { message: "Could not find the write_token_hash column of spr_channels in the schema cache (PGRST204)" });
      if (row.exists) return j(409, { message: 'duplicate key' });
      Object.assign(row, b, { exists: true });
      return j(201, {});
    }
    if (u.pathname === '/rest/v1/spr_channels' && req.method === 'GET') {
      return j(200, row.exists ? [row] : []);
    }
    if (u.pathname === '/rest/v1/spr_channels' && req.method === 'PATCH') {
      if (MOCK_MODE === 'after') return j(403, { message: 'new row-level security policy defined by the write-token SQL' });
      const b = JSON.parse(body); delete b.write_token_hash;
      Object.assign(row, b); row.exists = true;
      return j(204, {});
    }
    if (u.pathname === '/rest/v1/rpc/spr_channel_write' && req.method === 'POST') {
      if (MOCK_MODE !== 'after') return j(404, { message: 'function spr_channel_write does not exist' });
      const b = JSON.parse(body);
      if (!row.exists) return j(400, { message: 'spr_channel_write: channel not found' });
      if (row.write_token_hash === null) return j(400, { message: 'spr_channel_write: channel has no token enrolled yet' });
      if ((await sha256hex(String(b.p_token))) !== row.write_token_hash) return j(400, { message: 'spr_channel_write: write token rejected' });
      row.previous = row.payload;
      row.payload = b.p_payload; row.pushed_by = b.p_pushed_by; row.pushed_at = b.p_pushed_at; row.share_name = b.p_share_name;
      return j(204, {});
    }
    if (u.pathname === '/rest/v1/rpc/spr_channel_enrol' && req.method === 'POST') {
      if (MOCK_MODE !== 'after') return j(404, { message: 'function spr_channel_enrol does not exist' });
      const b = JSON.parse(body);
      if (!row.exists) return j(400, { message: 'spr_channel_enrol: channel not found' });
      if (row.write_token_hash !== null) return j(400, { message: 'spr_channel_enrol: channel already enrolled' });
      /* proof: the caller must know the sync key — verify by recomputing the
         payload's HMAC exactly the way paired devices do */
      const p = row.payload || {};
      if (!p.ct || !p.mac) return j(400, { message: 'spr_channel_enrol: row has no sealed payload to verify against' });
      const expect = await hmacSha256B64(b64uToBuf(b.p_key), b64uToBuf(p.ct));
      if (expect !== p.mac) return j(403, { message: 'spr_channel_enrol: proof rejected' });
      row.write_token_hash = await sha256hex(String(b.p_token));
      return j(204, {});
    }
    if (u.pathname === '/rest/v1/rpc/spr_channel_ping' && req.method === 'POST') {
      if (MOCK_MODE !== 'after') return j(404, { message: 'function spr_channel_ping does not exist' });
      const b = JSON.parse(body);
      if (!row.exists) return j(200, JSON.stringify('no-row'));
      if (row.write_token_hash === null) return j(200, JSON.stringify('no-token'));
      return j(200, JSON.stringify((await sha256hex(String(b.p_token))) === row.write_token_hash ? 'ok' : 'bad-token'));
    }
    j(404, { message: 'not found: ' + u.pathname });
  });
});

const PERSIST_STUB = 'try{Object.defineProperty(navigator,"storage",{value:{persist:async()=>true,estimate:async()=>({usage:1,quota:2})},configurable:true});}catch(e){}';
function boot(preExtra) {
  const pre = '<script>' + DLG_POLY + CHART_STUB + PERSIST_STUB + (preExtra || '') + '</scr' + 'ipt>';
  const i = html0.lastIndexOf('</body>');
  const logs = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  vc.on('warn', (m) => logs.push(String(m).slice(0, 220)));
  vc.on('error', (m) => logs.push('ERR ' + String(m).slice(0, 220)));
  const dom = new JSDOM(html0.slice(0, i) + pre + html0.slice(i), {
    url: 'http://localhost/app/index.html#/dashboard', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc, storageQuota: 10000000,
  });
  const w = dom.window;
  w.__logs = logs;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); } catch (e) {}
  if (!w.TextEncoder) { w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; }
  w.fetch = (u, o) => fetch(String(u).replace('http://localhost', 'http://127.0.0.1:' + MOCK_PORT), o);   /* real HTTP to the mock */
  return { w, d: w.document };
}
async function waitShell(B, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    await sleep(250);
    const b = B.d.querySelector('[data-action="privacy-gate-ack"], [data-action="privacy-ack"]');
    if (b) { const c = B.d.getElementById('notice-read'); if (c && !c.checked) { c.checked = true; c.dispatchEvent(new B.w.Event('change', { bubbles: true })); } b.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }
    if (!B.d.body.classList.contains('auth-gate')) return true;
  }
  return false;
}
function dlgTxt(B) { const d = B.d.getElementById('dlg'); return d ? d.textContent : ''; }
function txt(B) { const c = B.d.body.cloneNode(true); c.querySelectorAll('script,style').forEach((n) => n.remove()); return c.textContent || ''; }
function click(B, el) { el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }

let SEED_JSON = null;
function seedDb() { const s = JSON.parse(SEED_JSON); return { semesters: s.semesters, settings: {} }; }
async function preSeed(opts) {
  const o = opts || {};
  const dk = webcrypto.getRandomValues(new Uint8Array(32));
  const data = await sealDbNode(seedDb(), dk);
  const v2 = JSON.stringify({ fmt: 2, wraps: {}, data, ts: Date.now() });
  const auth = JSON.stringify({ users: [{ username: 'Mo', name: 'Mo', role: 'admin', keyring: {} }], session: { username: 'Mo', name: 'Mo', role: 'admin' } });
  const sess = JSON.stringify({ user: 'Mo', dk: b64u(dk) });
  let pre = 'try{localStorage.setItem("' + V2_KEY + '",' + JSON.stringify(v2) + ');}catch(e){}' +
            'try{localStorage.setItem("' + AUTH_KEY + '",' + JSON.stringify(auth) + ');}catch(e){}' +
            'try{sessionStorage.setItem("spr-session",' + JSON.stringify(sess) + ');}catch(e){}' +
            'try{localStorage.setItem("spr-privacy-ack-v1","1");}catch(e){}';
  if (o.dsCfg) pre += 'try{localStorage.setItem("' + DS_KEY + '",' + JSON.stringify(JSON.stringify(o.dsCfg)) + ');}catch(e){}';
  if (o.sb) pre += 'try{localStorage.setItem("spr-sb-v1",' + JSON.stringify(JSON.stringify(o.sb)) + ');}catch(e){}';
  return pre;
}
async function pushRetry(B, tries) {
  let r = null;
  for (let t = 0; t < (tries || 8); t++) {
    r = await B.w.SPR_SYNC_TEST.push(true);
    if (r === true) return true;
    await sleep(450);
  }
  return r;
}
/* same deterministic uuid the app derives: dsCfg() demands a channel */
async function chanId(username) {
  const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('spr-ds1:chan:' + String(username).trim().toLowerCase()));
  const hex = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  const variant = ((parseInt(hex.slice(16, 20), 16) & 0x3fff) | 0x8000).toString(16).padStart(4, '0');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-' + variant + '-' + hex.slice(20, 32);
}
const TOKEN = 'tok-abcdef-0123456789';
const SYNC_KEY = b64u(webcrypto.getRandomValues(new Uint8Array(32)));

(async () => {
  await new Promise((r) => server.listen(MOCK_PORT, '127.0.0.1', r));
  const P0 = boot(); await sleep(900); SEED_JSON = JSON.stringify(P0.w.SEED); P0.w.close();
  if (!SEED_JSON || SEED_JSON === 'null') { console.error('no SEED in bundle'); process.exit(2); }

  /* ============ 1. write-token RPC end to end (mock PostgREST) ============ */
  console.log('1. write-token protection: real sync code vs mock PostgREST');
  {
    /* BEFORE the SQL: direct PATCH works, header ignored (today's world) */
    MOCK_MODE = 'before';
    const cfg0 = { on: true, adoptedAcct: true, owner: 'Mo', channel: await chanId('Mo'), key: SYNC_KEY, device: 'test', writeToken: TOKEN };
    const A = boot(await preSeed({ dsCfg: cfg0, sb: { url: 'http://127.0.0.1:' + MOCK_PORT, key: 'mock-anon' } }));
    await sleep(300);
    check(await waitShell(A), 'before-SQL: admin signed in');
    await sleep(1200);   /* let the boot pull-check release its push hold */
    calls.length = 0;
    const pushed = A.w.SPR_SYNC_TEST ? await pushRetry(A) : null;
    if (pushed !== true) console.log('    [dbg] A:', JSON.stringify({ logs: A.w.__logs, canPush: A.w.SPR_SYNC_TEST.canPush(), hold: A.w.SPR_SYNC_TEST.hold(), cfg: A.w.SPR_SYNC_TEST.cfg() }));
    check(pushed === true, 'before-SQL: push succeeds (direct PATCH, header ignored)');
    check(row.exists && row.payload && row.payload.sprDS === 1, 'before-SQL: cloud row holds the sealed copy');
    check(row.write_token_hash === null, 'before-SQL: row is NOT armed (owner has not run the SQL)');
    A.w.close();

    /* AFTER the SQL: same client, same token; row left UNenrolled (existing row) */
    MOCK_MODE = 'after';
    row.write_token_hash = null;
    calls.length = 0;
    const B = boot(await preSeed({ dsCfg: JSON.parse(JSON.stringify(cfg0)), sb: { url: 'http://127.0.0.1:' + MOCK_PORT, key: 'mock-anon' } }));
    await sleep(300);
    check(await waitShell(B), 'after-SQL: admin signed in');
    /* change the data so this is a REAL push, not the 'already up to date' short-circuit */
    const dbB = B.w.SPR_DEBUG_GET_DB();
    dbB.semesters[dbB.semesters.length - 1].students[0].nameEn = 'Mutated-After-SQL';
    B.w.SPR_DEBUG_SET_DB(dbB); await sleep(400);
    const pushed2 = B.w.SPR_SYNC_TEST ? await pushRetry(B) : null;
    check(pushed2 === true, 'after-SQL: push succeeds via the RPC (auto-enrol on first refusal)');
    check(calls.some((c) => c.path === '/rest/v1/rpc/spr_channel_enrol'), 'after-SQL: client enrolled with the key proof (no manual SQL)');
    check(calls.some((c) => c.path === '/rest/v1/rpc/spr_channel_write' && c.body && typeof c.body.p_token === 'string'), 'after-SQL: token travels in the RPC body, not a header');
    check(row.write_token_hash === (await sha256hex(TOKEN)), 'after-SQL: row armed with sha256(token)');
    check(row.previous && row.payload.sprDS === 1, 'after-SQL: previous payload kept for rollback');
    B.w.close();

    /* AFTER + WRONG token: refused, plain message, cloud never marked saved */
    calls.length = 0;
    const badCfg = JSON.parse(JSON.stringify(cfg0)); badCfg.writeToken = 'wrong-token-000';
    const C = boot(await preSeed({ dsCfg: badCfg, sb: { url: 'http://127.0.0.1:' + MOCK_PORT, key: 'mock-anon' } }));
    await sleep(300); await waitShell(C);
    const before = JSON.stringify(row.payload);
    const pushed3 = C.w.SPR_SYNC_TEST ? await pushRetry(C) : null;
    check(pushed3 === false, 'after-SQL: push with a wrong token is refused');
    check(JSON.stringify(row.payload) === before, 'after-SQL: the cloud copy was NOT touched');
    const cfgNow = JSON.parse(C.w.localStorage.getItem(DS_KEY));
    check(cfgNow.lastResult === 'fail', 'after-SQL: cloud copy is not marked saved (lastResult=fail)');
    check((cfgNow.lastError || '').includes('device is safe') || /device is safe/.test(C.d.body.textContent), 'after-SQL: plain message says device data is safe');
    C.w.close();

    /* fresh channel: the FIRST insert already carries the hash (armed) */
    const D = boot(await preSeed({ dsCfg: (() => { const c = JSON.parse(JSON.stringify(cfg0)); c.adoptedAcct = false; delete c.owner; return c; })(), sb: { url: 'http://127.0.0.1:' + MOCK_PORT, key: 'mock-anon' } }));
    await sleep(300); await waitShell(D);
    row.exists = false; row.write_token_hash = null; row.payload = null;
    const pushed4 = D.w.SPR_SYNC_TEST ? await pushRetry(D) : null;
    check(pushed4 === true, 'fresh channel: first push succeeded');
    check(row.exists && row.write_token_hash === (await sha256hex(TOKEN)), 'fresh channel: armed from its very first write (insert carried the hash)');
    D.w.close();

    /* Test cloud connection button */
    const E = boot(await preSeed({ dsCfg: JSON.parse(JSON.stringify(cfg0)), sb: { url: 'http://127.0.0.1:' + MOCK_PORT, key: 'mock-anon' } }));
    await sleep(300); await waitShell(E);
    E.w.location.hash = '#/manage'; await sleep(700);
    const tbtn = E.d.querySelector('[data-action="ds-test"]');
    check(!!tbtn, 'Manage has a "Test cloud connection" button');
    if (tbtn) {
      click(E, tbtn); await sleep(1200);
      check(/Cloud connection/.test(txt(E) + dlgTxt(E)), 'button reports the connection in plain words');
    }
    E.w.close();

    const sql = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase-write-token.sql'), 'utf8');
    check(/DO NOT RUN YET/i.test(sql), 'SQL file warns DO NOT RUN YET until verified');
    check(/spr_channel_enrol/.test(sql), 'SQL defines the enrol RPC (no manual token paste)');
    check(/spr_channel_ping/.test(sql), 'SQL defines the read-only ping RPC');
    check(!/paste token/i.test(sql), 'no "paste token into SQL" instruction remains');
  }

  /* ============ 2. first class creation switches to class mode ============ */
  console.log('2. first class creation lands in class mode');
  {
    /* fresh browser: first-run admin, EMPTY legacy DB, then create a class
       through the Manage wizard; the browser must end in class mode with the
       class keyed per-user, and a new teacher sign-in sees only that class */
    const A = boot(); await sleep(700);
    await waitShell(A);
    const su = A.d.querySelector('[data-action="show-setup"]');
    if (su) { click(A, su); await sleep(300); }
    const set = (id, v) => { const e = A.d.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new A.w.Event('input', { bubbles: true })); } };
    set('suUser', 'Mo'); set('suPass', 'Str0ngPass!73'); set('suConf', 'Str0ngPass!73');
    click(A, A.d.querySelector('[data-action="first-run"]'));
    for (let t = 0; t < 40; t++) { await sleep(250); const dl = A.d.getElementById('dlg'); if (dl && dl.open && dl.querySelector('[data-action="recovery-ack"]')) break; }
    const dl = A.d.getElementById('dlg');
    if (dl && dl.querySelector('[data-action="recovery-master"]')) {
      set('mrPw', 'Master-K3y!9x'); click(A, dl.querySelector('[data-action="recovery-master"]'));
      /* the master wrap is real PBKDF2: wait until the dialog ENABLES Continue */
      for (let t = 0; t < 60; t++) { await sleep(250); const b = A.d.querySelector('#dlg [data-action="recovery-ack"]'); if (b && b.disabled === false) break; }
    }
    const ack2 = A.d.querySelector('[data-action="recovery-ack"]');
    if (ack2 && ack2.disabled) { console.log('    [dbg] ack still disabled:', dlgTxt(A).slice(0, 160)); }
    click(A, ack2);
    const inned = await (async () => { for (let t = 0; t < 30; t++) { await sleep(250); if (!A.d.body.classList.contains('auth-gate')) return true; } return false; })();
    check(inned, 'fresh admin signed in (empty vault, legacy mode at this point)');
    A.w.location.hash = '#/manage'; await sleep(700);
    const wiz = A.d.querySelector('[data-action="wiz-open"]');
    check(!!wiz, 'first-run Manage offers the New class wizard');
    click(A, wiz); await sleep(400);
    set('wiz-class', 'P1A'); set('wiz-school', 'Demo School');
    click(A, A.d.querySelector('[data-action="wiz-create"]'));
    const modeIn = await (async () => { for (let t = 0; t < 60; t++) { await sleep(250); if (A.w.localStorage.getItem('spr-mode-v1') === 'class') return true; } return false; })();
    check(modeIn, 'browser is now in CLASS mode after the first class');
    const ixIn = await (async () => { for (let t = 0; t < 40; t++) { await sleep(250); const v = JSON.parse(A.w.localStorage.getItem('spr-class-index-v1') || '[]'); if (v.length === 1) return true; } return false; })();
    check(ixIn, 'class index holds exactly the new class');
    /* key gen + wraps + first blob seal are real PBKDF2: wait for the wrap */
    const krIn = await (async () => { for (let t = 0; t < 80; t++) { await sleep(250); const u = (JSON.parse(A.w.localStorage.getItem(AUTH_KEY) || '{}').users || [])[0]; if (u && Object.keys(u.keyring || {}).length >= 1) return true; } return false; })();
    check(krIn, 'admin holds the class key in their keyring (per-class access)');
    /* add a teacher (class-mode admin: the sign-ins live on the Users tab),
       then sign in as the teacher in a fresh window and check scope */
    A.w.location.hash = '#/users'; await sleep(700);
    const addBtn = A.d.querySelector('[data-action="acct-add-open"]');
    check(!!addBtn, 'Users tab offers Add account in class mode');
    if (addBtn) {
      click(A, addBtn); await sleep(400);
      if (!A.d.getElementById('naUser')) console.log('    [dbg] add dialog did not open. dlg:', dlgTxt(A).slice(0, 120), '| auth session:', String(A.w.localStorage.getItem(AUTH_KEY)).slice(-90));
      set('naUser', 'anna'); set('naName', 'Anna'); set('naPass', 'anna-pass-12'); set('naConf', 'anna-pass-12');
      click(A, A.d.querySelector('[data-action="acct-add"]'));
      let annaStored = false;
      for (let t = 0; t < 40; t++) { await sleep(250); if ((A.w.localStorage.getItem(AUTH_KEY) || '').includes('anna')) { annaStored = true; break; } }
      await sleep(2500);   /* let the add flow finish its writes before snapshotting */
      check(annaStored, 'teacher account stored');
    }
    /* pair anna to the class: the designed key-share path (wraps the class
       key under a generated one-time password) */
    A.w.location.hash = '#/manage'; await sleep(700);
    const pb = A.d.querySelector('[data-action="class-pair"]');
    check(!!pb, 'class-mode Manage offers Pair teachers');
    let annaPw = 'anna-pass-12';
    if (pb) {
      click(A, pb); await sleep(400);
      const selT = A.d.querySelector('#pair-eal');   /* classRole('teacher') maps to the EAL slot */
      if (!selT) { console.log('    [dbg] no #pair-eal. dlg:', dlgTxt(A).slice(0, 100)); }
      else {
        selT.value = 'anna';
        click(A, A.d.querySelector('#dlg [data-x="1"]'));
        let pwEl = null;
        for (let t = 0; t < 120; t++) { await sleep(250); const dl = A.d.getElementById('dlg'); pwEl = dl && dl.open && dl.querySelector('code') ? dl.querySelector('code') : null; if (pwEl) break; }
        if (pwEl) { annaPw = pwEl.textContent.trim(); check(/^[a-z0-9]{5}(-[a-z0-9]{5}){3}$/.test(annaPw), 'pairing issued a one-time password'); }
        else console.log('    [dbg] no one-time password shown. dlg:', dlgTxt(A).slice(0, 120));
        const done = A.d.querySelector('#dlg [data-x="1"]');
        if (done) { click(A, done); await sleep(400); }
        /* the pair re-wraps the class key under the one-time password (PBKDF2):
           carry only after anna's keyring actually holds it */
        for (let t = 0; t < 80; t++) {
          await sleep(250);
          try {
            const au = JSON.parse(A.w.localStorage.getItem(AUTH_KEY) || '{}');
            const an = (au.users || []).find((u) => u.username === 'anna');
            if (an && Object.keys(an.keyring || {}).length >= 1) break;
          } catch (e) {}
        }
      }
    }
    const cid = (JSON.parse(A.w.localStorage.getItem('spr-class-index-v1') || '[]')[0] || {}).id;
    /* the class blob is sealed asynchronously (real PBKDF2) AFTER the index
       lands: carry only when the blob actually exists, or T boots unopenable */
    for (let t = 0; t < 80; t++) { await sleep(250); if (A.w.localStorage.getItem('spr-class-' + cid)) break; }
    const carried = JSON.parse(A.w.localStorage.getItem(AUTH_KEY)); delete carried.session;
    const T = boot('try{localStorage.setItem("' + AUTH_KEY + '",' + JSON.stringify(JSON.stringify(carried)) + ');}catch(e){}' +
                   'try{localStorage.setItem("spr-mode-v1","class");}catch(e){}' +
                   'try{localStorage.setItem("spr-class-index-v1",' + JSON.stringify(A.w.localStorage.getItem('spr-class-index-v1') || '[]') + ');}catch(e){}' +
                   'try{localStorage.setItem("spr-class-blob-' + cid + '",' + JSON.stringify(A.w.localStorage.getItem('spr-class-' + cid) || '') + ');}catch(e){}' +
                   'try{localStorage.setItem("spr-privacy-ack-v1","1");}catch(e){}');
    await sleep(500); await waitShell(T);
    const setT = (id, v) => { const e = T.d.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new T.w.Event('input', { bubbles: true })); } };
    setT('loginUser', 'anna'); setT('loginPass', annaPw);
    click(T, T.d.querySelector('[data-action="do-login"]'));
    const tIn = await (async () => { for (let t = 0; t < 40; t++) { await sleep(250); if (!T.d.body.classList.contains('auth-gate')) return true; } return false; })();
    check(tIn, 'teacher signed in');
    if (!tIn) {
      const tAuth = String(T.w.localStorage.getItem(AUTH_KEY));
      try { console.log('    [dbg] T users:', JSON.parse(tAuth).users.map((u) => u.username).join(','), '| blob?', !!T.w.localStorage.getItem('spr-class-' + cid), '| ix:', String(T.w.localStorage.getItem('spr-class-index-v1')).slice(0, 60)); } catch (e5) {}
    }
    const tKeyring = await (async () => {
      for (let t = 0; t < 40; t++) {
        await sleep(250);
        try {
          const an = (JSON.parse(T.w.localStorage.getItem(AUTH_KEY) || '{}').users || []).find((u) => u.username === 'anna');
          if (an && Object.keys(an.keyring || {}).length >= 1) return an.keyring;
        } catch (e) {}
      }
      return {};
    })();
    check(Object.keys(tKeyring).length === 1, 'teacher holds a key for exactly ONE class (their own)');
  }

  /* ============ 3. recovery step: honest, download-gated ============ */
  console.log('3. recovery dialog: honest text + Continue gated on a real download');
  {
    const A = boot(); await sleep(700); await waitShell(A);
    const su = A.d.querySelector('[data-action="show-setup"]');
    if (su) { click(A, su); await sleep(300); }
    const set = (id, v) => { const e = A.d.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new A.w.Event('input', { bubbles: true })); } };
    set('suUser', 'Mo'); set('suPass', 'Str0ngPass!73'); set('suConf', 'Str0ngPass!73');
    click(A, A.d.querySelector('[data-action="first-run"]'));
    for (let t = 0; t < 40; t++) { await sleep(250); const dl = A.d.getElementById('dlg'); if (dl && dl.open && dl.querySelector('[data-action="recovery-ack"]')) break; }
    const dl = A.d.getElementById('dlg');
    check(/master password/i.test(dlgTxt(A)), 'recovery dialog offers the master password');
    check(/recover|restores/i.test(dlgTxt(A)) && /empty|right now|as of/i.test(dlgTxt(A)), 'text says what the file can and cannot recover');
    const ackBtn = dl.querySelector('[data-action="recovery-ack"]');
    check(ackBtn.disabled === true, 'Continue starts DISABLED (no self-ticked "I saved")');
    check(!dl.querySelector('#recoverySaved'), 'the self-tick checkbox is gone');
    click(A, dl.querySelector('[data-action="recovery-dl"]')); await sleep(400);
    check(ackBtn.disabled === false, 'Continue enables only after the download button actually fired');
    click(A, ackBtn);
    const inned = await (async () => { for (let t = 0; t < 30; t++) { await sleep(250); if (!A.d.body.classList.contains('auth-gate')) return true; } return false; })();
    check(inned, 'setup completes after the download-gated route');
    A.w.close();
  }

  /* ============ 4. leftovers: em dashes + persistent storage ============ */
  console.log('4. leftovers');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'source', 'app.js'), 'utf8');
    const strOnly = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
    const built = html0;   /* the built bundle shipped in app/ */
    const inStrings = strOnly.match(/'[^'\n]*—[^'\n]*'/g) || [];
    /* prose rule: no em dashes in sentences. Kept by design: the owner's attribution line, the bare empty-cell glyphs (>—<) and select placeholders. */
    const prose = inStrings.filter((x) => x.length > 4 && !/later/.test(x) && !/Designed for teachers/.test(x) && !/>—</.test(x));
    check(prose.length === 0, '0 em dashes left in UI prose (attribution, placeholders and the empty-cell glyph excepted)');
    check(/not granted: the browser did not promise|not granted: download backups regularly/.test(built), 'Manage persistent-storage "not granted" wording present in the bundle');
    const cfgp = { on: false };
    const A = boot(await preSeed({ dsCfg: cfgp })); await sleep(300); await waitShell(A);
    A.w.location.hash = '#/manage'; await sleep(3500);
    check(!/checking… download backups regularly/.test(txt(A)), 'persistent storage never sticks on "checking…"');
    check(/granted/.test(txt(A)), 'persistent storage shows its final state (granted / not granted)');
    A.w.close();
  }

  console.log('\nROUND5: ' + PASS + ' ok, ' + FAIL + ' FAIL');
  server.close();
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e.stack || e.message); process.exit(2); });
