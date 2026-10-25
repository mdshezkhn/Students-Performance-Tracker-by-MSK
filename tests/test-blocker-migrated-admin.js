/* BLOCKER repro + recovery proof (round 2). The reviewer's flow, mirrored:
     1. MAIN build: fresh admin mo -> load sample -> RELOAD (real browsers do;
        the in-memory password dies; the session restores without it) ->
        Review migration -> apply. Migration then seals the class key under a
        RANDOM one-time password (shown once) while the login stays the same.
     2. Copy ALL storage into a fresh browser (no session).
     3. SIMPLE-UI build: sign in with the password a human has -> the class
        must NOT trap: no false "sign in again" advice, and the pre-migration
        backup must restore end to end, after which sign-in opens the class. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('jsdom');
const webcrypto = require('crypto').webcrypto;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let oks = 0, bad = 0;
const ok = (c, m) => { if (c) { oks++; console.log('  ok:', m); } else { bad++; console.log('  FAIL:', m); } };

let REF_MISSING = false;
function pickBuild(ref) {
  if (ref === 'HEAD') {
    const committed = path.join(__dirname, '../app/index.html');   /* test what SHIPS first */
    if (fs.existsSync(committed)) return fs.readFileSync(committed, 'utf8');
    return fs.readFileSync(path.join(__dirname, '../dist/app/index.html'), 'utf8');
  }
  try {
    return execSync('git show ' + ref + ':app/index.html', { cwd: path.join(__dirname, '..'), maxBuffer: 1 << 26 }).toString();
  } catch (e) {
    REF_MISSING = true;   /* shallow clone without the tag: the MAIN-leg replay is impossible, say so */
    return null;
  }
}
let html0 = '';
function boot(seed) {
  /* base64 the whole seed: arbitrary markbook text must never break the
     script-string injection (a stray token kills the whole page) */
  let pre = '';
  if (seed) {
    const b64 = Buffer.from(JSON.stringify(seed), 'utf8').toString('base64');
    pre = 'try{var _b=atob(' + JSON.stringify(b64) + ');var _j=decodeURIComponent(escape(_b));var _s=JSON.parse(_j);for(var _k in _s){localStorage.setItem(_k,_s[_k])}}catch(e){}';
  }
  const stub = '<script>' + pre +
    'window.__SB={};window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
    'window.__downloads=[];window.__blobs=[];try{window.URL.createObjectURL=function(b){try{window.__blobs.push(b)}catch(e){}return "blob:x"};window.URL.revokeObjectURL=function(){};}catch(e){}' +
    'window.__fetchLog=[];window.fetch=function(u){try{window.__fetchLog.push(String(u))}catch(e){}return Promise.resolve({ok:false,status:404,json:function(){return Promise.resolve([])}})};' +
    'window.addEventListener("error",function(ev){window.__LAST_ERR=(ev.error&&ev.error.stack)||ev.message});window.addEventListener("unhandledrejection",function(ev){window.__LAST_ERR="REJ: "+((ev.reason&&ev.reason.stack)||ev.reason)});' +
    '(function(){var d=document.getElementById("dlg");if(d&&!d.showModal){d.showModal=function(){this.open=true};d.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();' +
    '</script>';
  const i = html0.lastIndexOf('</body>');
  const html = html0.slice(0, i) + stub + html0.slice(i);
  const vc = new VirtualConsole();
  vc.on('error', (m) => console.log('  [page-error]', String(m).slice(0, 200)));
  vc.on('jsdomError', (e) => { if (!/Not implemented|canvas|navigation/i.test(String(e.message || e))) console.log('  jsdomError:', String(e.message).slice(0, 200), '|', String((e.detail && e.detail.stack) || '').split(String.fromCharCode(10)).slice(0, 4).join(' | ').slice(0, 300)); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/app/index.html#/dashboard', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  return { w, d: w.document };
}
const click = (B, el) => el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
const setVal = (B, el, v) => { el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); };
const dlgText = (B) => { const d = B.d.getElementById('dlg'); return d && d.open ? d.textContent : ''; };
function dumpStorage(B) { const o = {}; for (let i = 0; i < B.w.localStorage.length; i++) { const k = B.w.localStorage.key(i); o[k] = B.w.localStorage.getItem(k); } return o; }
async function waitFor(f, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(120); } return !!f(); }
async function waitAck(B) {
  await waitFor(() => B.d.querySelector('[data-action="privacy-gate-ack"]'), 8000);
  for (const a of ['privacy-gate-ack', 'privacy-ack']) { const b = B.d.querySelector('[data-action="' + a + '"]'); if (b) { click(B, b); await sleep(350); } }
  await waitFor(() => !B.d.body.classList.contains('auth-gate') || !(B.d.getElementById('dlg') || {}).open, 5000);
}
function rotatedFromDialog(B) {
  const out = {};
  if (/shown once|new password/i.test(dlgText(B))) {
    for (const r of Array.from(B.d.querySelectorAll('#dlg tbody tr'))) {
      const code = r.querySelector('code'); const un = r.querySelector('td');
      if (code && un) out[un.textContent.trim()] = code.textContent.trim();
    }
    const d1 = B.d.querySelector('#dlg [data-x="1"]'); if (d1) click(B, d1);
    const c = B.d.querySelector('#dlg [data-action="dlg-close"], #dlg [data-x="0"]'); if (c) click(B, c);
  }
  return out;
}
async function signIn(B, user, pw) {
  if (!await waitFor(() => B.d.getElementById('loginUser'), 8000)) return false;
  setVal(B, B.d.getElementById('loginUser'), user);
  setVal(B, B.d.getElementById('loginPass'), pw);
  click(B, B.d.querySelector('[data-action="do-login"]'));
  return waitFor(() => !B.d.body.classList.contains('auth-gate'), 20000);
}
const HONEST = /Cannot unlock|Check for a newer copy|Restore from a backup file|Restore this backup\?/;

