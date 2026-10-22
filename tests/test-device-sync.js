/* Device-sync account bootstrap suite (jsdom, real node webcrypto).
   Verifies: fresh-browser login card, account-channel push with password
   wrap, sign-in-only restore on a second browser, wrong-password rejection,
   and cloud-copy adoption on a browser that has its own local sign-ins. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, '../../test/node_modules/jsdom'));
const webcrypto = require('crypto').webcrypto;

const html0 = fs.readFileSync(path.join(__dirname, '../dist/app/index.html'), 'utf8');

/* ---- fake Supabase REST: table lives INSIDE the jsdom window (window.__SB);
       the Node-side SB mirror is serialized in at boot and synced back out ---- */
const SB_FETCH_SRC =
  'function (url, opts) {' +
  ' url = String(url); opts = opts || {};' +
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
  ' if (chan === undefined) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });' +
  ' if (opts.method === "POST") {' +
  '  var b = JSON.parse(opts.body);' +
  '  if (SB[b.id]) return Promise.resolve(H(409));' +
  '  SB[b.id] = { id: b.id, share_name: b.share_name || null, pushed_by: b.pushed_by || null, pushed_at: b.pushed_at, payload: b.payload };' +
  '  return Promise.resolve(H(201));' +
  ' }' +
  ' if (opts.method === "PATCH") {' +
  '  if (!SB[chan]) return Promise.resolve(H(404));' +
  '  var p = JSON.parse(opts.body); Object.keys(p).forEach(function (k) { SB[chan][k] = p[k]; });' +
  '  return Promise.resolve(H(204));' +
  ' }' +
  ' if (opts.method === "DELETE") { delete SB[chan]; return Promise.resolve(H(204)); }' +
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

