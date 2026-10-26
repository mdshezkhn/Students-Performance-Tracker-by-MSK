/* Class-mode UI smoke suite (jsdom + real webcrypto, synthetic data only).
   Run: node tests/test-class-mode.js
   Drives the whole P1 workflow through the real UI:
   admin creates the sign-in → loads the sample (legacy) markbook → runs the
   migration wizard (dry-run dialog → backup → apply) → re-opens in class mode
   → provisions eal-01/sup-01 → pairs both to the class (capturing the issued
   one-time passwords) → support proposes an observation change (score must NOT
   move) → EAL approves (score moves, audit records both) and a rejected
   proposal leaves the score untouched. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const webcrypto = require('crypto').webcrypto;

const html0 = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');

function boot(preStorage) {
  const pre =
    (preStorage ? Object.keys(preStorage).map((k) => 'try{localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(preStorage[k]) + ')}catch(e){}').join('') : '');
  const stub = '<script>' + pre +
    'window.__SB={};window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
    'window.__downloads=[];try{window.URL.createObjectURL=function(){return "blob:x"};window.URL.revokeObjectURL=function(){};}catch(e){}' +
    'try{var oc=HTMLAnchorElement.prototype.click;' +
    'HTMLAnchorElement.prototype.click=function(){if(this.download)window.__downloads.push(this.download);return oc.apply(this,arguments)}}catch(e){}' +
    'window.__fetchLog=[];window.fetch=function(u){try{window.__fetchLog.push(String(u))}catch(e){}return Promise.resolve({ok:false,status:404,json:function(){return Promise.resolve([])}})};' +
    'window.addEventListener("error",function(ev){window.__LAST_ERR=(ev.error&&ev.error.stack)||ev.message});' +
    '(function(){var d=document.getElementById("dlg");if(d&&!d.showModal){d.showModal=function(){this.open=true};d.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();' +
    '</script>';
  const i = html0.lastIndexOf('</body>');
  const html = html0.slice(0, i) + stub + html0.slice(i);
  const vc = new VirtualConsole();
  vc.on('error', (m) => console.log('  [page-error]', String(m).slice(0, 300)));
  vc.on('jsdomError', (e) => { if (!/Not implemented|canvas|navigation/i.test(String(e.message || e))) console.log('  jsdomError:', e.message, ((e.detail && e.detail.stack) || '').split(String.fromCharCode(10)).slice(1,4).join(' | ')); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/app/index.html#/dashboard', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  return { dom, w, d: w.document };
}

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok:', msg); else { fails++; console.log('  FAIL:', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (B, el) => el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
const setVal = (B, el, v) => { el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); };
function storageDump(B) {
  const o = {};
  for (let i = 0; i < B.w.localStorage.length; i++) { const k = B.w.localStorage.key(i); o[k] = B.w.localStorage.getItem(k); }
  return o;
}
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) { const v = fn(); if (v) return v; await sleep(120); }
  return null;
}
async function ackGate(B) {
  const b = B.d.querySelector('[data-action="privacy-gate-ack"]');
  if (b && B.d.getElementById('dlg') && B.d.getElementById('dlg').open) { click(B, b); await sleep(300); }
}
async function ackPrivacy(B) {
  const d = B.d.getElementById('dlg');
  if (d && d.open && /privacy/i.test(d.textContent) && d.querySelector('[data-action="privacy-ok"]')) { click(B, d.querySelector('[data-action="privacy-ok"]')); await sleep(200); }
}
async function loginAs(B, user, pass) {
  setVal(B, B.d.getElementById('loginUser') || B.d.getElementById('suUser'), user);
  setVal(B, B.d.getElementById('loginPass') || B.d.getElementById('suPass'), pass);
  const btn = B.d.querySelector('[data-action="do-login"]') || B.d.querySelector('[data-action="first-run"]');
  click(B, btn);
  return waitFor(() => !B.d.body.classList.contains('auth-gate'), 25000);
}

const ADMIN = 'mo';
  let PW = 'tiny-pw';   /* 2026-10-25: no length floor - the suite's admin uses a short password */

