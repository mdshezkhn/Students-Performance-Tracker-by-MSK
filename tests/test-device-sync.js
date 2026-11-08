/* Device-sync account bootstrap suite (jsdom, real node webcrypto).
   Verifies: fresh-browser login card, account-channel push with password
   wrap, sign-in-only restore on a second browser, wrong-password rejection,
   and cloud-copy adoption on a browser that has its own local sign-ins. */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;

/* KNOWN PRE-EXISTING RACE (fails the same way on main @ b99d050): after a
   password reset, the login-time pull-check's async tail can still install
   the cloud's stale users array over the fresh hash, so the data row never
   carries the new hash and fresh-browser bootstrap used to fail. Since the
   lossless push chain + prompt account-event pushes (2026-10-31) these run
   BY DEFAULT; SPR_RUN_RACY_S8=0 opts out (e.g. to isolate another section). */
const RUN_RACY_S8 = process.env.SPR_RUN_RACY_S8 !== '0';

/* jsdom is the ONLY dev dependency (package.json). Resolve it the normal
   way from a clean clone / CI (`npm install`), with the legacy sibling
   layout as a fallback for older checkouts. */
function requireJSDOM() {
  try { return require('jsdom'); }
  catch (e) { return require(path.join(__dirname, '../../test/node_modules/jsdom')); }
}
const { JSDOM, VirtualConsole } = requireJSDOM();

/* the single-file app: a fresh dist/ build if present, else the committed
   build at app/index.html (what a clean clone ships) */
const appHtmlPath = ['../app/index.html', '../dist/app/index.html']   /* test what SHIPS (committed) first */
  .map((rel) => path.join(__dirname, rel))
  .find((p) => fs.existsSync(p));
if (!appHtmlPath) { console.log('FAIL: no app build found (run: python source/build2.py)'); process.exit(1); }
const html0 = fs.readFileSync(appHtmlPath, 'utf8');

/* ---- fake Supabase REST: table lives INSIDE the jsdom window (window.__SB);
       the Node-side SB mirror is serialized in at boot and synced back out ---- */
const SB_FETCH_SRC =
  'function (url, opts) {' +
  ' url = String(url); opts = opts || {};' +
  ' try { window.__fetchLog = window.__fetchLog || []; window.__fetchLog.push((opts.method || "GET") + " " + url.slice(-46)); } catch (e) {}' +
  ' var SB = window.__SB;' +
  ' function chanIdFrom(u) {' +
  '   var i = u.indexOf("/rest/v1/spr_channels");' +
  '   if (i === -1) return undefined;' +
  '   var q = u.indexOf("id=eq.", i);' +
  '   if (q === -1) return null;' +
  '   var e = u.indexOf("&", q); return u.slice(q + 6, e === -1 ? u.length : e);' +
  ' }' +
  ' function H(st, body) { return { ok: st < 400, status: st, json: function () { return Promise.resolve(body === undefined ? [] : body); } }; }' +
  ' var chan = chanIdFrom(url);' +
  ' var slow = function (ms, fn) { ms = Number(ms || 0); return ms > 0 ? new Promise(function (r) { setTimeout(r, ms); }).then(fn) : Promise.resolve(fn()); };' +
  ' if (chan === undefined) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });' +
  ' if (opts.method === "POST") {' +
  '  return slow(window.__SB_SLOW_SAVE, function () {' +
  '   if (window.__SB_FAIL_SAVE === 1) return H(500);' +
  '   var b = JSON.parse(opts.body);' +
  '   if (SB[b.id]) return H(409);' +
  '   SB[b.id] = { id: b.id, share_name: b.share_name || null, pushed_by: b.pushed_by || null, pushed_at: b.pushed_at, payload: b.payload };' +
  '   return H(201);' +
  '  });' +
  ' }' +
  ' if (opts.method === "PATCH") {' +
  '  return slow(window.__SB_SLOW_SAVE, function () {' +
  '   if (window.__SB_FAIL_SAVE === 1) return H(500);' +
  '   if (!SB[chan]) return H(404);' +
  '   var p = JSON.parse(opts.body); Object.keys(p).forEach(function (k) { SB[chan][k] = p[k]; });' +
  '   return H(204);' +
  '  });' +
  ' }' +
  ' if (opts.method === "DELETE") { delete SB[chan]; return Promise.resolve(H(204)); }' +
  ' if (!opts.method || opts.method === "GET") return slow(window.__SB_SLOW_GET, function () { return H(200, chan && SB[chan] ? [SB[chan]] : []); });' +
  ' return Promise.resolve(H(200, chan && SB[chan] ? [SB[chan]] : []));' +
  '}';
let SB = {};   /* Node-side mirror — syncSB() pulls the window table back */
function syncSB(B) { SB = JSON.parse(JSON.stringify(B.w.__SB || {})); }
/* FNV-1a password hash — mirrors the app's hashPassword() */
function fnv(pw) {
  let h = 0x811c9dc5;
  for (let i = 0; i < pw.length; i++) { h ^= pw.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

let bootId = 0;
function boot(preStorage, preSession) {
  const pre =
    (preStorage ? Object.keys(preStorage).map((k) => 'try{localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(preStorage[k]) + ')}catch(e){}').join('') : '') +
    (preSession ? Object.keys(preSession).map((k) => 'try{sessionStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(preSession[k]) + ')}catch(e){}').join('') : '');
  const stub = '<script>' + pre +
    'window.__SB=' + JSON.stringify(SB) + ';' +
    'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
    'window.__downloads=[];' +
    'try{var oc=HTMLAnchorElement.prototype.click;' +
    'HTMLAnchorElement.prototype.click=function(){if(this.download)window.__downloads.push(this.download);return oc.apply(this,arguments)}}catch(e){}' +
    '(function(){var d=document.getElementById("dlg");if(d&&!d.showModal){d.showModal=function(){this.open=true};d.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();' +
    'window.__BOOT=' + (bootId++) + ';' +
    'window.__SPR_DS_TRACE=' + (process.env.SPR_DS_TRACE === '1' ? 'true' : 'false') + ';' +
    'window.fetch=' + SB_FETCH_SRC + ';' +
    '</script>';
  const i = html0.lastIndexOf('</body>');
  const html = html0.slice(0, i) + stub + html0.slice(i);
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented|canvas|navigation/i.test(String(e.message || e))) console.log('  jsdomError:', e.message); });
  vc.on('error', (m) => console.log('  console.error:', m));
  vc.on('log', () => {});
  const bootNo = bootId;
  vc.on('warn', (m) => { if (process.env.SPR_DS_TRACE === '1') process.stdout.write('    [w' + bootNo + ' trace] ' + String(m) + '\n'); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/app/index.html#/dashboard', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) { /* already set */ }
  /* jsdom windows lack TextEncoder/TextDecoder (real browsers always have
     them) — inject Node's so the app's crypto paths work */
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  /* jsdom has no URL.createObjectURL (and its Blob keeps no text) — the round10
     owner-kit download needs both. Same stub as the other migrated suites. */
  const RBd = w.Blob; const RUd = w.URL || {};
  w.Blob = function (parts, opts) { const b = new RBd(parts, opts); if (parts && parts.length && typeof parts[0] === 'string') b.__TEXT = parts[0]; return b; };
  w.URL.createObjectURL = w.URL.createObjectURL || (function () { return 'blob:ds-' + (++bootId); });
  return { dom, w, d: w.document };
}

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok:', msg); else { fails++; console.log('  FAIL:', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (B, el) => el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
const setVal = (B, el, v) => { el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); };
const dlgText = (B) => (B.d.getElementById('dlg') || {}).textContent || '';
function confirmYes(B) { click(B, B.d.querySelector('#dlg [data-x="1"]')); }
async function ackGate(B) {
  const b = B.d.querySelector('[data-action="privacy-gate-ack"]');
  if (b && B.d.getElementById('dlg') && B.d.getElementById('dlg').open) { click(B, b); await sleep(350); }
}
async function ackPrivacy(B) {
  const d = B.d.getElementById('dlg');
  if (d && d.open && d.textContent.includes('Privacy') && B.d.querySelector('[data-action="privacy-ack"]')) {
    click(B, B.d.querySelector('[data-action="privacy-ack"]'));
    await sleep(350);
  }
}
/* jsdom's location.reload() is a no-op — simulate it by rebooting with the same storages */
function reboot(B) {
  const ls = {}, ss = {};
  for (let i = 0; i < B.w.localStorage.length; i++) { const k = B.w.localStorage.key(i); ls[k] = B.w.localStorage.getItem(k); }
  for (let i = 0; i < B.w.sessionStorage.length; i++) { const k = B.w.sessionStorage.key(i); ss[k] = B.w.sessionStorage.getItem(k); }
  return boot(ls, ss);
}
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(400); }
  return cond();
}
function loginAs(B, user, pass) {
  setVal(B, B.d.getElementById('loginUser'), user);
  setVal(B, B.d.getElementById('loginPass'), pass);
  click(B, B.d.querySelector('[data-action="do-login"]'));
}
/* P1.2: the explicit cloud-copy lookup — the ONLY way a fresh browser now
   reaches the cloud at sign-in (no automatic lookup anymore) */