function boot(preStorage, preSession) {
  const pre =
    (preStorage ? Object.keys(preStorage).map((k) => 'try{localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(preStorage[k]) + ')}catch(e){}').join('') : '') +
    (preSession ? Object.keys(preSession).map((k) => 'try{sessionStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(preSession[k]) + ')}catch(e){}').join('') : '');
  const stub = '<script>' + pre +
    'window.__SB=' + JSON.stringify(SB) + ';' +
    'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
    '(function(){var d=document.getElementById("dlg");if(d&&!d.showModal){d.showModal=function(){this.open=true};d.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();' +
    'window.fetch=' + SB_FETCH_SRC + ';' +
    '</script>';
  const i = html0.lastIndexOf('</body>');
  const html = html0.slice(0, i) + stub + html0.slice(i);
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented|canvas|navigation/i.test(String(e.message || e))) console.log('  jsdomError:', e.message); });
  vc.on('error', (m) => console.log('  console.error:', m));
  vc.on('log', () => {});
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/app/index.html#/dashboard', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) { /* already set */ }
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
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(400); }
  return cond();
}
function loginAs(B, user, pass) {
  setVal(B, B.d.getElementById('loginUser'), user);
  setVal(B, B.d.getElementById('loginPass'), pass);
  click(B, B.d.querySelector('[data-action="do-login"]'));
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
  await waitFor(function () { return !A.d.body.classList.contains('auth-gate'); }, 15000);
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
  }, 20000);
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
  const sessReady = await waitFor(function () { return !A2.d.body.classList.contains('auth-gate'); }, 15000);
  ok(sessReady, 'session restored after reload');
  A2.w.location.hash = '#/manage';
  await sleep(250);
  const enBtn = A2.d.querySelector('[data-action="ds-enable"]');
  ok(!!enBtn, 'Turn on device sync button present (Manage)');
  click(A2, enBtn);
  await sleep(200);
  confirmYes(A2);
  await sleep(1500);
  syncSB(A2);
  const rows = Object.keys(SB);
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
  await waitFor(function () { return !A3.d.body.classList.contains('auth-gate'); }, 20000);
  await ackPrivacy(A3);
  ok(!A3.d.body.classList.contains('auth-gate'), 'owner signed in again (fresh password session)');
  const wrapLanded = await waitFor(function () {
    syncSB(A3);
    return SB[rows[0]] && SB[rows[0]].payload.wrap;
  }, 25000);   // sign-in repair push: 4s debounce + PBKDF2 under load
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
  }, 25000);   // 300ms save debounce + 4s push debounce + PBKDF2 under load
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
    return ((Bb.d.getElementById('loginErr') || {}).textContent || '').indexOf('Invalid') !== -1;
  }, 20000);   // wrong-password unwrap still pays PBKDF2-310k under load
  ok(wrongPw, 'wrong password rejected');
  loginAs(Bb, ADMIN, PW);
  await waitFor(function () { return !Bb.d.body.classList.contains('auth-gate'); }, 20000);
  await ackPrivacy(Bb);
  ok(!Bb.d.body.classList.contains('auth-gate'), 'second browser signed in');
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
  loginAs(C, ADMIN, PW);
  const dlgUp = await waitFor(function () { return dlgText(C).indexOf('cloud copy') !== -1; }, 20000);
  ok(dlgUp, 'cloud-copy dialog offered for the unknown account');
  confirmYes(C);
  await waitFor(function () { return !C.d.body.classList.contains('auth-gate'); }, 20000);
  await ackPrivacy(C);
  ok(!C.d.body.classList.contains('auth-gate'), 'cloud account signed in on the non-fresh browser');
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
  await waitFor(function () { return !D.d.body.classList.contains('auth-gate'); }, 15000);
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
  }, 20000);
  ok(dReady, 'device D loaded its own data');
  let lastTs = -1;
  const quiet = await waitFor(function () {   // wait for the debounced seal to settle
    const a = (JSON.parse(D.w.localStorage.getItem('p4c4-markbook-v2') || '{}') || {}).ts || 0;
    const done = lastTs >= 0 && a === lastTs;
    lastTs = a;
    return done;
  }, 20000);
  ok(quiet, 'device D data settled before the browser restarts');
  const D2 = reboot(D);
  await waitFor(function () { return !!D2.d.querySelector('[data-action="logout"]'); }, 15000);   // shell re-renders only after the async session restore
  // sign out and back in — the fresh sign-in must offer the account's cloud copy
  click(D2, D2.d.querySelector('[data-action="logout"]'));
  await sleep(400);
  const D3 = reboot(D2);
  await sleep(700);
  loginAs(D3, ADMIN, PW);
  await waitFor(function () { return !D3.d.body.classList.contains('auth-gate'); }, 20000);
  await ackPrivacy(D3);
  const offerUp = await waitFor(function () { return dlgText(D3).indexOf('cloud copy') !== -1; }, 20000);
  ok(offerUp, 'sign-in on a same-account browser offers the cloud copy');
  click(D3, D3.d.querySelector('#dlg [data-x="0"]'));   // keep this device's data for now
  await sleep(400);
  D3.w.location.hash = '#/manage';
  await sleep(250);
  const enD = D3.d.querySelector('[data-action="ds-enable"]');
  ok(!!enD, 'device D sees Turn on device sync (Manage)');
  click(D3, enD);
  await sleep(200);
  confirmYes(D3);   // confirm "Turn on device sync?"
  const adoptUp = await waitFor(function () { return dlgText(D3).indexOf('cloud copy') !== -1; }, 20000);
  ok(adoptUp, 'adoption dialog offered instead of creating a second setup');
  syncSB(D3);
  const sumBefore = (SB[rows[0]] || {}).payload ? SB[rows[0]].payload.sum : null;
  confirmYes(D3);   // open the cloud copy
  await sleep(800);
  syncSB(D3);
  /* content sum, not ciphertext: another live window's legitimate wrap-refresh
     push re-seals with a fresh IV (ct changes) while the CONTENT stays equal */
  ok(SB[rows[0]] && SB[rows[0]].payload.sum === sumBefore, 'cloud row content NOT overwritten by device D');
  const cfgD = JSON.parse(D3.w.localStorage.getItem('spr-devicesync-v1') || 'null');
  ok(cfgD && cfgD.on === true && cfgD.channel === rows[0] && !!cfgD.key, 'device D adopted the account channel + key');
  const usersD = JSON.parse(D3.w.localStorage.getItem('spr-auth-v1') || 'null');
  ok(!!(usersD && Array.isArray(usersD.users) && usersD.users.some(function (u) { return u.username === ADMIN; })), 'cloud accounts installed on device D');

  /* ---------- S7: teacher transport on the paired device ---------- */
  console.log('== S7: teacher on a paired device (all-users transport) ==');
  const TEA = 'tea1', TEAPW = 'teacher-pass-1';
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
  }, 25000);
  ok(addPushed, 'teacher sign-in creation reached the cloud copy');
  ok(!!((SB[rows[0]] || {}).payload || {}).wrap, 'owner password wrap present before the teacher session');
  // sign out and back in as the teacher on this paired device
  click(Bb, Bb.d.querySelector('[data-action="logout"]'));
  await sleep(400);
  const Bt = reboot(Bb);
  await sleep(700);
  loginAs(Bt, TEA, TEAPW);
  await waitFor(function () { return !Bt.d.body.classList.contains('auth-gate'); }, 20000);
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
  await sleep(7000);
  syncSB(Bt);
  const wrapBeforeTea = (SB[rows[0]] || {}).payload ? SB[rows[0]].payload.wrap : null;
  const ctBeforeTea = (SB[rows[0]] || {}).payload ? SB[rows[0]].payload.ct : null;
  setVal(Bt, tCell, '6');
  const teaPushed = await waitFor(function () {
    syncSB(Bt);
    return SB[rows[0]] && SB[rows[0]].payload.ct !== ctBeforeTea;
  }, 35000);
  ok(teaPushed, 'teacher edit auto-pushed to the same cloud row');
  ok(String(SB[rows[0]].pushed_by || '').indexOf(TEA) !== -1, 'push credited to “device — ' + TEA + '” (got: ' + SB[rows[0]].pushed_by + ')');
  ok(JSON.stringify(SB[rows[0]].payload.wrap) === JSON.stringify(wrapBeforeTea), 'owner password wrap preserved by the teacher push');
  // a teacher account alone still cannot bootstrap a brand-new browser
  // (documented limit — pairing link / admin sign-in does that), and no
  // second cloud row (fork) is ever created
  const E = boot();
  await sleep(300);
  await ackGate(E);
  loginAs(E, TEA, TEAPW);
  const teaRejected = await waitFor(function () {
    return ((E.d.getElementById('loginErr') || {}).textContent || '').indexOf('Invalid') !== -1;
  }, 20000);
  ok(teaRejected, 'teacher fresh-browser sign-in alone is rejected (no fork, no leak)');
  syncSB(E);
  ok(Object.keys(SB).length === 1 && !!SB[rows[0]], 'still exactly one cloud row for the school');

  console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL DEVICE-SYNC CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
