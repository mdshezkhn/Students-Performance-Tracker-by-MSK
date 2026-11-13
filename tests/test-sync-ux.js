/* Demo-eve sync UX suite (2026-11-11): the cross-device sign-in journey a
   manager actually takes. Written BEFORE the implementation (TDD).
   U1: a fresh browser that fails sign-in gets a ONE-TAP button that opens
       the "I use SPR on another device" dialog (no hunting for the link).
   U2: "no cloud copy" must say exactly what the administrator has to do
       (Manage → Device sync), not a dead end.
   U3: cloud unreachable must be plain language + next step (backup file),
       no raw fetch jargon.
   U4: the Users page shows a sync status line (on/off + last cloud save).
   U5 (regression, should already pass): account created on store A
       restores on an empty store B through the other-device route. */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;

function requireJSDOM() {
  try { return require('jsdom'); }
  catch (e) { return require(path.join(__dirname, '../../test/node_modules/jsdom')); }
}
const { JSDOM, VirtualConsole } = requireJSDOM();

const appHtmlPath = ['../app/index.html', '../dist/app/index.html']
  .map((rel) => path.join(__dirname, rel))
  .find((p) => fs.existsSync(p));
if (!appHtmlPath) { console.log('FAIL: no app build found (run: python source/build2.py)'); process.exit(1); }
const html0 = fs.readFileSync(appHtmlPath, 'utf8');

/* fake Supabase REST — same table semantics as test-device-sync.js */
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
  '  return Promise.resolve(function () {' +
  '   var b = JSON.parse(opts.body);' +
  '   if (SB[b.id]) return H(409);' +
  '   SB[b.id] = { id: b.id, share_name: b.share_name || null, pushed_by: b.pushed_by || null, pushed_at: b.pushed_at, payload: b.payload };' +
  '   return H(201);' +
  '  }());' +
  ' }' +
  ' if (opts.method === "PATCH") {' +
  '  return Promise.resolve(function () {' +
  '   if (!SB[chan]) return H(404);' +
  '   var p = JSON.parse(opts.body); Object.keys(p).forEach(function (k) { SB[chan][k] = p[k]; });' +
  '   return H(204);' +
  '  }());' +
  ' }' +
  ' if (opts.method === "DELETE") { delete SB[chan]; return Promise.resolve(H(204)); }' +
  ' if (!opts.method || opts.method === "GET") return Promise.resolve(H(200, chan && SB[chan] ? [SB[chan]] : []));' +
  ' return Promise.resolve(H(200, chan && SB[chan] ? [SB[chan]] : []));' +
  '}';
let SB = {};
function syncSB(B) { SB = JSON.parse(JSON.stringify(B.w.__SB || {})); }

function sha256HexSync(s) {
  return require('crypto').createHash('sha256').update(s).digest('hex');
}
function dsChanId(username) {
  const h = sha256HexSync('spr-ds1:chan:' + String(username).trim().toLowerCase());
  const variant = ((parseInt(h.slice(16, 20), 16) & 0x3fff) | 0x8000).toString(16).padStart(4, '0');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' + variant + '-' + h.slice(20, 32);
}

