/* help & security regression suite (2026-10-27, owner requests 1-3)
   A. admin: Erase everything is GONE (button + handler); Data section is
      admin-only with a red Reset-to-sample + honest disclaimer; Help & training
      is in the nav, as a page (6 modules + request form) and linked from Manage.
   B. teacher (account created by the admin): no Users tab, no Data section,
      no wipe; keeps Change-my-password + forgot-password hint + Help & training
      with the same request form.
   C. sign-in screen tells a locked-out teacher where to go; the shipped bundle
      contains no wipe path at all (static check). */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

const appHtmlPath = ['../app/index.html', '../dist/app/index.html']   /* test what SHIPS first */
  .map((rel) => path.join(__dirname, rel)).find((p) => fs.existsSync(p));
if (!appHtmlPath) { console.log('FAIL: no app build (run python source/build2.py)'); process.exit(1); }
const html0 = fs.readFileSync(appHtmlPath, 'utf8');

let ok = 0, bad = 0;
function check(cond, msg) { if (cond) { ok++; console.log('  ok: ' + msg); } else { bad++; console.log('  FAIL: ' + msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(60); } return !!fn(); }

const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';
const PW = 'owner-pass-9';
const V2STORE = 'p4c4-markbook-v2';   /* encrypted-at-rest store: DB + per-user key wraps */

function boot(preExtra) {
  const pre = '<script>' + DLG_POLY + CHART_STUB + (preExtra || '') + '</script>';
  const i = html0.lastIndexOf('</body>');
  const vc = new VirtualConsole(); vc.on('jsdomError', () => { /* navigation etc. are expected */ });
  const dom = new JSDOM(html0.slice(0, i) + pre + html0.slice(i), {
    url: 'http://localhost/app/index.html#/dashboard', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc, storageQuota: 10000000,
  });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  return { w, d: w.document };
}
const click = (B, el) => el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
const setVal = (B, el, v) => { if (!el) { console.log('  [!] setVal target missing'); return; } el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); };
const go = async (B, hash) => { B.w.location.hash = hash; B.w.dispatchEvent(new B.w.Event('hashchange')); await sleep(500); };
const txt = (B) => { const c = B.d.body.cloneNode(true); c.querySelectorAll('script,style').forEach((n) => n.remove()); return c.textContent || ''; };
const toasts = (B) => Array.from(B.d.querySelectorAll('#toast-root .toast')).map((t) => t.textContent).join(' | ');

async function ackPrivacy(B) {
  for (const a of ['privacy-gate-ack', 'privacy-ack']) { const b = B.d.querySelector('[data-action="' + a + '"]'); if (b) { click(B, b); await sleep(200); } }
}
async function firstRun(B, user, pw) {
  const su = B.d.querySelector('[data-action="show-setup"]'); if (su) { click(B, su); await sleep(200); }
  setVal(B, B.d.getElementById('suUser'), user);
  setVal(B, B.d.getElementById('suPass'), pw);
  setVal(B, B.d.getElementById('suConf'), pw);
  click(B, B.d.querySelector('[data-action="first-run"]'));
  for (let t = 0; t < 40; t++) {
    await sleep(250);
    const dl = B.d.getElementById('dlg');
    if (dl && dl.open && dl.querySelector('[data-action="recovery-ack"]')) {
      const dlBtn = dl.querySelector('[data-action="recovery-dl"]');
      if (dlBtn) dlBtn.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
      await sleep(150);
      const cb = dl.querySelector('#recoverySaved'); if (cb && !cb.disabled) { cb.checked = true; cb.dispatchEvent(new B.w.Event('change', { bubbles: true })); }
      await sleep(150);
      dl.querySelector('[data-action="recovery-ack"]').dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
      break;
    }
  }
  return waitFor(() => !B.d.body.classList.contains('auth-gate'), 25000);
}

