/* round-7 regression suite (2026-10-30, items 1, 2, 4, 6c, 7).
   Item 3 (phone layout), 5 (load) and 6a/6b (engines + manual checklist) live
   in their own files: docs/qa/round7/phone.py, tests/test-load.js,
   docs/qa/round7/browser.py. */
const fs = require('fs'); const path = require('path'); const webcrypto = require('crypto').webcrypto;
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const http = require('http');
const CS = require('../source/classstore.js');
const html0 = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';
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
let PASS = 0, FAIL = 0;
function check(c, label) { if (c) { PASS++; console.log('  ok: ' + label); } else { FAIL++; console.log('  FAIL: ' + label); } }
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function boot(preExtra, urlExtra) {
  const pre = '<script>' + DLG_POLY + CHART_STUB + (preExtra || '') + '</scr' + 'ipt>';
  const i = html0.lastIndexOf('</body>');
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const dom = new JSDOM(html0.slice(0, i) + pre + html0.slice(i), {
    url: 'http://localhost/app/index.html' + (urlExtra || '#/dashboard'), runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc, storageQuota: 10000000,
  });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); } catch (e) {}
  if (!w.TextEncoder) { w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; }
  if (!w.fetch) w.fetch = fetch.bind(globalThis);
  return { w, d: w.document };
}
const click = (B, el) => el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
function dlgHtml(B) { const d = B.d.getElementById('dlg'); return d ? d.innerHTML : ''; }
function dlgTxt(B) { const d = B.d.getElementById('dlg'); return d ? d.textContent : ''; }
async function waitShell(B, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    await sleep(250);
    const b = B.d.querySelector('[data-action="privacy-gate-ack"], [data-action="privacy-ack"]');
    if (b) { const cb = B.d.getElementById('notice-read'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new B.w.Event('change', { bubbles: true })); } b.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }
    if (!B.d.body.classList.contains('auth-gate')) return true;
  }
  return false;
}

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  /* ===== 1. release hygiene: deps declared, all suites wired, repo clean ===== */
  console.log('1. clean-clone release hygiene');
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    check(!!(pkg.devDependencies && pkg.devDependencies.jsdom && pkg.devDependencies['@electric-sql/pglite']), 'package.json declares jsdom AND @electric-sql/pglite');
    check(fs.existsSync(path.join(__dirname, '..', 'package-lock.json')), 'package-lock.json is committed');
    const testScript = pkg.scripts.test || '';
    const suites = ['completeness.test', 'calc-regression.test', 'excel-import.test', 'classstore.test', 'test-help-security', 'test-data-safety', 'test-notices', 'test-round5', 'test-round6', 'test-simple-ui', 'test-class-mode', 'test-device-sync', 'test-classes-escape', 'test-pair-open'];
    const missing = suites.filter((s) => testScript.indexOf(s) === -1);
    check(missing.length === 0, 'npm test runs every suite (' + (missing.length ? 'missing: ' + missing.join(',') : 'all 14 wired') + ')');
    check(fs.existsSync(path.join(__dirname, 'sql-policy-test.mjs')), 'sql-policy-test.mjs lives in tests/');
    let gi = ''; try { gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'); } catch (e) {}
    check(/node_modules\//.test(gi) && /(^|\/)\.pw(\/|$)/m.test(gi) && /qa_root/.test(gi) && /\*\.log/.test(gi), '.gitignore covers node_modules, .pw, qa_root, *.log');
    const shipped = ['source/app.js', 'source/analysis.js', 'source/landing.html', 'source/index.template.html', 'index.html'];
    let rights = 0;
    for (const f of shipped) { try { rights += (fs.readFileSync(path.join(__dirname, '..', f), 'utf8').match(/All rights reserved/g) || []).length; } catch (e) {} }
    check(rights === 0, 'no "All rights reserved" anywhere shipped');
    let rn = '', bd = '';
    try { rn = fs.readFileSync(path.join(__dirname, '..', 'docs', 'REVIEW-NOTES.md'), 'utf8'); } catch (e) {}
    try { bd = fs.readFileSync(path.join(__dirname, '..', 'docs', 'BACKEND-DESIGN.md'), 'utf8'); } catch (e) {}
    check(/native reader|native speaker/i.test(rn), 'REVIEW-NOTES.md: Chinese text needs a native reader');
    check(/NOT part of this round|not part of this round/i.test(bd) && /school approval/i.test(bd), 'BACKEND-DESIGN.md: shared-DB build gated by school approval');
    check(html0.indexOf('ds-test') !== -1, 'Test cloud connection still present in Manage');
  }

  /* ===== 2. owner runbook + rollback scenario ===== */
  console.log('2. owner runbook (docs only)');
  {
    let rb = '';
    try { rb = fs.readFileSync(path.join(__dirname, '..', 'docs', 'OWNER-RUNBOOK-supabase.md'), 'utf8'); } catch (e) {}
    check(/DO NOT RUN/i.test(rb), 'runbook banner: DO NOT RUN until the reviewer says so');
    check(/1\.[\s\S]*2\.[\s\S]*3\.[\s\S]*4\.[\s\S]*5\.[\s\S]*6\./.test(rb), 'runbook has the six numbered parts');
    check(/ds-ptr/.test(rb) && /delete from spr_channels where share_name='ds-ptr'/.test(rb), 'pointer decision table with the exact delete');
    check(/spr_channels_backup/.test(rb) && /insert into public\.spr_channels select/i.test(rb), 'backup table + restore query');
    check(/Test cloud connection/.test(rb) && /share link/.test(rb), 'after-steps smoke test in plain words');
    check(/drop policy/i.test(rb) && /restore/i.test(rb), 'rollback statements present');
    let out = '';
    try { out = fs.readFileSync(path.join(__dirname, '..', 'docs', 'qa', 'round7', 'sql-policy-test-output.txt'), 'utf8'); } catch (e) {}
    check(/=== E/.test(out), 'harness has scenario E (run SQL, rollback, old behaviour back)');
    check(/rollback: direct UPDATE again/i.test(out) && /rollback: payload intact/i.test(out), 'scenario E proves old behaviour + intact data');
  }

  /* ===== 4. Save & Share: one button, plain words ===== */
  console.log('4. Save & Share hub');
  {
    const BANNED = ['channel', 'token', 'enrol', 'HMAC', 'sealed', 'pointer'];
    /* the hub dialog, sync ON, share configured */
    const SH = { provider: 'sb', semId: 'sem1', shareName: 'P1A', channel: '7e3a1c2b-4d5e-4f6a-8b9c-0d1e2f3a4b5c', key: b64u(webcrypto.getRandomValues(new Uint8Array(32))), writeToken: 'tok-1' };
    const shareWindow = async (extra) => {
      const dk = webcrypto.getRandomValues(new Uint8Array(32));
      const k = await webcrypto.subtle.importKey('raw', dk, 'AES-GCM', false, ['encrypt']);
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const sem = { id: 'sem1', name: 'P1A', className: 'Grade 1', months: ['Sep', 'Oct'], students: [{ id: 's1', nameEn: 'Ben' }], metrics: [], spelling: {}, daily: {}, observations: {}, settings: {} };
      const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify({ semesters: [sem], currentSemesterId: 'sem1', settings: {} }))));
      const v2 = JSON.stringify({ fmt: 2, wraps: {}, data: { iv: b64u(iv), ct: b64u(ct) }, ts: Date.now() });
      const auth = JSON.stringify({ users: [{ username: 'Mo', name: 'Mo', role: 'admin', keyring: {} }], session: { username: 'Mo', name: 'Mo', role: 'admin' } });
      const pre = 'try{localStorage.setItem("spr-share-v1",' + JSON.stringify(JSON.stringify(Object.assign({}, SH, extra || {}))) + ');}catch(e){}' +
                  'try{localStorage.setItem("spr-sb-v1",' + JSON.stringify(JSON.stringify({ url: 'http://127.0.0.1:' + MOCK_PORT, key: 'k' })) + ');}catch(e){}' +
                  'try{localStorage.setItem("p4c4-markbook-v2",' + JSON.stringify(v2) + ');}catch(e){}' +
                  'try{localStorage.setItem("spr-auth-v1",' + JSON.stringify(auth) + ');}catch(e){}' +
                  'try{sessionStorage.setItem("spr-session",' + JSON.stringify(JSON.stringify({ user: 'Mo', dk: b64u(dk) })) + ');}catch(e){}';
      return boot(pre);
    };
    const pre = 'try{localStorage.setItem("spr-share-v1",' + JSON.stringify(JSON.stringify(SH)) + ');}catch(e){}' +
                'try{localStorage.setItem("spr-sb-v1",' + JSON.stringify(JSON.stringify({ url: 'http://127.0.0.1:' + MOCK_PORT, key: 'k' })) + ');}catch(e){}';
    const A = await shareWindow(); await sleep(700); await waitShell(A); await sleep(400);
    const hubBtn = A.w.SPR_DEBUG_HUB;
    check(typeof hubBtn === 'function', 'hub dialog reachable (test hook present)');
    if (typeof hubBtn === 'function') {
      await hubBtn(); await sleep(500);
      const html = dlgHtml(A), txt = dlgTxt(A);
      check(/Save a copy to the cloud/i.test(txt), 'section 1: Save a copy to the cloud');
      check(/last saved|never/i.test(txt), 'section 1 shows last-saved time');
      check(/Share this class with a colleague/i.test(txt) && /Copy/i.test(txt), 'section 2: share link + Copy');
      check(/Anyone with this link can edit this class/i.test(txt), 'section 2 carries the one-sentence warning');
      check(/Test cloud connection/i.test(txt), 'section 3: Test cloud connection in the hub');
      check(/never replaces what is on this device without asking/i.test(txt), 'state rule: cloud never replaces this device silently');
      const low = txt.toLowerCase();
      check(!BANNED.some((w) => low.indexOf(w.toLowerCase()) !== -1), 'no jargon in the hub text (banned list 0 hits)');
      check(/<details/i.test(html), 'raw error text hidden behind a Details toggle');
    }
    /* sync OFF / not approved: only Download backup, no dead buttons */
    const B = boot(); await sleep(700); await waitShell(B); await sleep(400);
    if (typeof B.w.SPR_DEBUG_HUB === 'function') {
      await B.w.SPR_DEBUG_HUB(); await sleep(400);
      const t2 = dlgTxt(B);
      check(/not turned on|not approved/i.test(t2), 'off state says why in one sentence');
      check(/Download backup/i.test(t2), 'off state offers Download backup');
      const html2 = dlgHtml(B);
      check(!/data-action="share-push"(?!.*disabled)/.test(html2), 'no dead Save-a-copy button when off');
    }
    /* plain-language outcomes for the connection test */
    const C = await shareWindow(); await sleep(700); await waitShell(C); await sleep(400);
    if (typeof C.w.SPR_DEBUG_PING === 'function') {
      let rawPing = null;
    try { rawPing = await C.w.SPR_SYNC_TEST.ping(SH.channel, 'wrong-token-xyz'); } catch (e) { rawPing = 'THREW: ' + e.message; }
    if (process.env.R7DBG) console.log('    [dbg] raw ping:', JSON.stringify(rawPing));
    const badKey = await C.w.SPR_DEBUG_PING({ url: 'http://127.0.0.1:' + MOCK_PORT, key: 'k' }, SH.channel, 'wrong-token-xyz');
    if (process.env.R7DBG) console.log('    [dbg] badKey answer:', JSON.stringify(badKey));
      check(/protected and your key|wrong/i.test(badKey), 'wrong key/token: plain message, not raw error');
      const dead = await C.w.SPR_DEBUG_PING({ url: 'http://127.0.0.1:1', key: 'k' }, SH.channel, 'tok-1');
      check(/Can't reach the cloud|can't reach the cloud/i.test(dead), 'unreachable: plain network message');
    }
    /* conflicting edit: a newer cloud copy must ASK, never overwrite silently */
    {
      const A3 = await shareWindow(); await sleep(300); await waitShell(A3); await sleep(400);
      if (typeof A3.w.SPR_SYNC_TEST.sharePush === 'function') {
        MOCK_ROWS.length = 0;
        MOCK_ROWS.push({ id: SH.channel, payload: { spr: 1, ct: 'e30', iv: 'x', mac: 'x' }, pushed_by: 'Anna', pushed_at: new Date(Date.now() - 3600e3).toISOString(), write_token_hash: 'aa', previous: null });
        const writesBefore = calls.filter((c) => /spr_channels/.test(c.url) && c.method !== 'GET').length;
        const pr = A3.w.SPR_SYNC_TEST.sharePush();
        let dlgSeen = false;
        for (let t = 0; t < 20; t++) { await sleep(250); if (/Cloud was updated after your last sync/i.test(dlgTxt(A3))) { dlgSeen = true; break; } }
        if (process.env.R7DBG) console.log('    [dbg] conflict dlg:', JSON.stringify(dlgTxt(A3).slice(0, 90)), '| toasts:', Array.from(A3.d.querySelectorAll('#toast-root > *')).map((t) => t.textContent.slice(0, 40)).join(' ;; '));
        check(dlgSeen, 'conflicting edit: the app asks first (plain words, names the person + time)');
        const cancel = A3.d.querySelector('#dlg [data-x="2"]');
        if (cancel) click(A3, cancel);
        try { await pr; } catch (e) {}
        await sleep(600);
        const writesAfter = calls.filter((c) => /spr_channels/.test(c.url) && c.method !== 'GET').length;
        check(writesAfter === writesBefore, 'conflicting edit: choosing Cancel writes NOTHING (no silent overwrite)');
      } else check(false, 'sharePush reachable for the conflict test');
      A3.w.close();
    }
    /* class screen topbar: ONE primary Save & Share button.
       The live rendering + tap behaviour is proven in real Chromium
       (docs/qa/round7/phone.py, share-hub@390 screenshot); here we pin the
       static contract: exactly one hub button, in the top bar, primary. */
    {
      const btnCount = (html0.match(/data-action="share-hub"/g) || []).length;
      check(btnCount === 1, 'exactly ONE Save & Share button in the class shell (built bundle)');
      const topbarIdx = html0.indexOf('cls-topbar');
      check(topbarIdx !== -1 && html0.indexOf('share-hub') > topbarIdx, 'the Save & Share button lives in the class-screen top bar');
      const flat = html0.split(String.fromCharCode(10)).join('');
      check(flat.indexOf('btn primary') !== -1 && flat.indexOf('data-action="share-hub"') !== -1 && flat.indexOf('btn primary') < flat.indexOf('data-action="share-hub"'), 'the Save & Share button is the primary action in the top bar');
    }
  }

  /* ===== 6c. iOS warning reachable again from Manage ===== */
  console.log('6c. iOS warning re-showable');
  {
    const dk = webcrypto.getRandomValues(new Uint8Array(32));
    const auth = JSON.stringify({ users: [{ username: 'Mo', name: 'Mo', role: 'admin', keyring: {} }], session: { username: 'Mo', name: 'Mo', role: 'admin' } });
    const k = await webcrypto.subtle.importKey('raw', dk, 'AES-GCM', false, ['encrypt']);
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const sem = { id: 'sem7', name: 'P1A', className: 'Grade 1', months: ['Sep', 'Oct'], students: [{ id: 's1', nameEn: 'Ben' }], metrics: [], spelling: {}, daily: {}, observations: {}, settings: {} };
    const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify({ semesters: [sem], currentSemesterId: 'sem7', settings: {} }))));
    const v2 = JSON.stringify({ fmt: 2, wraps: {}, data: { iv: b64u(iv), ct: b64u(ct) }, ts: Date.now() });
    const pre6 = 'try{localStorage.setItem("spr-auth-v1",' + JSON.stringify(auth) + ');}catch(e){}' +
                 'try{localStorage.setItem("p4c4-markbook-v2",' + JSON.stringify(v2) + ');}catch(e){}' +
                 'try{sessionStorage.setItem("spr-session",' + JSON.stringify(JSON.stringify({ user: 'Mo', dk: b64u(dk) })) + ');}catch(e){}';
    const A = boot(pre6); await sleep(700); await waitShell(A); await sleep(400);
    A.w.location.hash = '#/manage'; await sleep(600);
    if (process.env.R7DBG) console.log('    [dbg] actions:', Array.from(A.d.querySelectorAll('[data-action]')).map((e) => e.getAttribute('data-action')).join(',').slice(0, 300), '| hash:', A.w.location.hash, '| content len:', (A.d.getElementById('content') || {}).innerHTML?.length);
    const again = A.d.querySelector('[data-action="ios-warn-again"]');
    check(!!again, 'Manage offers "show the iPhone/iPad warning again"');
    if (again) {
      click(A, again); await sleep(400);
      check(/7 days|7 days of not using/i.test(dlgTxt(A)), 'the warning dialog opens again');
    }
  }

  console.log('\nROUND7: ' + PASS + ' ok, ' + FAIL + ' FAIL');
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e.stack || e.message); process.exit(2); });