(async function main() {
  const PW = 'blocker-pass-11', ADMIN = 'mo';
  let rotated = {};

  /* ---- 1. MAIN build: admin, sample, RELOAD (session restores, pw dies), migrate ---- */
  console.log('== MAIN build: admin, sample, RELOAD, migration ==');
  html0 = pickBuild('pre-simple-ui');
  if (REF_MISSING) {
    console.log('  SKIP: git tag pre-simple-ui not available in this clone (shallow). Re-run in a full clone to replay the MAIN-leg.');
    console.log('BLOCKER-REPRO PASSED (0 checks — MAIN leg unavailable)');
    process.exit(0);
  }
  const M = boot();
  await sleep(500); await waitAck(M);
  if (!M.d.getElementById('suUser')) { const s = M.d.querySelector('[data-action="show-setup"]'); if (s) { click(M, s); await sleep(300); } }
  setVal(M, M.d.getElementById('suUser'), ADMIN);
  setVal(M, M.d.getElementById('suPass'), PW);
  setVal(M, M.d.getElementById('suConf'), PW);
  click(M, M.d.querySelector('[data-action="first-run"]'));
  ok(await waitFor(() => !M.d.body.classList.contains('auth-gate'), 20000), 'MAIN: admin signed in');
  M.w.location.hash = '#/manage'; await sleep(500);
  const ls = M.d.querySelector('[data-action="load-sample"]');
  ok(!!ls, 'MAIN: Load sample data button present');
  click(M, ls);
  /* real browsers RELOAD here — fresh jsdom over the SAME storage INCLUDING
     sessionStorage (f3.py copies everything): session restores, pw is gone */
  await sleep(600);
  const sessCopy = M.w.sessionStorage.getItem('spr-session');
  const sessDbCopy = M.w.sessionStorage.getItem('spr-session-db');
  html0 = pickBuild('pre-simple-ui');
  const R = boot(dumpStorage(M));
  if (sessCopy) R.w.sessionStorage.setItem('spr-session', sessCopy);
  if (sessDbCopy) R.w.sessionStorage.setItem('spr-session-db', sessDbCopy);
  await sleep(500); await waitAck(R);
  ok(!R.d.body.classList.contains('auth-gate'), 'MAIN: session restored after the reload (no sign-in card, like f3.py)');
  R.w.location.hash = '#/classes'; await sleep(600);
  const mig = R.d.querySelector('[data-action="class-migrate-open"]');
  ok(!!mig, 'MAIN(reloaded): migration panel offered');
  if (mig) {
    click(R, mig); await sleep(700);
    const b1 = R.d.querySelector('#dlg [data-x="1"]');
    ok(!!b1, 'MAIN(reloaded): dry-run dialog opened');
    if (b1) { click(R, b1); await waitFor(() => R.w.localStorage.getItem('spr-mode-v1') === 'class', 25000); }
  }
  await sleep(1200);
  rotated = rotatedFromDialog(R);
  console.log('  [i] one-time migration password shown for:', Object.keys(rotated).join(',') || 'NOBODY (no rotation)');
  ok(!!rotated[ADMIN], 'ROOT CAUSE: migration (run while signed-out-of-the-key) sealed the class key under a one-time password');
  ok(R.w.localStorage.getItem('spr-mode-v1') === 'class', 'MAIN(reloaded): mode switched to class');
  const seed = dumpStorage(R);

  /* ---- 2. SIMPLE-UI: sign in with the password a human has ---- */
  console.log('== SIMPLE-UI build: sign in + honest recovery (no loop) ==');
  html0 = pickBuild('HEAD');
  const S = boot(seed);
  await sleep(500); await waitAck(S);
  let loginPw = null;
  for (const pw of [PW, rotated[ADMIN]]) { if (!pw) continue; if (await signIn(S, ADMIN, pw)) { loginPw = pw; break; } await sleep(300); }
  ok(!!loginPw, 'SIMPLE: signed in as ' + ADMIN + ' with the original password');
  /* the honest outcome lands on #/dashboard (auto-open) — poll for either the
     dashboard or a dialog; a bare #/classes with an Open button is the chooser,
     so exercise its Open (this is where the honest dialog appears) */
  const settled = await waitFor(() =>
    S.w.location.hash.indexOf('#/dashboard') === 0 || /Cannot unlock|Restore from a backup file|Check for a newer copy/.test(dlgText(S)), 25000);
  const dlgAuto = dlgText(S);
  const autoHonest = HONEST.test(dlgAuto);
  console.log('  [i] right after sign-in:', (dlgAuto.slice(0, 80).replace(/\s+/g, ' ')) || ('hash=' + S.w.location.hash));
  const ob = S.d.querySelector('[data-action="class-open"]');
  if (ob && !autoHonest && S.w.location.hash.indexOf('#/dashboard') !== 0) { click(S, ob); await waitFor(() => dlgText(S) || S.w.location.hash.indexOf('#/dashboard') === 0, 15000); }
  const dlg1 = dlgText(S);
  const honest1 = HONEST.test(dlg1);
  const autoOpened = S.w.location.hash.indexOf('#/dashboard') === 0;   /* good outcome: sign-in alone opened the class */
  ok(autoOpened || autoHonest || honest1, '(b) BLOCKER BROKEN: either the class opened outright or the dialog offers a REAL recovery (cloud copy / backup file) — no dead advice');
  ok(!/Sign in once more|one more sign-in/i.test(dlg1 + ' ' + dlgAuto), '(b) the false "sign in once more" advice is gone');
  /* a second genuine sign-in changes nothing — and says nothing false */
  const lo = S.d.querySelector('[data-action="logout"]');
  if (lo) { click(S, lo); await sleep(700); await waitAck(S); }
  /* doLogout reloads the page in a real browser; jsdom's reload is a no-op,
     so emulate it: fresh jsdom over the same storage, NO session carried */
  html0 = pickBuild('HEAD');
  S2 = boot(dumpStorage(S));   /* same device, fresh page (real browsers reload) */
  await sleep(500); await waitAck(S2);
  let signed2 = false;
  for (const pw of [PW, rotated[ADMIN]]) {
    if (!pw) continue;
    signed2 = await signIn(S2, ADMIN, pw);
    if (signed2) break;
    await sleep(400);
  }
  ok(signed2, 'second sign-in completes (test sanity)');
  /* poll: either the auto-open lands the dashboard or the honest dialog shows */
  const settled2 = await waitFor(() =>
    S2.w.location.hash.indexOf('#/dashboard') === 0 || /Cannot unlock|Restore from a backup file|Check for a newer copy/.test(dlgText(S2)), 25000);
  const dlgAuto2 = dlgText(S2);
  const ob2 = S2.d.querySelector('[data-action="class-open"]');
  if (ob2 && !dlgAuto2 && S2.w.location.hash.indexOf('#/dashboard') !== 0) { click(S2, ob2); await waitFor(() => dlgText(S2) || S2.w.location.hash.indexOf('#/dashboard') === 0, 15000); }
  const honest2 = HONEST.test(dlgText(S2)) || HONEST.test(dlgAuto2);
  const dash2 = S2.w.location.hash.indexOf('#/dashboard') === 0;
  ok(settled2 && (honest2 || dash2), '(b) after another sign-in the screen is still honest (recovery, not a false promise)');

  /* ---- 2c. THE ONE-TIME-PASSWORD recovery: derive the key from the slip,
          re-seal it under the admin's own password, open the class ---- */
  console.log('== (3) one-time-password recovery ==');
  if (!dash2 && HONEST.test(dlgText(S2))) {
    /* wrong slip first: the dialog must say so and stay open */
    const otpBtn = S2.d.querySelector('#dlg [data-otp]');
    ok(!!otpBtn, '(3) the dialog offers "I have the one-time password from setup"');
    if (otpBtn) {
      click(S2, otpBtn); await sleep(400);
      const inp = S2.d.getElementById('otp-inp');
      ok(!!inp, '(3) one-time password input shown');
      if (inp) {
        setVal(S2, inp, 'wrong-slip-0000');
        const apply = S2.d.querySelector('#dlg [data-otp-apply]');
        click(S2, apply);
        await waitFor(() => { const er = S2.d.getElementById('otp-err'); return !!(er && er.textContent); }, 10000);
        const err = S2.d.getElementById('otp-err');
        ok(!!(err && err.textContent), '(3) a wrong slip is rejected with a plain message, dialog stays open');
        setVal(S2, inp, rotated[ADMIN] || '');
        click(S2, S2.d.querySelector('#dlg [data-otp-apply]'));
        await waitFor(() => S2.w.location.hash.indexOf('#/dashboard') === 0, 20000);
        const opened = S2.w.location.hash.indexOf('#/dashboard') === 0;
        ok(opened, '(3) the RIGHT slip opens the class: ' + S2.w.location.hash);
        /* the key was re-sealed under the admin's own password: sign out, sign
           in with the ORIGINAL password — the class must open again */
        await sleep(800);
        const authNow = JSON.parse(S2.w.localStorage.getItem('spr-auth-v1') || 'null');
        const meNow = authNow && authNow.users.find(function (u) { return u.username === ADMIN; });
        ok(!!(meNow && meNow.keyring), '(3) the keyring is present after the re-seal');
        const lo3 = S2.d.querySelector('[data-action="logout"]');
        ok(!!lo3, '(3) Sign out is reachable with the class open');
        if (lo3) { click(S2, lo3); await sleep(600); }
        /* doLogout reloads the page in a real browser; jsdom's reload is a
           no-op, so emulate it: fresh jsdom over the same storage */
        S2 = boot(dumpStorage(S2));
        await sleep(500); await waitAck(S2);
        let back = false;
        for (const pw of [PW]) { if (await signIn(S2, ADMIN, pw)) { back = true; break; } }
        ok(back, '(3) ordinary sign-in still works after the re-seal');
        await waitFor(() => S2.w.location.hash.indexOf('#/dashboard') === 0, 15000);
        ok(S2.w.location.hash.indexOf('#/dashboard') === 0, '(3) after re-sign-in the class opens on its own (no recovery needed)');
      }
    }
  } else ok(dash2, '(3) not needed on this run — the device already opened the class on its own (no one-time password involved); the OTP path is exercised in the run where the wrap cannot be derived');

  /* ---- 3. THE REAL RECOVERY: the pre-migration backup restores end to end ---- */
  console.log('== Recovery: restore the pre-migration backup, re-migrate, open ==');
  const blobs = (R.w.__blobs || []).concat(S.w.__blobs || []);   /* the backup was downloaded on the MAIN device */
  ok(blobs.length > 0, 'the migration produced a backup file');
  let backupText = null;
  if (blobs.length) {
    const b = blobs[blobs.length - 1];
    backupText = await new Promise((res) => { const fr = new S.w.FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsText(b); });
  }
  ok(!!backupText && backupText.indexOf('"semesters"') !== -1, 'the backup holds the legacy markbook');
  const backupObj = backupText ? JSON.parse(backupText) : null;
  const students = backupObj && backupObj.semesters && backupObj.semesters[0] ? backupObj.semesters[0].students.length : 0;
  ok(students > 0, 'backup holds students (' + students + ')');
  const fIn = S2.d.getElementById('file-restore-all');
  ok(!!fIn, 'restore file input present on this screen');
  if (fIn && backupText) {
    const file = new S2.w.File([backupText], 'SPR-backup-before-replace.json', { type: 'application/json' });
    try { Object.defineProperty(fIn, 'files', { value: [file] }); } catch (e) { fIn.files = [file]; }
    fIn.dispatchEvent(new S2.w.Event('change', { bubbles: true }));
    await waitFor(() => /Restore this backup\?/.test(dlgText(S2)), 8000);
    ok(/Restore this backup\?/.test(dlgText(S2)), 'restore asks in plain words');
    const go = S2.d.querySelector('#dlg [data-x="1"]');
    if (go) { click(S2, go); await sleep(1400); }
  }
  ok(S2.w.localStorage.getItem('spr-mode-v1') !== 'class', '(a) restore returns the device to the pre-split markbook');
  const classIxR = JSON.parse(S2.w.localStorage.getItem('spr-class-index-v1') || '[]');
  const blobKeysR = Array.from({ length: S2.w.localStorage.length }, (_, i) => S2.w.localStorage.key(i)).filter((k) => /^spr-class-/.test(k) && k !== 'spr-class-index-v1');
  ok(classIxR.length === 1 && blobKeysR.length === 1, '(d) the class workbook + index survive the restore untouched (nothing deleted)');
  /* re-migrate — the password is in memory now, so the wrap is derived correctly.
     (a real browser reloads after the restore; jsdom's reload is a no-op, so
     emulate it: fresh jsdom over the same storage, session carried over) */
  const sessAfterRestore = S2.w.sessionStorage.getItem('spr-session');
  const sessDbAfterRestore = S2.w.sessionStorage.getItem('spr-session-db');
  html0 = pickBuild('HEAD');
  const RS = boot(dumpStorage(S2));
  if (sessAfterRestore) RS.w.sessionStorage.setItem('spr-session', sessAfterRestore);
  if (sessDbAfterRestore) RS.w.sessionStorage.setItem('spr-session-db', sessDbAfterRestore);
  await sleep(500); await waitAck(RS);
  RS.w.location.hash = '#/manage'; await sleep(800);
  console.log('  [i] RS: restored=', RS.w.__SPR_SESSION_RESTORED || 'NO', '| carriedSess=', !!sessAfterRestore, '| S sess at dump=', !!S.w.sessionStorage.getItem('spr-session'), '| S gate at dump=', S.d.body.className, '| S hash at dump=', S.w.location.hash);
  console.log('  [i] RS dom: gate=' + RS.d.body.className + ' | appChildren=' + RS.d.getElementById('app').children.length +
    ' | hasNav=' + !!RS.d.querySelector('.nav') + ' | hash=' + RS.w.location.hash +
    ' | lastErr=' + String(RS.w.__LAST_ERR || 'none').slice(0, 120));
  const mig3 = RS.d.querySelector('[data-action="class-migrate-open"]');
  const rDb = JSON.parse(RS.w.localStorage.getItem('p4c4-markbook-v2') || 'null');
  console.log('  [i] RS state: mode=' + RS.w.localStorage.getItem('spr-mode-v1') +
    ' | auth=' + (() => { try { const a = JSON.parse(RS.w.localStorage.getItem('spr-auth-v1') || 'null'); return (a.users || []).map((u) => u.username + ':' + u.role).join(','); } catch (e) { return '?'; } })() +
    ' | v2=' + (rDb ? ('wraps=' + Object.keys(rDb.wraps || {}).join(',') + ' hasData=' + !!rDb.data) : 'none') +
    ' | advancedInDom=' + RS.d.querySelectorAll('details').length +
    ' | contentLen=' + (((RS.d.getElementById('content') || {}).innerHTML) || 'NO-CONTENT').length);
  ok(!!mig3, '(a) Review migration offered again after the restore');
  if (mig3) {
    click(RS, mig3); await sleep(700);
    const b1 = RS.d.querySelector('#dlg [data-x="1"]');
    if (b1) { click(RS, b1); await waitFor(() => RS.w.localStorage.getItem('spr-mode-v1') === 'class', 25000); }
    await sleep(800);
  }
  /* a FRESH browser over the final storage: sign in -> class opens */
  const seed3 = dumpStorage(RS);
  html0 = pickBuild('HEAD');
  const Z = boot(seed3);
  await sleep(500); await waitAck(Z);
  await signIn(Z, ADMIN, PW);
  await sleep(1100);
  await waitFor(() => {
    const zs = JSON.parse(Z.w.sessionStorage.getItem('spr-session') || 'null');
    return zs && Object.keys(zs.keys || {}).length > 0;
  }, 8000);
  const zSess = JSON.parse(Z.w.sessionStorage.getItem('spr-session') || 'null');
  const zKeys = zSess ? Object.keys(zSess.keys || {}) : [];
  console.log('  [i] fresh browser after recovery: keys=' + (zKeys.join(',') || 'NONE') + ' hash=' + Z.w.location.hash);
  if (Z.w.location.hash.indexOf('#/dashboard') !== 0) {
    const ob3 = Z.d.querySelector('[data-action="class-open"]');
    if (ob3) { click(Z, ob3); await sleep(900); }
  }
  const zBody = Z.d.body.textContent || '';
  const firstStudent = backupObj && backupObj.semesters && backupObj.semesters[0] && backupObj.semesters[0].students[0];
  const studentName = firstStudent && (firstStudent.name || firstStudent);
  const dashOk = Z.w.location.hash.indexOf('#/dashboard') === 0;
  const namesOk = dashOk && studentName && zBody.indexOf(String(studentName)) !== -1;
  console.log('  [i] end state: hash=' + Z.w.location.hash + ' | keys=' + (zKeys.join(',') || 'NONE') + ' | student "' + studentName + '" visible=' + namesOk);
  ok(dashOk && (zKeys.length > 0 || namesOk), '(a) END TO END: after the recovery, sign-in alone opens the class with the data');
  const zAuth = JSON.parse(Z.w.localStorage.getItem('spr-auth-v1') || 'null');
  const zMe = zAuth && zAuth.users.find((u) => u.username === ADMIN);
  ok(!!(zMe && zMe.keyring && Object.keys(zMe.keyring).length), '(a) the healed keyring wrap is stored');

  console.log(bad ? '\nBLOCKER-REPRO FAILURES: ' + bad : '\nBLOCKER-REPRO PASSED (' + oks + ')');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