(async () => {
  /* ======================== static bundle checks (run first) ======================== */
  console.log('S. shipped bundle: no master-reset path at all');
  check(html0.indexOf('data-action="wipe"') === -1, 'no wipe button anywhere in the bundle');
  check((html0.replace(/<script[\s\S]*?<\/script>/gi, ' ').indexOf('Erase everything')) === -1, 'the words "Erase everything" are gone from the UI');   /* code comments may mention it; user-visible text must not */
  check(html0.indexOf('a === \'wipe\'') === -1 && html0.indexOf("a === 'wipe'") === -1, 'no wipe click handler in the bundle');
  check(html0.indexOf('__SPR_BUILD__') === -1, 'build marker replaced (fresh build, not a stale artifact)');
  check(html0.indexOf('data-action="load-sample"') !== -1 && html0.indexOf('danger-solid') !== -1, 'reset-to-sample present with danger-solid styling');
  check(html0.indexOf('Administrator only') !== -1, 'sample-reset has a defense-in-depth admin guard');

  /* ======================== A: admin checks ======================== */
  console.log('A. admin: data section gated + help page');
  const A = boot();
  await sleep(500);
  await ackPrivacy(A);
  check(await firstRun(A, 'Mo', PW), 'admin signed in via first-run setup');
  const ls = A.d.querySelector('[data-action="load-sample"]');
  if (ls) { click(A, ls); await sleep(900); }   /* sample data so the legacy shell renders */
  await go(A, '#/manage');

  check(/Data ?(—|:) ?administrator only/.test(txt(A)), 'Data section is labelled administrator-only');
  check(txt(A).indexOf('Erase everything') === -1, 'no Erase everything for the admin either (removed at owner request)');
  const rs = A.d.querySelector('[data-action="load-sample"].danger-solid');
  check(!!rs, 'Reset to sample data is the solid-red danger style');
  check(txt(A).indexOf('Real data is gone from this device') !== -1, 'reset disclaimer states exactly what happens');
  check(!!A.d.querySelector('.nav a[data-nav="help"]'), 'Help & training is in the sidebar');
  check(!!A.d.querySelector('[href="#/help"]'), 'Manage links to Help & training');
  check(txt(A).indexOf('Forgot your password?') !== -1, 'forgot-password hint points to admin reset');

  await go(A, '#/help');
  check(A.d.querySelectorAll('details.help-mod').length === 6, 'six training modules');
  check(!!A.d.querySelector('#reqType') && !!A.d.querySelector('#reqSubj') && !!A.d.querySelector('#reqBody'), 'request form fields present');
  check(!!A.d.querySelector('[data-action="req-email"]') && !!A.d.querySelector('[data-action="req-copy"]'), 'send-by-email + copy-text buttons present');
  check(!!A.d.querySelector('video[src*="Teacher-Video-Guide"]'), 'video guide embedded');
  check(!!A.d.querySelector('a[href*="Teachers-Operation-Manual"]'), 'manual PDF linked');

  setVal(A, A.d.getElementById('reqSubj'), 'Test subject');
  setVal(A, A.d.getElementById('reqBody'), 'Steps: opened Enter scores, typed 5, nothing saved.');
  click(A, A.d.querySelector('[data-action="req-copy"]'));
  await sleep(300);
  check(/Request copied|Could not copy/.test(toasts(A)), 'copy action gives a toast (clipboard or honest fallback)');
  check(A.d.getElementById('reqBody') !== null, 'page still alive after copy');

  /* admin password tools still there */
  await go(A, '#/manage');
  check(!!A.d.querySelector('[data-action="acct-add-open"]'), 'Add sign-in still present (admin)');
  check(!!A.d.querySelector('[data-action="change-pass-open"]'), 'Change my password still present');

  /* ======================== B: teacher (account created by the admin) ======================== */
  console.log('B. teacher: no master reset, help + password pointers');
  click(A, A.d.querySelector('[data-action="acct-add-open"]')); await sleep(300);
  setVal(A, A.d.getElementById('naUser'), 'anna');
  setVal(A, A.d.getElementById('naName'), 'Anna Teacher');
  setVal(A, A.d.getElementById('naRole'), 'teacher');
  setVal(A, A.d.getElementById('naPass'), 'anna-pass-1');
  setVal(A, A.d.getElementById('naConf'), 'anna-pass-1');
  click(A, A.d.querySelector('[data-action="acct-add"]'));
  /* two 600k PBKDF2 derivations (~2s) — wait for the account, don't guess */
  check(await waitFor(() => ((A.w.localStorage.getItem('spr-auth-v1') || '').indexOf('"anna"') !== -1), 20000), 'teacher account stored (anna)');

  /* the master-key wrap for the new account is written from SESSION.dk, which a
     real browser establishes on the reload after setup — jsdom cannot reload,
     so fabricate the SAME cryptographic state here with the app's own crypto
     (source/classstore.js is node-safe): unwrap the master key under the admin
     password, then wrap it under the teacher's password exactly as the app
     would. The teacher sign-in below therefore exercises the REAL path:
     login-wrap GCM verify -> master-wrap unwrap -> DB unseal. */
  const CS = require(path.join(__dirname, '..', 'source', 'classstore.js'));
  const auth0 = JSON.parse(A.w.localStorage.getItem('spr-auth-v1'));
  const v20 = JSON.parse(A.w.localStorage.getItem(V2STORE));
  const dk = await CS.unwrapKey(v20.wraps[Object.keys(v20.wraps)[0]], PW);
  auth0.users.push({ username: 'anna', name: 'Anna Teacher', role: 'teacher', login: await CS.loginWrap('anna-pass-1'), keyring: {} });
  v20.wraps.anna = await CS.wrapKey(dk, 'anna-pass-1');
  delete auth0.session;   /* never carry the admin's live session: the second window would auto-sign-in as Mo */
  const carryAuth = JSON.stringify(auth0);
  const V2SNAP = JSON.stringify(v20);
  const T = boot('try{localStorage.setItem("spr-auth-v1",' + JSON.stringify(carryAuth) + ');}catch(e){}' +
                 'try{localStorage.setItem("' + V2STORE + '",'+ JSON.stringify(V2SNAP) + ');}catch(e){}' +
                 'try{localStorage.setItem("spr-privacy-ack-v1","1");}catch(e){}');
  await sleep(600);
  await ackPrivacy(T);
  const tSetup = T.d.querySelector('[data-action="show-setup"]');
  check(!tSetup, 'teacher window is not in first-run mode (data carried)');
  setVal(T, T.d.getElementById('loginUser'), 'anna');
  setVal(T, T.d.getElementById('loginPass'), 'anna-pass-1');
  click(T, T.d.querySelector('[data-action="do-login"]'));
  check(await waitFor(() => !T.d.body.classList.contains('auth-gate'), 25000), 'teacher signed in with the password the admin issued');
  await go(T, '#/manage');

  check(!!T.d.querySelector('.nav a[data-nav="help"]'), 'teacher nav has Help & training');
  check(!T.d.querySelector('.nav a[data-nav="users"]'), 'teacher nav has no Users tab');
  check(txt(T).indexOf('Erase everything') === -1, 'teacher sees NO Erase everything');
  check(txt(T).indexOf('Data — administrator only') === -1, 'teacher sees no Data section at all');
  check(!T.d.querySelector('[data-action="load-sample"]'), 'teacher cannot reset to sample data either');
  check(txt(T).indexOf('Your account') !== -1 && !!T.d.querySelector('[data-action="change-pass-open"]'), 'teacher keeps Change-my-password');
  check(txt(T).indexOf('Forgot your password?') !== -1, 'teacher gets the forgot-password hint (ask admin)');

  await go(T, '#/help');
  check(T.d.querySelectorAll('details.help-mod').length === 6, 'teacher sees the six training modules too');
  check(!!T.d.querySelector('[data-action="req-email"]'), 'teacher can raise a request to the administrator');

  /* ======================== C: sign-in screen hint ======================== */
  console.log('C. sign-in screen points locked-out teachers at the admin reset');
  await go(T, '#/dashboard');
  const lo = T.d.querySelector('[data-action="logout"]');
  if (lo) { click(T, lo); await sleep(600); }
  /* doLogout clears the stored session then location.reload()s — jsdom cannot
     reload, so verify the cleared session and boot the page a real browser
     would reload into (same storage state) */
  check(await waitFor(() => { try { const a = JSON.parse(T.w.localStorage.getItem('spr-auth-v1') || '{}'); return !a.session; } catch (e) { return false; } }, 8000), 'teacher signed out (session cleared)');
  const T2 = boot('try{localStorage.setItem("spr-auth-v1",' + JSON.stringify(T.w.localStorage.getItem('spr-auth-v1')) + ');}catch(e){}' +
                  'try{localStorage.setItem("' + V2STORE + '",' + JSON.stringify(T.w.localStorage.getItem(V2STORE)) + ');}catch(e){}' +
                  'try{localStorage.setItem("spr-privacy-ack-v1","1");}catch(e){}');
  await sleep(700); await ackPrivacy(T2);
  check(T2.d.body.classList.contains('auth-gate'), 'post-logout page shows the sign-in gate');
  check(txt(T2).indexOf('Ask the administrator to reset it') !== -1, 'sign-in screen shows the forgot-password hint');

  console.log('\n' + ok + ' ok, ' + bad + ' FAIL');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL: suite crashed: ' + (e && e.stack || e)); process.exit(1); });