let bootId = 0;
function boot(preStorage, preSession, opts) {
  opts = opts || {};
  const pre =
    (preStorage ? Object.keys(preStorage).map((k) => 'try{localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(preStorage[k]) + ')}catch(e){}').join('') : '') +
    (preSession ? Object.keys(preSession).map((k) => 'try{sessionStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(preSession[k]) + ')}catch(e){}').join('') : '');
  const netFail = opts.netFail ? 'window.fetch=function(){return Promise.reject(new TypeError("Failed to fetch"))};' : '';
  const stub = '<script>' + pre +
    'window.__SB=' + JSON.stringify(SB) + ';' +
    'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
    'window.__downloads=[];' +
    'try{var oc=HTMLAnchorElement.prototype.click;' +
    'HTMLAnchorElement.prototype.click=function(){if(this.download)window.__downloads.push(this.download);return oc.apply(this,arguments)}}catch(e){}' +
    '(function(){var d=document.getElementById("dlg");if(d&&!d.showModal){d.showModal=function(){this.open=true};d.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();' +
    'window.__BOOT=' + (bootId++) + ';' +
    'window.fetch=' + SB_FETCH_SRC + ';' + netFail +
    '</script>';
  const i = html0.lastIndexOf('</body>');
  const html = html0.slice(0, i) + stub + html0.slice(i);
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  vc.on('log', () => {});
  vc.on('warn', () => {});
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/app/index.html#/dashboard', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) { /* already set */ }
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  const RBd = w.Blob;
  w.Blob = function (parts, o) { const b = new RBd(parts, o); if (parts && parts.length && typeof parts[0] === 'string') b.__TEXT = parts[0]; return b; };
  w.URL.createObjectURL = w.URL.createObjectURL || (function () { return 'blob:dsux-' + (++bootId); });
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
  if (b && B.d.getElementById('dlg') && B.d.getElementById('dlg').open) { click(B, b); await sleep(300); }
}
async function ackPrivacy(B) {
  const d = B.d.getElementById('dlg');
  if (d && d.open && d.textContent.includes('Privacy') && B.d.querySelector('[data-action="privacy-ack"]')) {
    click(B, B.d.querySelector('[data-action="privacy-ack"]'));
    await sleep(300);
  }
}
function reboot(B) {
  const ls = {}, ss = {};
  for (let i = 0; i < B.w.localStorage.length; i++) { const k = B.w.localStorage.key(i); ls[k] = B.w.localStorage.getItem(k); }
  for (let i = 0; i < B.w.sessionStorage.length; i++) { const k = B.w.sessionStorage.key(i); ss[k] = B.w.sessionStorage.getItem(k); }
  return boot(ls, ss);
}
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return true; await sleep(350); }
  return cond();
}
function cfgOf(B) { try { return JSON.parse(B.w.localStorage.getItem('spr-devicesync-v1') || 'null'); } catch (e) { return null; } }