let LAST_LOOKUP_FAIL = '';   /* diagnosis only: which internal step gave up */
async function loginCloudAs(B, user, pass) {
  click(B, B.d.querySelector('[data-action="login-other-device"]'));
  await sleep(200);
  setVal(B, B.d.getElementById('odUser'), user);
  setVal(B, B.d.getElementById('odPass'), pass);
  click(B, B.d.querySelector('#dlg [data-x="1"]'));
  const confirmed = await waitFor(function () {
    return /Open the cloud copy here/.test(dlgText(B));
  }, 60000);
  if (!confirmed) {
    LAST_LOOKUP_FAIL = 'confirm dialog never appeared; odErr="' +
      String((B.d.getElementById('odErr') || {}).textContent || '').slice(0, 120) + '" dlg="' + dlgText(B).replace(/\s+/g, ' ').slice(0, 140) + '"';
    return false;
  }
  const okBtn = B.d.querySelector('#dlg .dlg-actions [data-x="1"]');
  click(B, okBtn);
  const fin = await waitFor(function () { return !B.d.body.classList.contains('auth-gate'); }, 60000);
  if (!fin) LAST_LOOKUP_FAIL = 'confirmed, but install/auth-gate did not finish in 60 s';
  else LAST_LOOKUP_FAIL = '';
  return fin;
}