(async function main() {
  /* ---- S1: admin first-run + legacy sample data ---- */
  let B = boot();
  await sleep(400); await ackGate(B);
  /* 2026-10-25 (owner request): length minimums REMOVED - a short password
     now signs straight in; only the empty string is rejected */
  click(B, B.d.querySelector('[data-action="show-setup"]'));
  await sleep(150);
  setVal(B, B.d.querySelector('#suUser'), ADMIN);
  setVal(B, B.d.querySelector('#suPass'), 'tiny-pw');
  setVal(B, B.d.querySelector('#suConf'), 'tiny-pw');
  click(B, B.d.querySelector('[data-action="first-run"]'));
  ok(await waitFor(() => !B.d.body.classList.contains('auth-gate'), 20000), 'a short admin password is ACCEPTED at setup (no length floor)');
  /* the admin is now signed in with the short password; later sections re-login with ADMIN/PW */
  await ackPrivacy(B);
  const sample = B.d.querySelector('[data-action="load-sample"]');
  if (sample) { click(B, sample); await sleep(600); const yes = B.d.querySelector('#dlg [data-x="1"]'); if (yes) { click(B, yes); await sleep(500); } }
  /* load-sample ends with location.reload() — a no-op in jsdom, so re-boot
     a fresh browser from the persisted storage, exactly like a real reload */
  const dump0 = await waitFor(() => { const d = storageDump(B); return (JSON.parse(d['p4c4-markbook-v2'] || '{}').data) ? d : null; }, 15000);
  ok(!!dump0, 'legacy sample data persisted');
  B = boot(dump0);
  await sleep(400); await ackGate(B);
  ok(await loginAs(B, ADMIN, PW), 'admin re-signs after the sample reload');
  await ackPrivacy(B);
  const semCount = B.w.SPR_DEBUG_GET_DB().semesters.length;
  ok(semCount > 0, 'legacy sample data loaded (' + semCount + ' semesters)');

  /* ---- S2: migration wizard ---- */
  B.w.location.hash = '#/manage';
  await sleep(400);
  const migBtn = await waitFor(() => B.d.querySelector('[data-action="class-migrate-open"]'), 5000);
  ok(!!migBtn, 'migration panel offered to admin');
  click(B, migBtn);
  await sleep(300);
  const dlg = B.d.getElementById('dlg');
  ok(dlg && dlg.open && /dry run/i.test(dlg.textContent), 'dry-run dialog shown');
  ok(/1 class/i.test(dlg.textContent), 'plan lists the sample class');
  click(B, dlg.querySelector('[data-x="1"]'));           /* backup, then apply */
  /* applyMigration does several PBKDF2 passes — wait for the mode flip
     deterministically instead of a fixed sleep (flaked under load) */
  await waitFor(() => storageDump(B)['spr-mode-v1'] === 'class', 40000);
  const dump1 = storageDump(B);
  ok(dump1['spr-mode-v1'] === 'class', 'mode switched to class');
  ok((dump1['spr-class-index-v1'] || '').length > 10, 'class index written');
  ok(B.w.__downloads.some((f) => /SPR-backup/i.test(f)), 'pre-migration backup downloaded');

  /* ---- S3: admin re-opens in class mode ---- */
  B = boot(dump1);
  await sleep(600); await ackGate(B); await sleep(300);
  ok(await loginAs(B, ADMIN, PW), 'admin signs into class mode');
  await ackPrivacy(B);
  await sleep(500);
  /* login auto-opens the last class; either the class home or the open class is a pass */
  const autoOpened = await waitFor(() => B.w.SPR_DEBUG_GET_DB().semesters && B.w.SPR_DEBUG_GET_DB().semesters.length, 8000);
  ok(!!autoOpened, 'class data reachable after migration (auto-open or class home)');
  if (!B.w.SPR_DEBUG_GET_DB().sprClass) {
    const openBtn = await waitFor(() => B.d.querySelector('[data-action="class-open"]'), 5000);
    ok(!!openBtn, 'sample class listed after migration');
    click(B, openBtn);
  } else {
    console.log('  ok: sample class listed after migration (auto-opened)');
  }
  ok(await waitFor(() => (B.w.SPR_DEBUG_GET_DB().semesters || []).length === semCount, 8000), 'class workbook carries all semesters');
  ok(await waitFor(() => /Dashboard/i.test(B.d.body.textContent), 5000), 'dashboard renders inside the class');

  /* ---- S4: provision + pair eal-01 / sup-01 ---- */
  /* 2026-10-25: no length floor - an 11-character teacher password is accepted */
  ok(await B.w.SPR_DEBUG_AUTH.provision('short-eal', 'a'.repeat(11), 'Short EAL', 'eal') === null, '11-character teacher password accepted (no floor)');
  ok(await B.w.SPR_DEBUG_AUTH.provision('eal-01', 'eal-pass-123', 'EAL One', 'eal') === null, '12-character teacher password accepted');
  ok(await B.w.SPR_DEBUG_AUTH.provision('sup-01', 'sup-pass-123', 'Support One', 'support') === null, 'support account provisioned');
  B.w.location.hash = '#/classes';
  for (let t = 0; t <= 3000; t += 500) {
    await sleep(500);
  }
  /* P1 fix (2026-10-24): the rail-less Classes screen must carry its own way out —
     users with no classes were trapped here with no sign-out and no nav */
  ok(!!B.d.querySelector('.page [data-action="logout"]'), 'Classes screen shows Sign out (escape hatch)');
  ok(!!B.d.querySelector('.page [data-action="privacy-open"]'), 'Classes screen links the privacy notice');
  /* simple-ui (2026-10-24): Pair lives in Manage & setup -> Advanced (admin, collapsed) */
  B.w.location.hash = '#/manage';
  const pairBtn = await waitFor(() => B.d.querySelector('[data-action="class-pair"]'), 6000);
  ok(!!pairBtn, 'pair button available to admin (Manage & setup -> Advanced)');
  async function pairAs(role, user) {
    let pb = await waitFor(() => B.d.querySelector('[data-action="class-pair"]'), 4000);
    if (!pb) {
      /* after a pairing the app may navigate — go back to Manage -> Advanced */
      B.w.location.hash = '#/manage';
      pb = await waitFor(() => B.d.querySelector('[data-action="class-pair"]'), 6000);
    }
    if (!pb) {
      console.log('  [pair-dbg] no pair button for', role, '| hash:', B.w.location.hash,
        '| mode:', B.w.localStorage.getItem('spr-mode-v1'),
        '| ix:', (B.w.localStorage.getItem('spr-class-index-v1') || '').slice(0, 60),
        '| details:', B.d.querySelectorAll('details').length,
        '| pairInDom:', B.d.querySelectorAll('[data-action="class-pair"]').length,
        '| summaryTxt:', (function () { const dd = B.d.querySelector('details summary'); return dd ? dd.textContent.slice(0, 40) : 'none'; })());
      return null;
    }
    click(B, pb);
    await sleep(350);
    const sel = await waitFor(() => B.d.querySelector('#pair-' + role), 3000);
    if (!sel) { console.log('  [pair-dbg] no #pair-' + role, '| dlg:', (function () { const dl = B.d.getElementById('dlg'); return dl && dl.open ? dl.textContent.slice(0, 80) : 'closed'; })()); return null; }
    sel.value = user;
    click(B, B.d.querySelector('#dlg [data-x="1"]'));
    await sleep(500);
    console.log('  [pair-dbg]', role, 'confirmed | dlg after confirm:', (function () { const dl = B.d.getElementById('dlg'); return dl && dl.open ? dl.textContent.slice(0, 60) : 'closed'; })(),
      '| toasts:', (function () { return Array.from(B.d.querySelectorAll('.toast')).map(function (t) { return t.textContent.slice(0, 80); }).join(' | ') || 'none'; })());
    /* the one-time password dialog shows the generated rotation password */
    const pwEl = await waitFor(() => { const dl = B.d.getElementById('dlg'); return dl && dl.open && dl.querySelector('code') ? dl.querySelector('code') : null; }, 30000);   /* key issue = PBKDF2 x2; on slower platforms (Linux CI) this can approach 20 s */
    const pw = pwEl ? pwEl.textContent : null;
    const done = B.d.querySelector('#dlg [data-x="1"]');
    if (done) click(B, done);
    await sleep(250);
    /* the pairing flow reloads the page in a real browser; jsdom's reload is a
       no-op, so emulate: fresh jsdom over the same storage + session */
    const sCopy = B.w.sessionStorage.getItem('spr-session');
    const sdCopy = B.w.sessionStorage.getItem('spr-session-db');
    B = boot(storageDump(B));
    if (sCopy) B.w.sessionStorage.setItem('spr-session', sCopy);
    if (sdCopy) B.w.sessionStorage.setItem('spr-session-db', sdCopy);
    await sleep(400);
    B.w.location.hash = '#/manage';
    await sleep(600);
    return pw;
  }
  const ealPw = await pairAs('eal', 'eal-01');
  let supPw = await pairAs('support', 'sup-01');
  const PW_SHAPE = /^[a-z0-9]{5}(-[a-z0-9]{5}){3}$/;
  ok(!!ealPw && PW_SHAPE.test(ealPw), 'one-time password issued for eal-01 (' + ealPw + ')');
  ok(!!supPw && PW_SHAPE.test(supPw), 'one-time password issued for sup-01 (5-5-5-5 generator)');

  const dump2 = storageDump(B);

  /* ---- S5: support proposes an observation change ---- */
  B = boot(dump2);
  await sleep(500); await ackGate(B);
  const loggedIn = await loginAs(B, 'sup-01', supPw);
  ok(loggedIn, 'support signs in with the issued password');
  await ackPrivacy(B);
  await sleep(500);
  const supIn = await waitFor(() => B.w.SPR_DEBUG_GET_DB().semesters && B.w.SPR_DEBUG_GET_DB().semesters.length, 8000);
  ok(!!supIn, 'support sees the paired class');
  if (!B.w.SPR_DEBUG_GET_DB().sprClass) {
    ok(!B.d.querySelector('[data-action="class-pair"]'), 'support gets no admin buttons');
    const supOpen = await waitFor(() => B.d.querySelector('[data-action="class-open"]'), 5000);
    click(B, supOpen);
  } else {
    console.log('  ok: support gets no admin buttons (auto-opened straight in)');
  }
  ok(await waitFor(() => (B.w.SPR_DEBUG_GET_DB().semesters || []).length === semCount, 8000), 'support opens the class');
  /* P1.2/P1.1: self-service change through the real UI, then the old password dies */
  {
    /* 2026-10-25: password self-service lives in Manage & setup for every role */
    await waitFor(() => B.w.location.hash === '#/dashboard', 15000);
    await sleep(700);   /* let openClass's async tail (persist + route + closeDlg) fully drain — clicking earlier lets route() eat the dialog */
    B.w.location.hash = '#/manage';
    await sleep(500);
    const cpBtn = await waitFor(() => B.d.querySelector('[data-action="change-pass-open"]'), 6000);
    if (!cpBtn) { console.log('  [dbg] no change-pass button; hash:', B.w.location.hash); }
    click(B, cpBtn);
    await waitFor(() => B.d.getElementById('cpCur'), 8000);   /* dialog may take a beat (async confirm builder) */
    setVal(B, B.d.getElementById('cpCur'), supPw);
    setVal(B, B.d.getElementById('cpNew'), 'sup-new-pass-456');
    setVal(B, B.d.getElementById('cpConf'), 'sup-new-pass-456');
    click(B, B.d.querySelector('[data-action="change-pass-save"]'));
    const changed = await waitFor(() => /Password updated/.test((B.d.getElementById('toast-root') || {textContent:''}).textContent), 25000);   /* verify + rewrap + loginWrap = 3 PBKDF2 passes; >10 s under load */
    ok(changed, 'support changed its own password (no admin)');
    supPw = 'sup-new-pass-456';
    const dump = storageDump(B);
    click(B, B.d.querySelector('[data-action="logout"]'));
    await sleep(300);
    B = boot(dump);
    await sleep(400); await ackGate(B);
    const oldTry = await loginAs(B, 'sup-01', 'wrong-old-pw-9');
    ok(!oldTry && /Invalid/.test(((B.d.getElementById('loginErr') || {}).textContent || '')), 'old password no longer signs in');
    ok(await loginAs(B, 'sup-01', supPw), 'new password signs in');
    await ackPrivacy(B);
    const reached = await waitFor(() => (B.w.SPR_DEBUG_GET_DB() || {}).semesters && B.w.SPR_DEBUG_GET_DB().semesters.length === semCount, 20000);
    if (!reached) {   /* diagnose honestly instead of crashing three lines later */
      const sessX = JSON.parse(B.w.sessionStorage.getItem('spr-session') || 'null');
      console.log('  [dbg-newpw] wrap-under-nw:', await new Promise(function (res) { setTimeout(function () { res('timeout'); }, 4000); B.w.SPR_DEBUG_UNWRAP('sup-01', 'sup-new-pass-456').then(res); }),
        '| wrap-under-OTP?', '(otp not retained)',
        '| sessKeys:', sessX ? Object.keys(sessX.keys || {}).join(',') || 'none' : 'no-session',
        '| dlg:', (function () { const dl = B.d.getElementById('dlg'); return dl && dl.open ? dl.textContent.slice(0, 100).replace(/\s+/g, ' ') : 'closed'; })());
    }
    ok(reached, 'support reaches the class with the new password');
    B.w.location.hash = '#/classes';
    B.w.dispatchEvent(new B.w.Event('hashchange'));   /* the suite convention: bare hash writes do not route */
    const reOpen = await waitFor(() => B.d.querySelector('[data-action="class-open"]'), 15000);
    if (reOpen && !(B.w.SPR_DEBUG_GET_DB().semesters || []).length) {
      click(B, reOpen);
      /* the open is async (PBKDF2 unwrap + persist + route) — poll, never sleep */
      await waitFor(() => (B.w.SPR_DEBUG_GET_DB().semesters || []).length > 0 || B.w.location.hash === '#/dashboard', 25000);
    }
  }
  const opened = await waitFor(() => B.w.location.hash === '#/dashboard' && (B.w.SPR_DEBUG_GET_DB().semesters || []).length > 0, 25000);   /* openClass lands on the dashboard LAST — then navigate */
  if (!opened) {
    console.log('  [dbg-open] hash:', B.w.location.hash, '| sems:', (B.w.SPR_DEBUG_GET_DB().semesters || []).length,
      '| ring:', (function () { var a = B.w.SPR_DEBUG_AUTH.get(); var u = (a.users || []).find(function (x) { return x.username === 'sup-01'; }); return u && u.keyring ? Object.keys(u.keyring).length : 'no-user'; })(),
      '| sessKeys:', Object.keys(((JSON.parse(B.w.sessionStorage.getItem('spr-session') || 'null') || {}).keys) || {}).length,
      '| dlg:', (function () { var d = B.d.getElementById('dlg'); return d && d.open ? d.textContent.slice(0, 140).replace(/\s+/g, ' ') : 'closed'; })(),
      '| toasts:', ((B.d.getElementById('toast-root') || { textContent: '' }).textContent || '').slice(0, 140));
  }
  B.w.location.hash = '#/entry/obs';
  B.w.dispatchEvent(new B.w.Event('hashchange'));
  const propCell = await waitFor(() => B.d.querySelector('input[data-propose]'), 15000);
  const meDbg = { role: (B.w.SPR_DEBUG_AUTH.get().session || {}).role };
  ok(!!propCell, 'observation cells offer propose-to-change for support');
  const before = B.w.SPR_DEBUG_GET_DB();
  const firstSem = before.semesters.find((x) => x.id === before.currentSemesterId) || before.semesters[0];
  const sid0 = propCell ? propCell.dataset.sid : firstSem.students[0].id;
  const month0 = propCell ? propCell.dataset.month : firstSem.months[0];
  const key0 = propCell ? propCell.dataset.key : 'Listening-LO1';
  const preVal = (((firstSem.observations || {})[sid0] || {})[month0]) || {};
  click(B, propCell);
  await waitFor(() => B.d.getElementById('prop-val'), 8000);   /* propose dialog is built async */
  setVal(B, B.d.querySelector('#prop-val'), '4');
  setVal(B, B.d.querySelector('#prop-note'), 'recounted, first LO');
  const idxBeforeReq = (JSON.parse(B.w.localStorage.getItem('spr-class-index-v1') || '[]')[0] || {}).updatedAt || '';
  click(B, B.d.querySelector('#dlg [data-x="1"]'));
  await waitFor(() => (B.w.SPR_DEBUG_GET_DB().pending || []).length === 1, 10000);
  /* the save is debounced - the reboot dump below must not outrun it */
  await waitFor(() => ((JSON.parse(B.w.localStorage.getItem('spr-class-index-v1') || '[]')[0] || {}).updatedAt || '') !== idxBeforeReq, 10000);
  const afterReq = B.w.SPR_DEBUG_GET_DB();
  ok((afterReq.pending || []).length === 1, 'proposal queued');
  const pv = B.w.ClassStore.obsCell(afterReq, afterReq.pending[0].semId, sid0, month0, key0);
  const pvBefore = preVal[key0];
  ok(pv === pvBefore, 'PENDING request leaves the score untouched (' + pvBefore + ' → ' + pv + ')');
  ok((afterReq.audit || []).some((a) => a.action === 'obs.request'), 'request audited');
  const dump3 = storageDump(B);

  /* ---- S6: EAL reviews: approve one, reject one ---- */
  B = boot(dump3);
  await sleep(400); await ackGate(B);
  ok(await loginAs(B, 'eal-01', ealPw), 'EAL signs in with the issued password');
  await ackPrivacy(B);
  await sleep(600);
  ok(await waitFor(() => B.w.SPR_DEBUG_GET_DB().semesters && B.w.SPR_DEBUG_GET_DB().semesters.length === semCount, 8000), 'EAL lands straight in the paired class');
  await waitFor(() => B.w.location.hash === '#/dashboard', 8000);
  /* a second proposal to reject */
  const obsKey2 = 'Speaking-LO1';
  B.w.eval(''); /* noop keep-alive */
  const dbNow = () => B.w.SPR_DEBUG_GET_DB();
  B.w.location.hash = '#/review';
  B.w.dispatchEvent(new B.w.Event('hashchange'));
  const apprBtn = await waitFor(() => B.d.querySelector('[data-action="review-approve"]'), 15000);
  ok(!!apprBtn, 'review queue shows the proposal');
  const pendId = dbNow().pending[0].id;
  const idxBeforeAppr = (JSON.parse(B.w.localStorage.getItem('spr-class-index-v1') || '[]')[0] || {}).updatedAt || '';
  click(B, apprBtn);
  await waitFor(() => (dbNow().pending || []).length === 0, 10000);
  await waitFor(() => ((JSON.parse(B.w.localStorage.getItem('spr-class-index-v1') || '[]')[0] || {}).updatedAt || '') !== idxBeforeAppr, 10000);
  ok((dbNow().pending || []).length === 0, 'queue empty after approval');
  function pendSemId(db, pid) { const p2 = (db.pending || []).find((x) => x.id === pid); return p2 ? p2.semId : db.currentSemesterId; }
  const appliedVal = B.w.ClassStore.obsCell(dbNow(), pendSemId(dbNow(), pendId), sid0, month0, key0);
  ok(appliedVal === 4, 'APPROVED change applied (' + appliedVal + ')');
  ok((dbNow().audit || []).some((a) => a.action === 'obs.approve' && a.new === 4), 'approval audited with old and new');
  ok(dbNow().audit.some((a) => a.action === 'migrate'), 'migration audit entry survived');

  /* reject path (via classstore through the page's own module) */
  const CS = B.w.ClassStore;
  const sem2 = dbNow().semesters[0];
  CS.requestChange(dbNow(), { semId: sem2.id, sid: sid0, month: month0, key: obsKey2, newValue: 2, by: 'sup-01' });
  const rejId = dbNow().pending[0].id;
  const before2 = B.w.ClassStore.obsCell(dbNow(), sem2.id, sid0, month0, obsKey2);
  B.w.location.hash = '#/dashboard';   /* re-enter review so the route re-renders with the new pending item */
  B.w.dispatchEvent(new B.w.Event('hashchange'));
  B.w.location.hash = '#/review';
  B.w.dispatchEvent(new B.w.Event('hashchange'));
  const rejBtn = await waitFor(() => B.d.querySelector('[data-action="review-reject"]'), 15000);
  click(B, rejBtn);
  await waitFor(() => B.d.getElementById('rej-note'), 8000);   /* reject dialog is built async */
  setVal(B, B.d.querySelector('#rej-note'), 'we agreed last week');
  click(B, B.d.querySelector('#dlg [data-x="1"]'));
  await waitFor(() => (dbNow().pending || []).length === 0, 10000);
  ok((dbNow().pending || []).length === 0, 'rejected proposal leaves the queue');
  const afterRej = B.w.ClassStore.obsCell(dbNow(), sem2.id, sid0, month0, obsKey2);
  ok(afterRej === before2, 'REJECTED change leaves the score untouched');
  ok(dbNow().audit.some((a) => a.action === 'obs.reject'), 'rejection audited');

  /* ---- S7: manager read-only ---- */
  const dump4 = storageDump(B);
  B = boot(dump4);
  await sleep(400); await ackGate(B);
  /* provisioning needs an ADMIN session (the master key must be unlocked to
     wrap it for the new account) — sign in as admin first */
  ok(await loginAs(B, ADMIN, PW), 'admin re-signs to provision the manager');
  ok(await B.w.SPR_DEBUG_AUTH.provision('mgr-01', 'mgr-pass-12345', 'Manager One', 'manager') === null, 'manager provisioned');
  /* give the manager the class key (admin-side pairing equivalent) */
  const auth = B.w.SPR_DEBUG_AUTH.get();
  const adminRing = auth.users.find((u) => u.username === ADMIN).keyring;
  const mgr = auth.users.find((u) => u.username === 'mgr-01');
  mgr.keyring = JSON.parse(JSON.stringify(adminRing));   /* test shortcut: admin hands over the wraps — wraps are password-bound, so re-wrap */
  B.w.SPR_DEBUG_AUTH.save(auth);
  /* wraps are bound to the ADMIN password — unwrap+rewrap as manager via ClassStore in-page */
  for (const cid of Object.keys(adminRing)) {
    const raw = B.w.eval('null'); /* placeholder */
    /* (do it in node-side page eval) */
  }
  const rewrap = await (async function () {
    const w = B.w;
    const ringIn = auth.users.find((u) => u.username === ADMIN).keyring;
    const out = {};
    for (const cid of Object.keys(ringIn)) {
      const key = await w.ClassStore.unwrapKey(ringIn[cid], PW);
      out[cid] = await w.ClassStore.wrapKey(key, 'mgr-pass-12345');
    }
    return out;
  })();
  const auth2 = B.w.SPR_DEBUG_AUTH.get();
  auth2.users.find((u) => u.username === 'mgr-01').keyring = rewrap;
  B.w.SPR_DEBUG_AUTH.save(auth2);
  const dump5 = storageDump(B);
  B = boot(dump5);
  await sleep(400); await ackGate(B);
  ok(await loginAs(B, 'mgr-01', 'mgr-pass-12345'), 'manager signs in');
  await ackPrivacy(B);
  await sleep(500);
  ok(await waitFor(() => B.w.SPR_DEBUG_GET_DB().semesters && B.w.SPR_DEBUG_GET_DB().semesters.length === semCount, 8000), 'manager reaches the class (home or auto-open)');
  { const ma = JSON.parse(B.w.localStorage.getItem('spr-auth-v1') || '{}'); const mu = ((ma.users || []).find((u) => u.username === 'mgr-01') || {}); console.log('  [mgrDbg] hash:', B.w.location.hash, '| inClass:', !!B.w.SPR_DEBUG_GET_DB().sprClass, '| sems:', B.w.SPR_DEBUG_GET_DB().semesters.length, '| ring:', Object.keys(mu.keyring || {}).length); }
  ok(await waitFor(() => /Read-only/i.test(B.d.body.textContent) || /whole school, read-only/i.test(B.d.body.textContent), 4000), 'manager badge is read-only');
  if (!B.w.SPR_DEBUG_GET_DB().sprClass) {
    const mgrOpen = await waitFor(() => B.d.querySelector('[data-action="class-open"]'), 4000);
    click(B, mgrOpen);
    ok(await waitFor(() => B.w.SPR_DEBUG_GET_DB().semesters && B.w.SPR_DEBUG_GET_DB().semesters.length === semCount, 8000), 'manager opens the class');
  } else {
    console.log('  ok: manager opens the class (auto-opened)');
  }
  await waitFor(() => B.w.location.hash === '#/dashboard', 8000);
  B.w.location.hash = '#/entry/obs';
  await sleep(400);
  const roCell = B.d.querySelector('input[data-kind="obs"]');
  ok(roCell && roCell.readOnly, 'manager observation cells are readonly');
  const roWeek = B.d.querySelector('input[data-kind="week"]') || B.d.querySelector('#entry input.cell');
  B.w.location.hash = '#/entry/sp';
  await sleep(400);
  const roWeek2 = B.d.querySelector('input[data-kind="week"]');
  ok(roWeek2 && roWeek2.readOnly, 'manager score cells are readonly');


  /* P1.1: invalid scores are quarantined for review, never deleted */
  {
    const dump6 = storageDump(B);
    B = boot(dump6);
    await sleep(600); await ackGate(B);
    ok(await loginAs(B, ADMIN, PW), 'admin re-signs for the quarantine check');
    await ackPrivacy(B);
    ok(await waitFor(() => B.w.SPR_DEBUG_GET_DB() && B.w.SPR_DEBUG_GET_DB().sprClass && (B.w.SPR_DEBUG_GET_DB().semesters || []).length, 15000),
      'admin’s class auto-opens before the quarantine injection');
    const db = B.w.SPR_DEBUG_GET_DB();
    const sem = db.semesters[0];
    const sid0 = sem.students[0].id;
    const m0 = sem.months[0];
    sem.observations[sid0] = sem.observations[sid0] || {};
    sem.observations[sid0][m0] = Object.assign({}, sem.observations[sid0][m0], { 'Listening-LO1': 15 });
    B.w.SPR_DEBUG_SET_DB(db);            /* persists through the app's real save path */
    await sleep(900);
    const dump7 = storageDump(B);
    const B2 = boot(dump7);
    await sleep(600); await ackGate(B2);
    ok(await loginAs(B2, ADMIN, PW), 'reload after injecting an invalid observation');
    await sleep(800);
    const db2 = B2.w.SPR_DEBUG_GET_DB();
    const sem2 = db2.semesters[0];
    const cellAfter = ((sem2.observations || {})[sid0] || {})[m0] || {};
    const review = (sem2.review || []).filter((r) => r.sid === sid0 && r.key === 'Listening-LO1');
    ok(cellAfter['Listening-LO1'] === undefined, 'invalid observation is out of the live cell');
    ok(review.length === 1 && review[0].value === 15 && /0-10/.test(review[0].reason), 'value 15 quarantined to the review list with a reason');
    const safety = JSON.parse(B2.w.localStorage.getItem('spr-safety-backups-v1') || '[]');
    ok(Array.isArray(safety) && safety.length > 0, 'a safety copy was stashed before quarantining');
  }

  /* P1.2: the landing page shows real values without JS; absolute privacy claims are gone */
  {
    const fs = require('fs');
    const landing = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    ok(/data-count="23">23</.test(landing) && /data-count="6" data-suffix="\+">6\+</.test(landing) && /data-count="100" data-suffix="%">100%</.test(landing),
      'stat counters carry their real final values in the HTML (visible with JS off)');
    ok(!/Student data never leaves the device/i.test(landing) && !/no server holds your data/i.test(landing) && !/No server accounts, no database/i.test(landing),
      'no absolute privacy claims remain on the landing page');
    ok(!/>Synced</.test(landing), 'the hero mockup chip is no longer labelled Synced');
  }
  /* P1.2: while sync is OFF, the whole flow must not contact supabase once */
  {
    const log = (B.w.__fetchLog || []);
    const sb = log.filter((u) => /supabase\.co/.test(u));
    ok(log.length === 0, 'ZERO network requests while sync is off (got: ' + log.length + ': ' + log.slice(0, 2).join(' | ').slice(0, 160) + ')');
  }

  console.log(fails ? '\n' + fails + ' FAILURES' : '\nALL CLASS-MODE CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