(async () => {
  const ADMIN = 'mo', PW = 'sync-ux-pass-1', MGR = 'cindy', MGPW = 'cindy-pass-1';

  /* ---------- U1 + U2: fresh browser, wrong-route sign-in ---------- */
  console.log('== U1/U2: fresh-browser sign-in dead end + one-tap route ==');
  const F = boot();
  await waitFor(() => !!(F.d.getElementById('dlg') && F.d.getElementById('dlg').open), 10000);
  await ackGate(F);
  setVal(F, F.d.getElementById('loginUser'), MGR);
  setVal(F, F.d.getElementById('loginPass'), MGPW);
  click(F, F.d.querySelector('[data-action="do-login"]'));
  await waitFor(() => (F.d.getElementById('loginErr') || {}).textContent, 20000);
  const errTxt = String((F.d.getElementById('loginErr') || {}).textContent || '');
  ok(/no accounts/i.test(errTxt), 'plain sign-in on a fresh device explains there are no local accounts');

  /* U1: one tap from the error to the other-device route */
  const odGo = F.d.getElementById('loginOdGo');
  ok(!!odGo && /another device|cloud copy/i.test(odGo.textContent), 'one-tap "pull my cloud copy" button appears with the error');
  if (odGo) {
    click(F, odGo);
    const odOpen = await waitFor(() => !!(F.d.getElementById('odUser') && F.d.getElementById('dlg') && F.d.getElementById('dlg').open), 5000);
    ok(odOpen, 'tapping it opens the other-device dialog immediately');
  }

  /* U2: no cloud copy -> the message must name the admin's steps */
  if (F.d.getElementById('odUser')) {
    setVal(F, F.d.getElementById('odUser'), MGR);
    setVal(F, F.d.getElementById('odPass'), MGPW);
    click(F, F.d.querySelector('#dlg [data-x="1"]'));
    await waitFor(() => /No cloud copy|Device sync|not be reached|could not be reached/i.test(String((F.d.getElementById('odErr') || {}).textContent || '')), 15000);
    const odErr = String((F.d.getElementById('odErr') || {}).textContent || '');
    ok(/Device sync/.test(odErr) && /Manage/.test(odErr), 'no-cloud-copy error names the admin steps (Manage → Device sync): "' + odErr.slice(0, 90) + '…"');
    ok(!/device sync may not be set up\)/.test(odErr), 'old dead-end wording is gone');
  } else {
    ok(false, 'other-device dialog never opened (U1 button missing)');
  }

  /* ---------- U3: cloud unreachable -> plain language ---------- */
  console.log('== U3: cloud unreachable message ==');
  const N = boot(null, null, { netFail: true });
  await waitFor(() => !!(N.d.getElementById('dlg') && N.d.getElementById('dlg').open), 10000);
  await ackGate(N);
  click(N, N.d.querySelector('[data-action="login-other-device"]'));
  await sleep(250);
  setVal(N, N.d.getElementById('odUser'), MGR);
  setVal(N, N.d.getElementById('odPass'), MGPW);
  click(N, N.d.querySelector('#dlg [data-x="1"]'));
  await waitFor(() => /could not be reached|not be reached|unreachable|No cloud copy|Wrong password/i.test(String((N.d.getElementById('odErr') || {}).textContent || '')), 20000);
  const nErr = String((N.d.getElementById('odErr') || {}).textContent || '');
  ok(/not be reached|could not be reached|unreachable/i.test(nErr), 'network failure reads as "cloud not reachable": "' + nErr.slice(0, 80) + '…"');
  ok(/backup/i.test(nErr), 'network failure offers the backup-file next step');
  ok(!/Failed to fetch|TypeError/i.test(nErr), 'no raw browser jargon in the message');

  /* ---------- shared store A: owner + sync + manager account ---------- */
  console.log('== store A: owner setup, sync on, manager created ==');
  const A = boot();
  await waitFor(() => !!(A.d.getElementById('dlg') && A.d.getElementById('dlg').open), 10000);
  await ackGate(A);
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
      const mpw = dl.querySelector('#mrPw');
      if (mpw) { mpw.value = 'Master-ux-' + Math.random().toString(36).slice(2, 8); mpw.dispatchEvent(new A.w.Event('input', { bubbles: true })); }
      const mst = dl.querySelector('[data-action="recovery-master"]');
      if (mst) mst.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
      await sleep(3000);
      const kb = dl.querySelector('[data-action="owner-kit-dl"]');
      for (let t2 = 0; t2 < 30 && (!kb || kb.disabled); t2++) { await sleep(300); }
      if (kb && !kb.disabled) kb.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
      await sleep(150);
      const cb = dl.querySelector('#recoverySaved'); if (cb && !cb.disabled) { cb.checked = true; cb.dispatchEvent(new A.w.Event('change', { bubbles: true })); }
      await sleep(150);
      dl.querySelector('[data-action="recovery-ack"]').dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
      break;
    }
  }
  await waitFor(() => !A.d.body.classList.contains('auth-gate'), 60000);
  await ackPrivacy(A);
  ok(!A.d.body.classList.contains('auth-gate'), 'owner signed in on store A');
  A.w.location.hash = '#/manage';
  await sleep(300);
  const enBtn = A.d.querySelector('[data-action="ds-enable"]');
  ok(!!enBtn, 'Turn on device sync present');
  click(A, enBtn);
  await sleep(300);
  confirmYes(A);   /* "Turn on device sync?" */
  const pushed = await waitFor(() => (cfgOf(A) || {}).lastResult === 'ok', 45000);
  ok(pushed, 'first cloud save landed (cfg.lastResult=ok)');
  syncSB(A);

  /* ---------- U4: Users page sync status ---------- */
  console.log('== U4: Users page sync status line ==');
  A.w.location.hash = '#/users';
  await sleep(400);
  const st = A.d.getElementById('dsSyncStatus');
  ok(!!st, 'sync status element exists on the Users page');
  if (st) {
    ok(/Device sync:\s*ON/i.test(st.textContent), 'status reads "Device sync: ON"');
    ok(/last cloud save/i.test(st.textContent), 'status shows the last cloud save time');
  }

  /* create the manager through the real Users dialog */
  const addBtn = A.d.querySelector('[data-action="acct-add-open"]');
  ok(!!addBtn, 'Add account button on Users page');
  click(A, addBtn);
  await sleep(200);
  setVal(A, A.d.getElementById('naUser'), MGR);
  setVal(A, A.d.getElementById('naName'), 'Cindy');
  setVal(A, A.d.getElementById('naRole'), 'management');
  setVal(A, A.d.getElementById('naPass'), MGPW);
  setVal(A, A.d.getElementById('naConf'), MGPW);
  click(A, A.d.getElementById('naGo'));
  const mgrMade = await waitFor(() => {
    try { return JSON.parse(A.w.localStorage.getItem('spr-auth-v1')).users.some((u) => u.username === MGR); } catch (e) { return false; }
  }, 20000);
  ok(mgrMade, 'manager account created on store A');
  /* force the account-event push to completion so store B sees a deterministic
     cloud state (production would debounce this by a few seconds) */
  await waitFor(async () => (await A.w.SPR_DEBUG_DS.push()) === true, 45000);
  syncSB(A);
  const ptrLanded = await waitFor(() => {
    syncSB(A);
    const row = SB[dsChanId(MGR)];
    return !!(row && row.payload && row.payload.sprPTR === 1);
  }, 30000);
  ok(ptrLanded, 'cloud pointer row for the manager exists (written at account creation)');
  const dataLanded = await waitFor(() => {
    syncSB(A);
    const row = SB[dsChanId(ADMIN)];
    return !!(row && row.payload && row.payload.sprDS === 1 && row.payload.wrap);
  }, 45000);
  ok(dataLanded, 'cloud data row for the school exists and carries the password wrap');

  /* ---------- U5: empty store B restores the manager via the cloud ---------- */
  console.log('== U5: second store restores the manager ==');
  const Bs = [boot()];   /* fresh, empty — but shares the same fake cloud */
  const B = Bs[0];
  await waitFor(() => !!(B.d.getElementById('dlg') && B.d.getElementById('dlg').open), 10000);
  await ackGate(B);
  click(B, B.d.querySelector('[data-action="login-other-device"]'));
  await sleep(250);
  setVal(B, B.d.getElementById('odUser'), MGR);
  setVal(B, B.d.getElementById('odPass'), MGPW);
  click(B, B.d.querySelector('#dlg [data-x="1"]'));
  const confirmShown = await waitFor(() => /Open the cloud copy here/.test(dlgText(B)), 45000);
  ok(confirmShown, 'cloud copy found for the manager (confirm shown)');
  if (!confirmShown) console.log('    [U5diag] odErr="' + String((B.d.getElementById('odErr') || {}).textContent || '').slice(0, 200) + '" dlg="' + dlgText(B).replace(/\s+/g, ' ').slice(0, 160) + '"');
  if (confirmShown) confirmYes(B);
  const inOk = await waitFor(() => !B.d.body.classList.contains('auth-gate'), 60000);
  ok(inOk, 'manager signed in on store B through the other-device route');
  let sess = null; try { sess = JSON.parse(B.w.localStorage.getItem('spr-auth-v1') || 'null'); } catch (e) {}
  ok(!!sess && sess.session && sess.session.username === MGR, 'signed-in account is the manager (' + ((sess && sess.session && sess.session.username) || 'none') + ')');
  ok(!!sess && (sess.users || []).some((u) => u.username === ADMIN) && (sess.users || []).some((u) => u.username === MGR), 'both accounts arrived on store B');

  /* ---------- U6 (regression, 2026-11-12): the Cloud-connection dialog's
     Close button used data-x="close" with no handler — clicking it did
     nothing (a reload was needed). The fix routes it through the global
     data-action="dlg-close" handler; this must stay wired. ---------- */
  console.log('== U6: Cloud-connection dialog Close button ==');
  A.w.location.hash = '#/manage';
  await sleep(400);
  const tBtn = A.d.querySelector('[data-action="ds-test"]');
  ok(!!tBtn, 'Test cloud connection button present on Manage');
  if (tBtn) {
    click(A, tBtn);
    const dlgShown = await waitFor(() => !!(A.d.getElementById('dlg') && A.d.getElementById('dlg').open && /Cloud connection/.test(dlgText(A))), 10000);
    ok(dlgShown, 'cloud-connection dialog opens');
    const closeBtn = A.d.querySelector('#dlg [data-action="dlg-close"]');
    ok(!!closeBtn, 'dialog Close button is wired (data-action="dlg-close")');
    ok(!A.d.querySelector('#dlg [data-x="close"]'), 'no dead data-x="close" button in the dialog');
    if (dlgShown && closeBtn) {
      click(A, closeBtn);
      await sleep(300);
      ok(!(A.d.getElementById('dlg') || {}).open, 'Close actually closes the dialog (no reload needed)');
    }
  }

  console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL SYNC-UX CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