(async () => {
  const ADMIN = 'mo', PW = 'cloud-test-pass-1';

  /* ---------- S1: fresh browser shows the SIGN-IN card, not setup ---------- */
  console.log('== S1: fresh-browser login card ==');
  const A = boot();
  let A2 = null;
  await waitFor(function () { return !!(A.d.getElementById('dlg') && A.d.getElementById('dlg').open); }, 10000);
  await ackGate(A);
  ok(A.d.getElementById('dlg') && A.d.getElementById('dlg').open, 'login dialog open');
  ok(!!A.d.getElementById('loginUser') && dlgText(A).includes('Sign In'), 'sign-in card shown by default');
  ok(!A.d.getElementById('suUser'), 'setup card NOT the default anymore');
  ok(!!A.d.querySelector('[data-action="show-setup"]'), 'setup toggle link present');

  /* ---------- S2: owner creates the account, loads data, turns on sync ---------- */
  console.log('== S2: enable device sync (owner) ==');
  click(A, A.d.querySelector('[data-action="show-setup"]'));
  await sleep(60);
  setVal(A, A.d.getElementById('suUser'), ADMIN);
  setVal(A, A.d.getElementById('suPass'), PW);
  setVal(A, A.d.getElementById('suConf'), PW);
  click(A, A.d.querySelector('[data-action="first-run"]'));
  for (let t = 0; t < 40; t++) {
    await sleep(250);
    const dl = A.d.getElementById('dlg');
    if (dl && dl.open && dl.querySelector('[data-action="recovery-ack"]')) {
      /* round10 first-run: master password, then the required owner-kit download */
      const mpw = dl.querySelector('#mrPw');
      if (mpw) { mpw.value = 'Master-r10-' + Math.random().toString(36).slice(2, 8); mpw.dispatchEvent(new A.w.Event('input', { bubbles: true })); }
      const mst = dl.querySelector('[data-action="recovery-master"]');
      if (mst) mst.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
      await sleep(3500);
      const kb = dl.querySelector('[data-action="owner-kit-dl"]');
      for (let t = 0; t < 30 && (!kb || kb.disabled); t++) { await sleep(300); }
      if (kb && !kb.disabled) kb.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
      await sleep(150);
      const cb = dl.querySelector('#recoverySaved'); if (cb && !cb.disabled) { cb.checked = true; cb.dispatchEvent(new A.w.Event('change', { bubbles: true })); }
      await sleep(150);
      dl.querySelector('[data-action="recovery-ack"]').dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
      break;
    }
  }
  await waitFor(function () { return !A.d.body.classList.contains('auth-gate'); }, 60000);
  await ackPrivacy(A);
  ok(!A.d.body.classList.contains('auth-gate'), 'owner signed in');
  // welcome screen → load sample data (persistNow is awaited before the reload no-op)
  const tsBeforeSample = (JSON.parse(A.w.localStorage.getItem('p4c4-markbook-v2') || '{"ts":0}') || {}).ts || 0;
  click(A, A.d.querySelector('[data-action="load-sample"]'));
  await sleep(300);
  /* a fresh browser already carries the default seed semester, so the app asks
     before replacing it — answer the reset confirm */
  if (A.d.getElementById('dlg') && A.d.getElementById('dlg').open && dlgText(A).indexOf('Reset to sample data') !== -1) confirmYes(A);
  const sampleReady = await waitFor(function () {
    try {
      const v2 = JSON.parse(A.w.localStorage.getItem('p4c4-markbook-v2') || 'null');
      return v2 && v2.data && v2.ts > tsBeforeSample && A.w.SPR_DEBUG_GET_DB().semesters.length > 0;
    } catch (e) { return false; }
  }, 60000);
  if (!sampleReady) {
    try {
      const v2d = JSON.parse(A.w.localStorage.getItem('p4c4-markbook-v2') || 'null');
      const md = JSON.parse(A.w.sessionStorage.getItem('spr-session-db') || 'null');
      console.log('  [diag] v2=' + JSON.stringify(v2d && { ts: v2d.ts, hasData: !!v2d.data }) + ' tsBefore=' + tsBeforeSample +
        ' mirror=' + JSON.stringify(md && { sems: md.db && md.db.semesters.length }) +
        ' mem=' + A.w.SPR_DEBUG_GET_DB().semesters.length +
        ' dlg=' + JSON.stringify(dlgText(A).slice(0, 80)));
    } catch (e) { console.log('  [diag] err', e.message); }
  }
  ok(sampleReady, 'sample data loaded');
  await sleep(300);
  // the app reloads after loading the sample; jsdom's reload is a no-op, so reboot with the same storages
  A2 = reboot(A);
  const sessReady = await waitFor(function () { return !A2.d.body.classList.contains('auth-gate'); }, 60000);
  ok(sessReady, 'session restored after reload');
  A2.w.location.hash = '#/manage';
  await sleep(250);
  const enBtn = A2.d.querySelector('[data-action="ds-enable"]');
  ok(!!enBtn, 'Turn on device sync button present (Manage)');
  click(A2, enBtn);
  await sleep(200);
  confirmYes(A2);
  /* condition, not a sleep: the enable flow generates the key, seals the
     envelope and uploads (2x600k PBKDF2 on the owner wrap on a slow box) */
  await waitFor(function () { syncSB(A2); return Object.keys(SB).length >= 1; }, 40000);
  const rows = Object.keys(SB);
  if (rows.length < 1) {
    console.log('  [s2dbg] pushLog: ' + (A2.w.SPR_SYNC_TEST && A2.w.SPR_SYNC_TEST.pushLog ? A2.w.SPR_SYNC_TEST.pushLog().join(' | ') : '(none)'));
    console.log('  [s2dbg] cfg: ' + A2.w.localStorage.getItem('spr-devicesync-v1'));
    console.log('  [s2dbg] toasts: ' + Array.from(A2.d.querySelectorAll('.toast, [class*=toast]')).map(function (t) { return t.textContent; }).join(' / '));
  }
  ok(rows.length === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(rows[0]), 'cloud row created on account channel (uuid): ' + rows[0]);
  const row = rows.length ? SB[rows[0]] : null;
  ok(row && row.payload && row.payload.sprDS === 1, 'payload is a device-sync envelope');
  const cfgA = JSON.parse(A2.w.localStorage.getItem('spr-devicesync-v1') || 'null');
  ok(cfgA && cfgA.on === true && cfgA.channel === rows[0], 'device cfg adopted the account channel');
  // NOTE: the row has no wrap yet — the sync key is wrapped under the password
  // only during a fresh sign-in session. The next fresh sign-in repairs the
  // row automatically (sign-in repair push — no data change needed).
  click(A2, A2.d.querySelector('[data-action="logout"]'));
  await sleep(400);
  const A3 = reboot(A2);
  await sleep(700);
  loginAs(A3, ADMIN, PW);
  await waitFor(function () { return !A3.d.body.classList.contains('auth-gate'); }, 60000);
  await ackPrivacy(A3);
  ok(!A3.d.body.classList.contains('auth-gate'), 'owner signed in again (fresh password session)');
  const wrapLanded = await waitFor(function () {
    syncSB(A3);
    return SB[rows[0]] && SB[rows[0]].payload.wrap;
  }, 60000);   // sign-in repair push: 4s debounce + PBKDF2 under load
  ok(wrapLanded, 'password wrap landed on the row at fresh sign-in (no data change needed)');

  /* ---------- S3: a data change auto-pushes with the wrap carried ---------- */
  console.log('== S3: auto-push after a change ==');
  syncSB(A3);
  const before = SB[rows[0]].payload.ct;
  A3.w.location.hash = '#/entry/sp';
  await sleep(300);
  const cell = A3.d.querySelector('input.cell');
  ok(!!cell, 'entry grid rendered with a score cell');
  setVal(A3, cell, '8');
  const pushed = await waitFor(function () {
    syncSB(A3);
    return SB[rows[0]] && SB[rows[0]].payload.ct !== before && SB[rows[0]].payload.wrap;
  }, 60000);   // 300ms save debounce + 4s push debounce + PBKDF2 under load
  ok(pushed, 'cloud payload updated after the change (with the password wrap)');
  const dbA = A3.w.SPR_DEBUG_GET_DB();

  /* ---------- S4: second browser — sign in with the account alone ---------- */
  console.log('== S4: fresh second browser, sign-in-only restore ==');
  const Bb = boot();
  await sleep(300);
  await ackGate(Bb);
  ok(!!Bb.d.getElementById('loginUser'), 'second browser shows sign-in card');
  loginAs(Bb, ADMIN, 'totally-wrong');
  const wrongPw = await waitFor(function () {
    const t = (Bb.d.getElementById('loginErr') || {}).textContent || '';
    return t.indexOf('Invalid') !== -1 || t.indexOf('no accounts') !== -1;   /* empty device points to pairing; either rejection is correct */
  }, 60000);   // wrong-password unwrap still pays PBKDF2-310k under load
  ok(wrongPw, 'wrong password rejected locally (no cloud contact made)');
  const s4In = await loginCloudAs(Bb, ADMIN, PW);
  await ackPrivacy(Bb);
  ok(s4In, 'second browser signed in via the explicit other-device lookup');
  const dbB = Bb.w.SPR_DEBUG_GET_DB();
  ok(dbB.semesters.length === dbA.semesters.length, 'data arrived from the cloud (' + dbB.semesters.length + ' semesters)');
  syncSB(Bb);
  const cfgB = JSON.parse(Bb.w.localStorage.getItem('spr-devicesync-v1') || 'null');
  ok(cfgB && cfgB.on === true && cfgB.channel === rows[0], 'second browser joined the sync channel by sign-in alone');

  /* ---------- S5: browser with its OWN local sign-ins adopts the cloud copy ---------- */
  console.log('== S5: non-fresh browser adopts the cloud copy ==');
  const C = boot({ 'spr-auth-v1': JSON.stringify({ users: [{ username: 'localadmin', hash: fnv('local-pass-123'), name: 'localadmin', role: 'admin' }], session: null }) });
  await sleep(300);
  await ackGate(C);
  ok(!!C.d.getElementById('loginUser'), 'non-fresh browser shows its sign-in card');
  const s5In = await loginCloudAs(C, ADMIN, PW);
  await ackPrivacy(C);
  ok(s5In, 'unknown account installed from the cloud via the explicit lookup');
  syncSB(C);
  const dbC = C.w.SPR_DEBUG_GET_DB();
  ok(dbC.semesters.length === dbA.semesters.length, 'cloud data present on device C (' + dbC.semesters.length + ' semesters)');
  const cfgC = JSON.parse(C.w.localStorage.getItem('spr-devicesync-v1') || 'null');
  ok(cfgC && cfgC.on === true, 'device C joined device sync');

  /* ---------- S6: same-account browser with its own data adopts the cloud copy ---------- */
  console.log('== S6: same-account browser adopts via sign-in offer + enable fallback ==');
  const D = boot();
  await sleep(300);
  await ackGate(D);
  click(D, D.d.querySelector('[data-action="show-setup"]'));
  await sleep(60);
  setVal(D, D.d.getElementById('suUser'), ADMIN);
  setVal(D, D.d.getElementById('suPass'), PW);
  setVal(D, D.d.getElementById('suConf'), PW);
  click(D, D.d.querySelector('[data-action="first-run"]'));
  for (let t = 0; t < 40; t++) {
    await sleep(250);
    const dl = D.d.getElementById('dlg');
    if (dl && dl.open && dl.querySelector('[data-action="recovery-ack"]')) {
      const mpw10 = dl.querySelector('#mrPw');
      if (mpw10) { mpw10.value = 'Master-r10-' + Math.random().toString(36).slice(2, 8); mpw10.dispatchEvent(new D.w.Event('input', { bubbles: true })); }
      const mst10 = dl.querySelector('[data-action="recovery-master"]');
      if (mst10) mst10.dispatchEvent(new D.w.MouseEvent('click', { bubbles: true }));
      await sleep(3500);
      const kb10 = dl.querySelector('[data-action="owner-kit-dl"]');
      for (let t10 = 0; t10 < 40 && (!kb10 || kb10.disabled); t10++) { await sleep(300); }
      if (kb10 && !kb10.disabled) kb10.dispatchEvent(new D.w.MouseEvent('click', { bubbles: true }));
      await sleep(150);
      const cb = dl.querySelector('#recoverySaved'); if (cb && !cb.disabled) { cb.checked = true; cb.dispatchEvent(new D.w.Event('change', { bubbles: true })); }
      await sleep(150);
      dl.querySelector('[data-action="recovery-ack"]').dispatchEvent(new D.w.MouseEvent('click', { bubbles: true }));
      break;
    }
  }
  await waitFor(function () { return !D.d.body.classList.contains('auth-gate'); }, 60000);
  await ackPrivacy(D);
  ok(!D.d.body.classList.contains('auth-gate'), 'device D set up its own local account');
  const tsBeforeD = (JSON.parse(D.w.localStorage.getItem('p4c4-markbook-v2') || '{"ts":0}') || {}).ts || 0;
  click(D, D.d.querySelector('[data-action="load-sample"]'));
  await sleep(300);
  if (D.d.getElementById('dlg') && D.d.getElementById('dlg').open && dlgText(D).indexOf('Reset to sample data') !== -1) confirmYes(D);
  const dReady = await waitFor(function () {
    try {
      const v2 = JSON.parse(D.w.localStorage.getItem('p4c4-markbook-v2') || 'null');
      return v2 && v2.data && v2.ts > tsBeforeD && D.w.SPR_DEBUG_GET_DB().semesters.length > 0;
    } catch (e) { return false; }
  }, 60000);
  ok(dReady, 'device D loaded its own data');
  let lastTs = -1;
  const quiet = await waitFor(function () {   // wait for the debounced seal to settle
    const a = (JSON.parse(D.w.localStorage.getItem('p4c4-markbook-v2') || '{}') || {}).ts || 0;
    const done = lastTs >= 0 && a === lastTs;
    lastTs = a;
    return done;
  }, 60000);
  ok(quiet, 'device D data settled before the browser restarts');
  const D2 = reboot(D);
  await waitFor(function () { return !!D2.d.querySelector('[data-action="logout"]'); }, 60000);   // shell re-renders only after the async session restore
  // sign out and back in — the fresh sign-in must offer the account's cloud copy
  click(D2, D2.d.querySelector('[data-action="logout"]'));
  await sleep(400);
  const D3 = reboot(D2);
  await sleep(700);
  loginAs(D3, ADMIN, PW);
  await waitFor(function () { return !D3.d.body.classList.contains('auth-gate'); }, 60000);
  await ackPrivacy(D3);
  /* P1.2: signing in with sync OFF must NOT auto-contact the cloud - the
     offer now lives behind the explicit Manage action instead */
  const offers = await waitFor(function () { return dlgText(D3).indexOf('cloud copy') !== -1; }, 3000).catch(function () { return false; });
  ok(offers === false, 'sign-in on a same-account browser does NOT auto-offer the cloud copy anymore');
  await sleep(400);
  D3.w.location.hash = '#/manage';
  await sleep(250);
  const enD = D3.d.querySelector('[data-action="ds-enable"]');
  ok(!!enD, 'device D sees Turn on device sync (Manage)');
  click(D3, enD);
  await sleep(200);
  confirmYes(D3);   // confirm "Turn on device sync?"
  const adoptUp = await waitFor(function () { return dlgText(D3).indexOf('cloud copy') !== -1; }, 60000);
  ok(adoptUp, 'adoption dialog offered instead of creating a second setup');
  syncSB(D3);
  const sumBefore = (SB[rows[0]] || {}).payload ? SB[rows[0]].payload.sum : null;
  let beforeObj = null;
  {
    const webcrypto = require('crypto').webcrypto;
    const cfgDp = JSON.parse(A2.w.localStorage.getItem('spr-devicesync-v1') || D3.w.localStorage.getItem('spr-devicesync-v1') || '{}');
    if (cfgDp.key) {
      const kb = Buffer.from(cfgDp.key.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      try {
        const k = await webcrypto.subtle.importKey('raw', kb, 'AES-GCM', false, ['decrypt']);
        const r0 = SB[rows[0]] || {};
        const iv = Buffer.from(r0.payload.iv.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const ct = Buffer.from(r0.payload.ct.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        beforeObj = JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, ct)));
      } catch (e) { console.log('  [before-decrypt] failed', e.message); }
    }
  }
  confirmYes(D3);   // open the cloud copy
  await sleep(800);
  syncSB(D3);
  /* content sum, not ciphertext: another live window's legitimate wrap-refresh
     push re-seals with a fresh IV (ct changes) while the CONTENT stays equal */
  /* the adoption may legitimately trigger a debounced re-push from D; what
     must NEVER happen is D's OLD (pre-adoption) data replacing the cloud row.
     Wait for pushes to settle, then deep-compare the row's decrypted content
     (users / v2 wraps / db) against what the row held before adoption. */
  {
    let lastAt = null, stable = false;
    const tq = Date.now();
    while (Date.now() - tq < 60000 && !stable) {
      await sleep(1000); syncSB(D3);
      const at = (SB[rows[0]] || {}).pushed_at || null;
      stable = at !== null && at === lastAt && !holdOf(D3) && !pendingOf(D3);
      lastAt = at;
    }
    const webcrypto2 = require('crypto').webcrypto;
    const cfgDp2 = JSON.parse(D3.w.localStorage.getItem('spr-devicesync-v1') || '{}');
    const kb2 = Buffer.from(cfgDp2.key.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const k2 = await webcrypto2.subtle.importKey('raw', kb2, 'AES-GCM', false, ['decrypt']);
    const rNow = SB[rows[0]] || {};
    const iv2 = Buffer.from(rNow.payload.iv.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const ct2 = Buffer.from(rNow.payload.ct.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const nowObj = JSON.parse(new TextDecoder().decode(await webcrypto2.subtle.decrypt({ name: 'AES-GCM', iv: iv2 }, k2, ct2)));
    const strip = (o) => JSON.stringify(o, (kk, v) => (kk === 'ts' || kk === 'iv' || kk === 'ct' || kk === 'sum') ? undefined : v);
    ok(strip(nowObj.users) === strip(beforeObj.users), 'cloud row users NOT replaced by device D');
    ok(strip((nowObj.v2 || {}).wraps) === strip((beforeObj.v2 || {}).wraps), 'cloud row wraps NOT replaced by device D');
    ok(strip(nowObj.db) === strip(beforeObj.db), 'cloud row data content NOT overwritten by device D');
  }
  const cfgD = JSON.parse(D3.w.localStorage.getItem('spr-devicesync-v1') || 'null');
  ok(cfgD && cfgD.on === true && cfgD.channel === rows[0] && !!cfgD.key, 'device D adopted the account channel + key');
  const usersD = JSON.parse(D3.w.localStorage.getItem('spr-auth-v1') || 'null');
  ok(!!(usersD && Array.isArray(usersD.users) && usersD.users.some(function (u) { return u.username === ADMIN; })), 'cloud accounts installed on device D');

  /* ---------- S7: teacher transport on the paired device ---------- */
  console.log('== S7: teacher on a paired device (all-users transport) ==');
  const TEA = 'tea1', TEAPW = 'teacher-pass-1';
  let TEAPW_NOW = TEAPW;   /* tracks self-service changes */
  syncSB(Bb);
  const ctBeforeAdd = (SB[rows[0]] || {}).payload ? SB[rows[0]].payload.ct : null;
  Bb.w.location.hash = '#/manage';
  await sleep(300);
  click(Bb, Bb.d.querySelector('[data-action="acct-add-open"]'));
  await sleep(150);
  ok(!!Bb.d.getElementById('naUser'), 'add-sign-in dialog open');
  setVal(Bb, Bb.d.getElementById('naUser'), TEA);
  setVal(Bb, Bb.d.getElementById('naName'), 'Teacher One');
  setVal(Bb, Bb.d.getElementById('naPass'), TEAPW);
  setVal(Bb, Bb.d.getElementById('naConf'), TEAPW);
  click(Bb, Bb.d.querySelector('[data-action="acct-add"]'));
  const addPushed = await waitFor(function () {
    syncSB(Bb);
    return SB[rows[0]] && SB[rows[0]].payload.ct !== ctBeforeAdd;
  }, 60000);
  ok(addPushed, 'teacher sign-in creation reached the cloud copy');
  ok(!!((SB[rows[0]] || {}).payload || {}).wrap, 'owner password wrap present before the teacher session');
  // sign out and back in as the teacher on this paired device
  click(Bb, Bb.d.querySelector('[data-action="logout"]'));
  await sleep(400);
  let Bt = reboot(Bb);
  await sleep(700);
  loginAs(Bt, TEA, TEAPW);
  await waitFor(function () { return !Bt.d.body.classList.contains('auth-gate'); }, 60000);
  await ackPrivacy(Bt);
  ok(!Bt.d.body.classList.contains('auth-gate'), 'teacher signed in on the paired device');
  // teacher sees the managed-by-admin note, not the control buttons
  Bt.w.location.hash = '#/manage';
  await sleep(300);
  ok(Bt.d.body.textContent.indexOf('managed by the administrator') !== -1, 'non-admin sees the managed-by-admin note');
  ok(!Bt.d.querySelector('[data-action="ds-enable"]'), 'teacher does NOT see Turn on device sync');
  // a teacher edit auto-pushes to the SAME row, credited to the teacher, and
  // never replaces the owner's password wrap
  Bt.w.location.hash = '#/entry/sp';
  await sleep(300);
  const tCell = Bt.d.querySelector('input.cell');
  ok(!!tCell, 'entry grid rendered for the teacher');
  /* let the teacher sign-in's pull-check (1.5 s, holds pushes) and sign-in
     push (4 s, early-returns: nothing to write) settle BEFORE baselining,
     otherwise the edit's debounced push races the hold and the baseline
     catches a stale row */
  await waitDrained(Bt, 60000, 'teacher sign-in tail (pull-check hold + sign-in push) before the edit baseline');
  syncSB(Bt);
  const wrapBeforeTea = (SB[rows[0]] || {}).payload ? SB[rows[0]].payload.wrap : null;
  const ctBeforeTea = (SB[rows[0]] || {}).payload ? SB[rows[0]].payload.ct : null;
  setVal(Bt, tCell, '6');
  const teaPushed = await waitFor(function () {
    syncSB(Bt);
    return SB[rows[0]] && SB[rows[0]].payload.ct !== ctBeforeTea;
  }, 60000);
  ok(teaPushed, 'teacher edit auto-pushed to the same cloud row');
  ok(String(SB[rows[0]].pushed_by || '').indexOf(TEA) !== -1, 'push credited to “device — ' + TEA + '” (got: ' + SB[rows[0]].pushed_by + ')');
  ok(JSON.stringify(SB[rows[0]].payload.wrap) === JSON.stringify(wrapBeforeTea), 'owner password wrap preserved by the teacher push');
  // with the cloud pointer (written at account creation), a teacher CAN now
  // bootstrap a brand-new browser — and still no fork: one data row + one
  // small pointer row, nothing else
  syncSB(Bt);
  ok(Object.keys(SB).filter(function (id) { return SB[id].payload && SB[id].payload.sprDS === 1; }).length === 1, 'still exactly one DATA row for the school');
  ok(Object.keys(SB).filter(function (id) { return SB[id].payload && SB[id].payload.sprPTR === 1; }).length === 1, 'plus exactly one pointer row (teacher bootstrap)');


  syncSB(Bt);
  const allRows = Object.keys(SB);
  const dataRows = allRows.filter(function (id) { return SB[id].payload && SB[id].payload.sprDS === 1; });
  const ptrRows = allRows.filter(function (id) { return SB[id].payload && SB[id].payload.sprPTR === 1; });
  /* ---------- S7.5 (P1.2): self-service password change re-seals the pointer ---------- */
  console.log('== S7.5: self-service password change re-seals the cloud pointer ==');
  const TEAPW3 = 'self-service-pass-3';
  syncSB(Bt);
  const ptrCtSelf = SB[ptrRows[0]] ? SB[ptrRows[0]].payload.ct : null;
  /* 2026-10-25: password self-service lives in Manage & setup for every role
     (the separate sidebar button is gone). Class-mode teachers get the
     password card; legacy-mode (this device) gets the full manage page with
     the button in the account block. */
  await waitDrained(Bt, 60000, 'teacher sign-in tail before the self-service password change');   /* the tail re-points the hash and would revert #/manage */
  const mgmtLink = Bt.d.querySelector('.nav a[data-nav="manage"]');
  if (mgmtLink) click(Bt, mgmtLink); else Bt.w.location.hash = '#/manage';
  await sleep(600);
  const cpFound = await waitFor(() => !!Bt.d.querySelector('[data-action="change-pass-open"]'), 8000);
  ok(cpFound, 'teacher has a Change-my-password control in Manage & setup');
  click(Bt, Bt.d.querySelector('[data-action="change-pass-open"]'));
  await sleep(800);
  if (!Bt.d.querySelector('[data-action="change-pass-save"]')) {
    const dl = Bt.d.getElementById('dlg');
    console.log('  [dbg] dlg open:', !!(dl && dl.open), '| text:', ((dl && dl.textContent) || '').slice(0, 120));
  }
  await waitFor(() => !!Bt.d.querySelector('[data-action="change-pass-save"]'), 6000);
  setVal(Bt, Bt.d.getElementById('cpCur'), TEAPW);
  setVal(Bt, Bt.d.getElementById('cpNew'), TEAPW3);
  setVal(Bt, Bt.d.getElementById('cpConf'), TEAPW3);
  click(Bt, Bt.d.querySelector('[data-action="change-pass-save"]'));
  syncSB(Bt);
  const dataCtSelf = SB[dataRows[0]] ? SB[dataRows[0]].payload.ct : null;
  const selfResealed = await waitFor(function () {
    syncSB(Bt);
    return SB[ptrRows[0]] && SB[ptrRows[0]].payload.ct !== ptrCtSelf;
  }, 60000);
  ok(selfResealed, 'self-service change re-sealed the POINTER row (no admin involved)');
  const dataRekeyed = await waitFor(function () {
    syncSB(Bt);
    return SB[dataRows[0]] && SB[dataRows[0]].payload.ct !== dataCtSelf;
  }, 60000);
  ok(dataRekeyed, 'the re-keyed account reached the DATA row before the bootstrap test');
  /* the fresh browser now bootstraps with the SELF-changed password */
  const G6 = boot();
  await sleep(300);
  await ackGate(G6);
  const selfBoot = await loginCloudAs(G6, TEA, TEAPW3);
  {
    const au = JSON.parse(G6.w.localStorage.getItem('spr-auth-v1') || '{}');
    const tea = (au.users || []).find((x) => x.username === 'tea1') || null;
  }
  ok(selfBoot, 'fresh browser bootstraps with the self-changed password');
  ok(selfBoot && G6.w.SPR_DEBUG_GET_DB().semesters.length > 0, 'self-service bootstrap sees the classes');
  /* and the old password is dead on the pointer */
  const G7 = boot();
  await sleep(300);
  await ackGate(G7);
  click(G7, G7.d.querySelector('[data-action="login-other-device"]'));
  await sleep(200);
  setVal(G7, G7.d.getElementById('odUser'), TEA);
  setVal(G7, G7.d.getElementById('odPass'), TEAPW);
  click(G7, G7.d.querySelector('#dlg [data-x="1"]'));
  const oldDead = await waitFor(function () {
    return (((G7.d.getElementById('odErr') || {}).textContent || '').indexOf('Wrong password') !== -1);
  }, 60000);
  ok(oldDead, 'old password is rejected by the re-sealed pointer');
  /* back on the teacher device: continue signed-in as the teacher with the NEW password */
  TEAPW_NOW = TEAPW3;

  /* round8: a device's push chain is DRAINED when no pull-check holds it and
     no push is wanted — the condition every settle-wait uses instead of sleep */
  function holdOf(B) { try { return !!B.w.SPR_SYNC_TEST.hold(); } catch (e) { return false; } }
  function pendingOf(B) { try { return !!JSON.parse(B.w.localStorage.getItem('spr-devicesync-v1') || '{}').pendingPush; } catch (e) { return false; } }
  async function waitDrained(B, ms, what) {
    const done = await waitFor(function () { return !holdOf(B) && !pendingOf(B); }, ms || 60000);
    if (!done) console.log('  [waitDrained] timed out waiting for: ' + what + ' (hold=' + holdOf(B) + ' pending=' + pendingOf(B) + ')');
    return done;
  }
  /* decrypt a sync row the way the app does (suite-side, for assertions) */
  const b64uToBytes = function (s) { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const b = atob(t + '='.repeat((4 - t.length % 4) % 4)); return Uint8Array.from(b, function (c) { return c.charCodeAt(0); }); };
  async function rowPlain(B, row) {
    const cfg = JSON.parse(B.w.localStorage.getItem('spr-devicesync-v1'));
    const key = await require('crypto').webcrypto.subtle.importKey('raw', b64uToBytes(cfg.key), 'AES-GCM', false, ['decrypt']);
    const pt = await require('crypto').webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uToBytes(row.payload.iv) }, key, b64uToBytes(row.payload.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /* ---------- S8: teacher sign-in-anywhere (cloud pointer) ---------- */
  console.log('== S8: teacher signs in on a FRESH browser via cloud pointer ==');
  const TEAPW2 = 'teacher-pass-2-reset';

  ok(dataRows.length === 1, 'exactly one data row (no fork)');
  ok(ptrRows.length === 1, 'pointer row exists for the teacher account');
  ok(ptrRows.length === 1 && SB[ptrRows[0]].payload.ct, 'pointer payload is sealed ciphertext');
  ok(ptrRows.length === 1 && String(SB[ptrRows[0]].share_name) === 'ds-ptr', 'pointer row tagged ds-ptr (not listed as a school copy)');
  /* fresh browser: teacher signs in with the ORIGINAL password -> everything arrives */
  const G1 = boot();
  await sleep(300);
  await ackGate(G1);
  const teaBoot1 = await loginCloudAs(G1, TEA, TEAPW_NOW);
  ok(teaBoot1, 'explicit other-device lookup restored the whole markbook (no automatic contact)');
  ok(teaBoot1 && G1.w.SPR_DEBUG_GET_DB().semesters.length > 0, 'teacher sees the classes');
  const cfgG1 = JSON.parse(G1.w.localStorage.getItem('spr-devicesync-v1') || 'null');
  ok(!!(cfgG1 && cfgG1.channel === dataRows[0] && cfgG1.owner === ADMIN && cfgG1.adoptedAcct === true), 'teacher device joined the OWNER channel (cfg.owner=admin)');
  /* fresh browser: wrong teacher password is rejected */
  const G2 = boot();
  await sleep(300);
  await ackGate(G2);
  loginAs(G2, TEA, 'wrong-password-99');
  const rej = await waitFor(function () { const t = (G2.d.getElementById('loginErr') || {}).textContent || ''; return t.indexOf('Invalid') !== -1 || t.indexOf('no accounts') !== -1; }, 60000);
  ok(rej, 'wrong teacher password rejected on the pointer row');
  /* admin resets the teacher password -> old pointer password dies, new one works */
  click(Bt, Bt.d.querySelector('[data-action="logout"]'));
  await sleep(400);
  Bt = reboot(Bt);
  await sleep(700);
  loginAs(Bt, ADMIN, PW);
  await waitFor(function () { return !Bt.d.body.classList.contains('auth-gate'); }, 60000);
  await ackPrivacy(Bt);
  /* answer the boot adoption dialog if one is open (a real user would):
     pushes stay held until the decision dialog closes, so the reset's
     data-row push below would never land otherwise */
  for (let drain = 0; drain < 3; drain++) {
    const dlgBtn = Bt.d.querySelector('#dlg[open] [data-x="1"]');
    if (!dlgBtn) break;
    click(Bt, dlgBtn);
    await sleep(900);
  }
  Bt.w.location.hash = '#/manage';
  await sleep(300);
  click(Bt, Bt.d.querySelector('[data-action="acct-reset-open"][data-user="' + TEA + '"]'));
  await sleep(150);
  setVal(Bt, Bt.d.getElementById('rpPass'), TEAPW2);
  setVal(Bt, Bt.d.getElementById('rpConf'), TEAPW2);
  syncSB(Bt);
  const ptrCtBefore = SB[ptrRows[0]] ? SB[ptrRows[0]].payload.ct : null;
  const dataAtBefore = SB[dataRows[0]] ? SB[dataRows[0]].pushed_at : null;   /* captured BEFORE the click: the data-row push now fires promptly */
  click(Bt, Bt.d.querySelector('[data-action="acct-reset"]'));
  const resealed = await waitFor(function () {
    syncSB(Bt);
    return SB[ptrRows[0]] && SB[ptrRows[0]].payload.ct !== ptrCtBefore;
  }, 60000);
  ok(resealed, 'password reset re-sealed the pointer row');
  syncSB(Bt);
  let hashPushed = false;
  if (RUN_RACY_S8) {
    hashPushed = await waitFor(function () {
      syncSB(Bt);
      return SB[dataRows[0]] && SB[dataRows[0]].pushed_at !== dataAtBefore;
    }, 60000);
    if (!hashPushed) {
      if (Bt.w.SPR_SYNC_TEST && Bt.w.SPR_SYNC_TEST.pushLog) console.log('  [pushlog Bt] ' + Bt.w.SPR_SYNC_TEST.pushLog().join(' | '));
      syncSB(Bt);
      console.log('  [rdbg] dataAtBefore=' + dataAtBefore + ' | row now: pushed_at=' + ((SB[dataRows[0]] || {}).pushed_at) + ' | all rows: ' + JSON.stringify(Object.keys(SB).map(function (k) { return k.slice(0, 8) + ':' + (SB[k].pushed_at || ''); })));
    }
    ok(hashPushed, 'reset also pushed the re-keyed account (login wrap) to the data row');
  } else console.log('  SKIP (known sync race, RemoteStore phase): reset data-row push check');
  if (RUN_RACY_S8) {
    const G3 = boot();
    await sleep(300);
    await ackGate(G3);
    const oldPwRejected = !(await loginCloudAs(G3, TEA, TEAPW));
    ok(oldPwRejected, 'old teacher password no longer bootstraps');
    const G4 = boot();
    await sleep(300);
    await ackGate(G4);
    const newPwWorks = await loginCloudAs(G4, TEA, TEAPW2);
    if (!newPwWorks) {
      const dlg = G4.d.getElementById('dlg');
      console.log('    [g4dbg] dlg open:', !!(dlg && dlg.open), '| dlg text:', (dlg && dlg.textContent || '').slice(0, 100));
      console.log('    [g4dbg] odErr:', ((G4.d.getElementById('odErr') || {}).textContent || '').slice(0, 80), '| loginErr:', ((G4.d.getElementById('loginErr') || {}).textContent || '').slice(0, 80));
      console.log('    [g4dbg] gate:', G4.d.body.classList.contains('auth-gate'), '| cfg:', (G4.w.localStorage.getItem('spr-devicesync-v1') || '').slice(0, 80));
      syncSB(Bt);
      console.log('    [g4dbg] Bt pushLog tail:', Bt.w.SPR_SYNC_TEST.pushLog().slice(-4).join(' | '));
    }
    ok(newPwWorks, 'new teacher password bootstraps a fresh browser (explicit lookup)');
  } else console.log('  SKIP (known sync race, RemoteStore phase): fresh-browser bootstrap checks');
  /* removing the sign-in kills its pointer; the data row survives */
  syncSB(Bt);
  click(Bt, Bt.d.querySelector('[data-action="acct-del"][data-user="' + TEA + '"]'));
  const delAt = Date.now() - 1000;
  syncSB(Bt);
  const sumBeforeDel = SB[dataRows[0]] && SB[dataRows[0]].payload ? SB[dataRows[0]].payload.sum : null;
  const preDelRowJson = JSON.stringify(SB[dataRows[0]] || null);   /* S11 replays the stale-copy race */
  await sleep(150);
  click(Bt, Bt.d.querySelector('#dlg [data-x="1"]'));
  const ptrDead = await waitFor(function () {
    syncSB(Bt);
    const r = SB[ptrRows[0]];
    return !r || !r.payload || r.payload.dead || r.payload.sprPTR !== 1;
  }, 60000);
  ok(ptrDead, 'pointer row killed with the account');
  syncSB(Bt);
  ok(SB[dataRows[0]] && SB[dataRows[0]].payload.sprDS === 1, 'school data row untouched by account removal');
  const G5 = boot();
  await sleep(300);
  await ackGate(G5);
  click(G5, G5.d.querySelector('[data-action="login-other-device"]'));
  await sleep(200);
  setVal(G5, G5.d.getElementById('odUser'), TEA);
  setVal(G5, G5.d.getElementById('odPass'), TEAPW2);
  click(G5, G5.d.querySelector('#dlg [data-x="1"]'));
  const goneRej = await waitFor(function () {
    const t = ((G5.d.getElementById('odErr') || {}).textContent || '');
    return t.indexOf('No cloud copy') !== -1 || t.indexOf('Wrong password') !== -1;
  }, 60000);
  ok(goneRej, 'deleted teacher account cannot sign in anywhere anymore');
  /* the tombstone rides the DEBOUNCED (4 s) data-row push. S10 adopts the
     cloud copy, so it must not start until the post-deletion copy is on the
     row (pushed_at newer than the deletion click). Deterministic — the old
     debug sleep here was accidentally load-bearing. */
  /* poll the row CONTENT digest (sum), not the timestamp: clock skew and a
     straggler push made the pushed_at version flake on slow machines */
  const postDelPlain = await waitFor(async function () {
    syncSB(Bt);
    const r = SB[dataRows[0]];
    if (!r || !r.payload || !r.payload.sum || r.payload.sum === sumBeforeDel) return false;
    try { const pl = await rowPlain(Bt, r); return Array.isArray(pl.gone) && pl.gone.indexOf(TEA) !== -1; } catch (e) { return false; }
  }, 60000);
  ok(!!postDelPlain, 'post-deletion copy published (tombstone travels on the row)');
  const postDelRowJson = JSON.stringify(SB[dataRows[0]] || null);
  /* quiesce: let the debounce window (and any follow-up save push) drain;
     the tombstone invariant itself is asserted in S10 (adopt sees gone[]) */
  let quietFor = 0, lastSeenAt = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 12000 && quietFor < 6000) {
    syncSB(Bt);
    const seen = (SB[dataRows[0]] || {}).pushed_at || null;
    if (seen === lastSeenAt) quietFor += 500; else { quietFor = 0; lastSeenAt = seen; }
    await sleep(500);
  }
  ok(quietFor >= 6000, 'pushes quiesced after the deletion (no endless straggler churn)');

  /* ---------- S9: no surprise .json downloads; in-app safety copies ---------- */
  console.log('== S9: safety copies replace the .json download ==');
  ok(Array.isArray(G1.w.__downloads) && G1.w.__downloads.length === 0, 'cloud adoption triggered ZERO file downloads');
  /* a browser WITH its own data adopting the cloud copy must stash, not download */
  const H = boot();
  await sleep(300);
  await ackGate(H);
  click(H, H.d.querySelector('[data-action="show-setup"]'));
  await sleep(80);
  setVal(H, H.d.getElementById('suUser'), 'other-admin');
  setVal(H, H.d.getElementById('suPass'), 'other-pass-123');
  setVal(H, H.d.getElementById('suConf'), 'other-pass-123');
  click(H, H.d.querySelector('[data-action="first-run"]'));
  await waitFor(function () { return !H.d.body.classList.contains('auth-gate'); }, 60000);
  await ackPrivacy(H);
  await sleep(800);   /* let the setup persist settle */
  const H2 = boot(JSON.parse(JSON.stringify((function () { const o = {}; for (let i = 0; i < H.w.localStorage.length; i++) { const k = H.w.localStorage.key(i); o[k] = H.w.localStorage.getItem(k); } return o; })())));
  await sleep(500);
  const h2In = await loginCloudAs(H2, ADMIN, PW);   /* explicit lookup: the ONLY cloud contact */
  ok(h2In, 'adoption over existing data signed in via the explicit lookup');
  await waitDrained(H2, 60000, 'adoption sign-in tail before the downloads check');
  ok(H2.w.__downloads.length === 0, 'adoption over existing data: no .json downloaded');
  const stashH = JSON.parse(H2.w.localStorage.getItem('spr-safety-backups-v1') || '[]');
  ok(stashH.length === 1 && stashH[0].db && Array.isArray(stashH[0].db.semesters), 'safety copy stashed in-app instead');
  ok(H2.w.localStorage.getItem('spr-auth-v1').indexOf(ADMIN) !== -1, 'cloud accounts installed over the old ones');

  /* ---------- S10 (2026-10-24): accounts survive sync — no vanishing colleagues ---------- */
  console.log('== S10: stale short account list must not erase colleagues ==');
  /* the real-world bug: a device whose local list was [mo, Management] adopted
     the school copy, then its next PUSH published that stale list and every
     other device lost the accounts created elsewhere. Accounts must now travel
     additively (union + tombstones). */
  const STALE = 'mgmt-local';
  const M = boot({ 'spr-auth-v1': JSON.stringify({ users: [
    { username: ADMIN, name: ADMIN, role: 'admin' },                                  /* stale record, no wrap */
    { username: STALE, name: 'Management', role: 'manager', keyring: {}, login: { v: 1 } }  /* local-only account */
  ], session: null }) });
  await sleep(300);
  await ackGate(M);
  syncSB(M);
  syncSB(M);
  const sumAtAdopt = SB[dataRows[0]] && SB[dataRows[0]].payload ? SB[dataRows[0]].payload.sum : null;
  const mIn = await loginCloudAs(M, ADMIN, PW);
  await ackPrivacy(M);
  ok(mIn, 'stale-list device adopted the cloud copy');
  const mAuth = JSON.parse(M.w.localStorage.getItem('spr-auth-v1') || 'null');
  ok(!!(mAuth && mAuth.users.some(function (u) { return u.username === STALE; })), 'local-only account SURVIVED the adoption');
  ok(!!(mAuth && mAuth.users.some(function (u) { return u.username === ADMIN && u.login && u.login.v !== 1; })), 'admin record taken from the cloud (fresher), not the stale local one');
  const mGone = JSON.parse(M.w.localStorage.getItem('spr-ds-gone-v1') || '[]');
  ok(Array.isArray(mGone) && mGone.indexOf(TEA) !== -1, 'teacher tombstone arrived with the copy (stays deleted)');
  /* the device pushes the UNION back — the exact step that used to erase colleagues */
  const unionPushed = await waitFor(function () {
    syncSB(M);
    const r = SB[dataRows[0]];
    return r && r.payload && r.payload.sum && r.payload.sum !== sumAtAdopt;
  }, 60000);
  ok(unionPushed, 'union re-published to the cloud row');
  /* a fresh browser must now see BOTH accounts */
  const F = boot();
  await sleep(300);
  await ackGate(F);
  const fIn = await loginCloudAs(F, ADMIN, PW);
  await ackPrivacy(F);
  ok(fIn, 'fresh browser restored the union copy');
  const fAuth = JSON.parse(F.w.localStorage.getItem('spr-auth-v1') || 'null');
  ok(!!(fAuth && fAuth.users.some(function (u) { return u.username === ADMIN; })), 'admin present on the fresh browser');
  ok(!!(fAuth && fAuth.users.some(function (u) { return u.username === STALE; })), 'colleague account present on the fresh browser (the vanishing-accounts bug)');
  ok(!(fAuth && fAuth.users.some(function (u) { return u.username === TEA; })), 'deleted teacher stays deleted after the union round-trip');
  /* S9 re-check: this adoption also stashed instead of downloading */
  ok(Array.isArray(M.w.__downloads) && M.w.__downloads.length === 0, 'S10 adoption downloaded zero files');

  /* ---------- S11 (round 3): the stale-copy race can never resurrect ---------- */
  console.log('== S11: a device that adopted the PRE-deletion copy cannot resurrect the deleted account ==');
  /* Deterministic replay of the real-world race: device X adopts the cloud
     copy BEFORE the deletion push lands (it honestly holds tea1), the
     deleter's push lands, THEN X pushes its merge. The union must keep the
     tombstone: tea1 stays out of the row, and X's local copy self-corrects. */
  const postDelRow = JSON.parse(postDelRowJson);
  /* X adopts the PRE-deletion copy; it also holds one LOCAL account the row
     has never seen, so its post-race merge carries real new content (a
     content-identical push is rightly skipped by the app) */
  SB[dataRows[0]] = JSON.parse(preDelRowJson);
  const XCOL = 'xcol-local';
  const X = boot({ 'spr-auth-v1': JSON.stringify({ users: [
    { username: ADMIN, name: ADMIN, role: 'admin' },
    { username: XCOL, name: 'X Colleague', role: 'teacher', keyring: {}, login: { v: 1 } }
  ], session: null }) });
  await sleep(300);
  await ackGate(X);
  const xIn = await loginCloudAs(X, ADMIN, PW);
  await ackPrivacy(X);
  ok(xIn, 'X adopted the (stale, pre-deletion) cloud copy');
  const xAuth1 = JSON.parse(X.w.localStorage.getItem('spr-auth-v1') || 'null');
  ok(!!(xAuth1 && xAuth1.users.some(function (u) { return u.username === TEA; })), 'X honestly holds the deleted account (pre-deletion copy)');
  /* the deleter's push lands — in X's window table (each window owns its table;
     boot() seeds it from the suite table, writes stay window-local) */
  X.w.__SB[dataRows[0]] = JSON.parse(postDelRowJson);
  /* X pushes its merge (the retry path a real device takes on the next save/retry) */
  const xCfg = JSON.parse(X.w.localStorage.getItem('spr-devicesync-v1'));
  xCfg.lastResult = 'fail'; X.w.localStorage.setItem('spr-devicesync-v1', JSON.stringify(xCfg));
  const dsD = X.w.SPR_DEBUG_DS;
  /* deterministic trigger: one explicit push cycle (the natural save path is
     proven by S8/S10; this replays exactly the post-race merge) */
  const pushedNow = await dsD.push();
  const xCfgAfter = JSON.parse(X.w.localStorage.getItem('spr-devicesync-v1') || 'null');
  console.log('  [S11] X cfg.on:', xCfgAfter && xCfgAfter.on, '| lastResult:', xCfgAfter && xCfgAfter.lastResult, '| channel:', xCfgAfter && !!xCfgAfter.channel, '| hold:', X.w.__HOLD === undefined ? 'n/a' : X.w.__HOLD);
  const xPushed = await waitFor(function () {
    syncSB(X);
    const r = SB[dataRows[0]];
    return !!(r && r.payload && r.payload.sum && r.payload.sum !== postDelRow.payload.sum);
  }, 60000);
  if (!xPushed) console.log('  [S11] (diag) X cfg:', X.w.localStorage.getItem('spr-devicesync-v1'), '| reqs:', (X.w.__fetchLog || []).length);
    ok(xPushed, 'X re-published after the tombstone row landed');
  const xPlain = await rowPlain(X, SB[dataRows[0]]);
  ok(Array.isArray(xPlain.gone) && xPlain.gone.indexOf(TEA) !== -1, 'the union keeps the tombstone (gone carries tea1)');
  ok(!(xPlain.users || []).some(function (u) { return u.username === TEA; }), 'the deleted account is NOT back on the row (no resurrection)');
  ok((xPlain.users || []).some(function (u) { return u.username === ADMIN; }), 'the union still carries the live accounts');
  ok((xPlain.users || []).some(function (u) { return u.username === XCOL; }), "X's new local account travelled (the push was real, not skipped)");
  const xAuth2 = JSON.parse(X.w.localStorage.getItem('spr-auth-v1') || 'null');
  ok(!(xAuth2 && xAuth2.users.some(function (u) { return u.username === TEA; })), 'X self-corrects locally (its stale tea1 copy is dropped)');

  /* ---------- S12 (round8): the five push rules, each against the mock ----------
     R1 account-event pushes are never dropped (held dialog / signed-out /
     in-flight); R2 a push that finishes after an account event is followed by
     another; R3 a stale copy never overwrites a newer row (tombstone wins);
     R4 failed pushes retry 4s/8s/16s/30s, survive reload, silent for 2 min;
     R5 after a reset a fresh browser bootstraps within the app's own timers. */
  console.log('== S12 (round8): push rules R1-R5 ==');
  const ROW = dataRows[0];
  const asumNow = function () { syncSB(Bt); return (SB[ROW] || {}).payload ? SB[ROW].payload.asum : null; };
  async function driveReset(B, user, pw) {
    B.w.location.hash = '#/manage';
    /* the manage panel re-renders after pushes (nodes get replaced): retry the
       open-click until the dialog is really up, then re-query before saving */
    let opened = false;
    for (let attempt = 0; attempt < 8 && !opened; attempt++) {
      const ob = B.d.querySelector('[data-action="acct-reset-open"][data-user="' + user + '"]');
      if (ob) click(B, ob);
      opened = await waitFor(function () { return !!B.d.getElementById('rpPass'); }, 2000);
    }
    if (!opened) throw new Error('reset dialog never opened for ' + user);
    setVal(B, B.d.getElementById('rpPass'), pw);
    setVal(B, B.d.getElementById('rpConf'), pw);
    const go = B.d.querySelector('[data-action="acct-reset"][data-user="' + user + '"]');
    if (go) click(B, go);
  }
  /* setup: a second teacher account exists and reached the row */
  syncSB(Bt);
  const a0 = asumNow();
  click(Bt, Bt.d.querySelector('[data-action="acct-add-open"]'));
  await waitFor(function () { return !!Bt.d.getElementById('naUser'); }, 6000);
  setVal(Bt, Bt.d.getElementById('naUser'), 'tea2');
  setVal(Bt, Bt.d.getElementById('naName'), 'Teacher Two');
  setVal(Bt, Bt.d.getElementById('naPass'), 'tea2-pass-1');
  setVal(Bt, Bt.d.getElementById('naConf'), 'tea2-pass-1');
  click(Bt, Bt.d.querySelector('[data-action="acct-add"]'));
  ok(await waitFor(function () { return asumNow() !== a0; }, 45000), 'R1(new account): creation reached the data row');

  /* ---- R1a + R5: a background pull-check must never park the reset push ---- */
  {
    /* Deterministic replay of the S8 flake. Facts that make the bug fire:
       (1) the row's seal ts is a few seconds NEWER than the device's boot
           floor (the floor is the last LOCAL save; the push seals after it),
       so the background sign-in check sees "cloud strictly newer";
       (2) the check's row read is stretched (slow GET), and the admin's
           password reset lands locally WHILE the check is still reading -
           its local-sum compare then sees differing sums against a "newer"
           cloud row, which on the unfixed build opens a MODAL DECISION
           DIALOG from a NON-INTERACTIVE check and holds every push until a
           human answers it. */
    click(Bt, Bt.d.querySelector('[data-action="logout"]'));
    await sleep(400);
    Bt = reboot(Bt);
    await sleep(700);
    Bt.w.__SB_SLOW_GET = 6000;   /* stretch the background check's row read */
    loginAs(Bt, ADMIN, PW);
    await waitFor(function () { return !Bt.d.body.classList.contains('auth-gate'); }, 60000);
    await ackPrivacy(Bt);
    /* wait until the 1.5 s sign-in pull-check has STARTED (its GET hangs 6 s) */
    await waitFor(function () {
      return (Bt.w.SPR_SYNC_TEST.pushLog() || []).some(function (l) { return /pull-check: start/.test(l); });
    }, 20000);
    /* the account event fires while that check is mid-flight */
    const a1 = asumNow();
    const tReset = Date.now();
    const rp1 = driveReset(Bt, 'tea2', 'tea2-pass-2');
    Bt.w.__SB_SLOW_GET = 0;   /* only the in-flight read stays slow; the reset's own push reads fast */
    await rp1;
    /* either the background check opens a decision modal (the round7 bug) or
       the sign-in tail drains with no dialog at all (the fix) */
    await waitFor(function () {
      const dl = Bt.d.getElementById('dlg');
      if (dl && dl.open && /newer copy is in the cloud/i.test(dl.textContent || '')) return true;
      return !holdOf(Bt) && !pendingOf(Bt);
    }, 60000);
    const dl1 = Bt.d.getElementById('dlg');
    const bgModal = !!(dl1 && dl1.open && /newer copy is in the cloud/i.test(dl1.textContent || ''));
    ok(!bgModal, 'R1: background pull-check opened NO decision dialog (passive notice instead)');
    /* the reset must land even though that check just ran mid-flight */
    const landed = await waitFor(function () { return asumNow() !== a1; }, 60000);
    const tLand = Date.now() - tReset;
    ok(landed, 'R1(reset): re-keyed account reached the data row (not dropped by any hold)');
    ok(landed && tLand <= 15000, 'R5: reset landed in ' + tLand + ' ms (prompt push; one 4 s retry ceiling after a held check)');
    if (landed && tLand > 15000) {
      /* diagnosis only: prove WHERE the extra time went (app timers vs machine) */
      console.log('    [r5diag] tLand=' + tLand + ' ms; push decisions since reset:');
      (Bt.w.SPR_SYNC_TEST.pushLog() || []).slice(-10).forEach(function (l) { console.log('      ' + l); });
    }
    /* R5 latency proof: once the hold released, the resume push must fire
       IMMEDIATELY (scheduleSyncPush(0)) — the pre-fix build debounced it 4 s
       (measured 3.7 s in docs/qa/round8 evidence), stacking a second 4 s
       miss-window under load (gate-b run 6: 18.7 s). */
    {
      const log = (Bt.w.SPR_SYNC_TEST.pushLog() || []);
      const tsGap = function (l) { const p = l.trim().split(' ')[0].split(':'); return (+p[0]) * 3600 + (+p[1]) * 60 + parseFloat(p[2]); };
      let gap = -1;
      for (let i = log.length - 1; i >= 0; i--) {
        if (/pull-check: done/.test(log[i])) {
          for (let j = i + 1; j < log.length; j++) if (/sent ok|^.*skip:/.test(log[j])) { gap = tsGap(log[j]) - tsGap(log[i]); break; }
          break;
        }
      }
      ok(gap >= 0 && gap <= 3000, 'R5: resume push fired ' + (gap < 0 ? 'n/a' : Math.round(gap * 1000) + ' ms') + ' after the hold released (immediate resume, no 4 s debounce)');
    }
    /* fresh browser bootstraps with the new password right away */
    const G8 = boot();
    await sleep(300);
    await ackGate(G8);
    const g8In = await loginCloudAs(G8, 'tea2', 'tea2-pass-2');
    ok(g8In, 'R5: fresh browser bootstraps via the explicit lookup with the reset password');
    if (!g8In) console.log('    [r5diag] lookup failure mode: ' + LAST_LOOKUP_FAIL);
    if (bgModal) { const cb = Bt.d.querySelector('#dlg [data-x="0"]'); if (cb) click(Bt, cb); }   /* round7: release the stuck dialog for the sections below */
  }

  /* ---- R1b: a wanted push survives a brief signed-out state ---- */
  {
    Bt.w.__SB_SLOW_GET = 3000;   /* the prompt push stalls in its row read */
    syncSB(Bt);
    const a2 = asumNow();
    driveReset(Bt, 'tea2', 'tea2-pass-3');
    /* condition, not a sleep: wait until the reset ARMED its push (the want is
       persisted) — only then does the sign-out below actually interrupt a
       live push chain instead of racing the handler's crypto tail */
    const wantArmed = await waitFor(function () { return pendingOf(Bt); }, 30000);
    ok(wantArmed, 'R1(signed-out precondition): the reset armed its push before the sign-out');
    click(Bt, Bt.d.querySelector('[data-action="logout"]'));   /* sign out while the chain is live */
    await sleep(400);
    Bt = reboot(Bt);
    Bt.w.__SB_SLOW_GET = 0;
    await sleep(700);
    loginAs(Bt, ADMIN, PW);
    await waitFor(function () { return !Bt.d.body.classList.contains('auth-gate'); }, 60000);
    await ackPrivacy(Bt);
    ok(await waitFor(function () { return asumNow() !== a2; }, 45000), 'R1(signed-out): the pending push survived the sign-out and landed after re-sign-in');
  }

  /* ---- R1c + R2: coalesce with an in-flight push, then re-run ---- */
  {
    Bt.w.__SB_SLOW_GET = 3000;
    Bt.w.__SB_SLOW_SAVE = 3500;
    syncSB(Bt);
    const a3 = asumNow();
    Bt.w.location.hash = '#/entry/sp';
    await waitFor(function () { return !!Bt.d.querySelector('input.cell'); }, 10000);
    setVal(Bt, Bt.d.querySelector('input.cell'), '9');   /* 4 s debounce push starts */
    await sleep(5200);                                   /* it is now reading/sealing (both hangs active) */
    await driveReset(Bt, 'tea2', 'tea2-pass-4');          /* account event while the first push is in flight */
    ok(await waitFor(function () { return asumNow() !== a3; }, 35000), 'R1(in-flight): account event coalesced with the running push and landed after it');
    Bt.w.__SB_SLOW_GET = 0;
    Bt.w.__SB_SLOW_SAVE = 0;
    const rp = await rowPlain(Bt, SB[ROW]);
    const localUsers = JSON.parse(Bt.w.localStorage.getItem('spr-auth-v1') || '{}').users || [];
    const rowTea2 = (rp.users || []).find(function (u) { return u.username === 'tea2'; }) || null;
    const locTea2 = localUsers.find(function (u) { return u.username === 'tea2'; }) || null;
    ok(!!(rowTea2 && locTea2 && JSON.stringify(rowTea2.login) === JSON.stringify(locTea2.login)), 'R2: the follow-up push carried the re-keyed account (row asum matches local state)');
  }

  /* ---- R3: a device holding the deleted account cannot resurrect it ---- */
  {
    syncSB(Bt);
    const preDel2 = JSON.stringify(SB[ROW]);
    click(Bt, Bt.d.querySelector('[data-action="acct-del"][data-user="tea2"]'));
    await sleep(150);
    click(Bt, Bt.d.querySelector('#dlg [data-x="1"]'));
    const goneLanded = await waitFor(async function () {
      syncSB(Bt);
      try { const pl = await rowPlain(Bt, SB[ROW]); return Array.isArray(pl.gone) && pl.gone.indexOf('tea2') !== -1; } catch (e) { return false; }
    }, 60000);
    ok(goneLanded, 'R3: deletion tombstone reached the row');
    /* device Z honestly holds the pre-deletion copy (tea2 still listed) */
    const zLS = {};
    for (let i = 0; i < Bt.w.localStorage.length; i++) { const k = Bt.w.localStorage.key(i); zLS[k] = Bt.w.localStorage.getItem(k); }
    { const au = JSON.parse(zLS['spr-auth-v1']); au.users.push({ username: 'tea2', name: 'Teacher Two', role: 'teacher', keyring: {}, login: { v: 1 } }); zLS['spr-auth-v1'] = JSON.stringify(au); }
    const Z = boot(zLS);
    await sleep(300);
    await ackGate(Z);
    loginAs(Z, ADMIN, PW);
    await waitFor(function () { return !Z.d.body.classList.contains('auth-gate'); }, 60000);
    await ackPrivacy(Z);
    /* release any decision hold (round7 opens a dialog here; the fixed app does not) */
    for (let d = 0; d < 10 && holdOf(Z); d++) {
      const dl = Z.d.getElementById('dlg');
      if (dl && dl.open) { const cb = Z.d.querySelector('#dlg [data-x="0"]') || Z.d.querySelector('#dlg [data-x="1"]'); if (cb) click(Z, cb); }
      await sleep(700);
    }
    const zCfg = JSON.parse(Z.w.localStorage.getItem('spr-devicesync-v1'));
    zCfg.lastResult = 'fail'; Z.w.localStorage.setItem('spr-devicesync-v1', JSON.stringify(zCfg));
    await Z.w.SPR_DEBUG_DS.push();
    const zPushed = await waitFor(function () {
      syncSB(Z);
      const r = SB[ROW];
      return !!(r && r.payload && r.payload.sum && r.payload.sum !== JSON.parse(preDel2).payload.sum);
    }, 60000);
    ok(zPushed, 'R3: the stale device still published its merge (new content travelled)');
    const zp = await rowPlain(Z, SB[ROW]);
    ok(Array.isArray(zp.gone) && zp.gone.indexOf('tea2') !== -1, 'R3: tombstone wins — gone carries tea2 after the stale push');
    ok(!(zp.users || []).some(function (u) { return u.username === 'tea2'; }), 'R3: no resurrection — tea2 is not back on the row');
    const zAuth = JSON.parse(Z.w.localStorage.getItem('spr-auth-v1') || 'null');
    ok(!(zAuth && zAuth.users.some(function (u) { return u.username === 'tea2'; })), 'R3: the stale device self-corrected locally');
  }

  /* ---- R4: retry ladder 4/8/16/30, reload survival, 2-minute silence ---- */
  {
    /* R4 owns its failure epoch: clear any failure state earlier sections
       left in the shared cfg, so the 2-minute clock starts at R4's own first
       failure (this section manufactures them on purpose) */
    { const c0 = JSON.parse(Bt.w.localStorage.getItem('spr-devicesync-v1') || '{}'); delete c0.failSince; delete c0.failCount; delete c0.lastResult; Bt.w.localStorage.setItem('spr-devicesync-v1', JSON.stringify(c0)); }
    const baseLines = new Set(Bt.w.SPR_SYNC_TEST.pushLog() || []);
    Bt.w.__SB_FAIL_SAVE = 1;   /* every data-row write returns HTTP 500 */
    Bt.w.location.hash = '#/entry/sp';
    await waitFor(function () { return !!Bt.d.querySelector('input.cell'); }, 10000);
    setVal(Bt, Bt.d.querySelector('input.cell'), '3');
    const sendTimes = [];
    const ladderOk = await waitFor(function () {
      (Bt.w.SPR_SYNC_TEST.pushLog() || []).forEach(function (line) {
        if (/send:/.test(line) && !baseLines.has(line) && sendTimes.indexOf(line) === -1) sendTimes.push(line);
      });
      return sendTimes.length >= 4;   /* initial attempt + 3 retries */
    }, 90000);
    const ts = function (line) { const p = line.trim().split(' ')[0].split(':'); return (+p[0]) * 3600 + (+p[1]) * 60 + parseFloat(p[2]); };
    let gaps = [];
    if (sendTimes.length >= 4) { const t = sendTimes.map(ts); gaps = [t[1] - t[0], t[2] - t[1], t[3] - t[2]]; }
    /* the POLICY is asserted from the app's own arming decisions (trace), not
       from wall-clock gaps: timer slip under CPU contention delays the FIRE
       time but not the schedule the app programmed. Gaps stay informational. */
    const delaysInOrder = [];
    { /* first-seen order of distinct ladder delays == the ladder the app armed */
      const seen = new Set();
      (Bt.w.SPR_SYNC_TEST.pushLog() || []).forEach(function (line) {
        const m = /retry ladder: next in (\d+)ms/.exec(line);
        if (m && !seen.has(+m[1])) { seen.add(+m[1]); delaysInOrder.push(+m[1]); }
      });
    }
    ok(ladderOk && delaysInOrder.length >= 3 && delaysInOrder[0] === 4000 && delaysInOrder[1] === 8000 && delaysInOrder[2] === 16000,
       'R4: retry ladder arms 4 s / 8 s / 16 s (armed ' + (delaysInOrder.join(' / ') || 'n/a') + ' ms; measured gaps ' + (gaps.map(function (g) { return g.toFixed(1); }).join(', ') || 'n/a') + ' s)');
    /* silence: nothing user-visible while failing < 2 minutes */
    const cfg4 = JSON.parse(Bt.w.localStorage.getItem('spr-devicesync-v1') || '{}');
    ok(cfg4.pendingPush === true, 'R4: the pending push flag is persisted while retries run');
    Bt.w.location.hash = '#/manage';
    await waitFor(function () { return !!Bt.d.querySelector('[data-action="ds-now"]'); }, 8000);
    /* visible PANELS only: body.textContent also carries the inline <script>
       source, which contains these sentences as string literals */
    const panelTxt = function () { return Array.prototype.map.call(Bt.d.querySelectorAll('.panel'), function (p) { return p.textContent || ''; }).join('\n'); };
    ok(!/Last cloud save failed|Cloud copy is behind/i.test(panelTxt()), 'R4: silent while the failure is younger than 2 minutes');
    /* after 2 minutes: exactly the honest sentence */
    cfg4.failSince = new Date(Date.now() - 121000).toISOString();
    Bt.w.localStorage.setItem('spr-devicesync-v1', JSON.stringify(cfg4));
    Bt.w.location.hash = '#/dashboard';
    await sleep(150);
    Bt.w.location.hash = '#/manage';
    await waitFor(function () { return !!Bt.d.querySelector('[data-action="ds-now"]'); }, 8000);
    ok(panelTxt().indexOf('Cloud copy is behind. Your data on this device is safe.') !== -1,
       'R4: after 2 minutes the sync card says the data on this device is safe');
    /* reload survival: the want is still armed after a restart, then lands */
    const Bt5 = reboot(Bt);
    await waitFor(function () { return !!Bt5.d.querySelector('[data-action="logout"]') || !Bt5.d.body.classList.contains('auth-gate'); }, 60000);
    if (Bt5.d.body.classList.contains('auth-gate')) loginAs(Bt5, ADMIN, PW);   /* session may have restored itself */
    await waitFor(function () { return !Bt5.d.body.classList.contains('auth-gate'); }, 60000);
    ok(await waitFor(function () { const c = JSON.parse(Bt5.w.localStorage.getItem('spr-devicesync-v1') || '{}'); return c.lastResult === 'ok'; }, 45000),
       'R4: the persisted want pushed through once the cloud was reachable again');
    Bt = Bt5;
  }

  console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL DEVICE-SYNC CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
