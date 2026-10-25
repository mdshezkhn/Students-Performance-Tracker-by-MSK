/* simple-ui regression suite (branch simple-ui, 2026-10-24)
   A. stuck scenarios: (a) key missing, (b) blob undecryptable, (c) #/classes
   B. role-based sidebar (teacher four items; admin adds Users/Manage)
   C. #/users refused for non-admins by URL
   D. Users tab: list, search, CSV columns, no secrets in DOM/CSV
   E. disable/enable
   F. sync off => zero fetches on sign-in + save + online event */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

const appHtmlPath = ['../app/index.html', '../dist/app/index.html']   /* test what SHIPS (committed) first */
  .map((rel) => path.join(__dirname, rel)).find((p) => fs.existsSync(p));
if (!appHtmlPath) { console.log('FAIL: no app build (run python source/build2.py)'); process.exit(1); }
const html0 = fs.readFileSync(appHtmlPath, 'utf8');

let ok = 0, bad = 0;
function check(cond, msg) { if (cond) { ok++; console.log('  ok: ' + msg); } else { bad++; console.log('  FAIL: ' + msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(60); } return !!fn(); }
function fnv36(pw) { let h = 0x811c9dc5; const s = String(pw); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }

const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';
const PW = 'secret123';

const seeds = {
  auth: (users) => 'try{localStorage.setItem("spr-auth-v1",JSON.stringify({users:' + JSON.stringify(users) + ',session:null}))}catch(e){}',
  mode: (m) => 'try{localStorage.setItem("spr-mode-v1","' + m + '")}catch(e){}',
  index: (ix) => 'try{localStorage.setItem("spr-class-index-v1",JSON.stringify(' + JSON.stringify(ix) + '))}catch(e){}',
  blob: (id, v) => 'try{localStorage.setItem("spr-class-' + id + '",' + JSON.stringify(JSON.stringify(v)) + ')}catch(e){}'
};
const U = { username: 'Mo', name: 'Mo', role: 'admin', hash: fnv36(PW) };
const T = { username: 'anna', name: 'Anna', role: 'teacher', hash: fnv36(PW), keyring: { P4C4: 'notakey' } };
const P4 = { id: 'P4C4', name: 'P4C4', school: 'ZFY', eal: '', support: '', createdAt: 1790000000000 };

/* rich seed: a REAL class workbook + keyring (ClassStore crypto) so Mo can
   actually open the class — used for the nav/Users/zero-fetch scenarios */
function richSeed() {
  return DLG_POLY + CHART_STUB +
    '(async function(){' +
    ' while(!window.__CRYPTO_OK){await new Promise(function(r){setTimeout(r,10);});}' +
    ' try{' +
    '  var CS=window.ClassStore;' +
    '  var key=CS.genKey();' +
    '  var MN=["January","February","March","April","May","June","July","August","September","October","November","December"][new Date().getMonth()];' +
    '  var wb={sprClass:1,id:"P4C4",name:"P4C4",school:"ZFY",eal:"",support:"",settings:{autoTotal:true,spTotal:20,daTotal:10},currentSemesterId:"sem1",credit:"",author:"",audit:[],pending:[],' +
    '   semesters:[{id:"sem1",name:"Test 2026",year:2026,period:"Term 1",school:"ZFY",className:"P4C4",teachers:[],months:[MN],students:[{id:"STU-001",nameCn:"",nameEn:"Ali",gender:"m"}],observations:{},spelling:{},daily:{},tests:{}}]};' +
    '  localStorage.setItem("spr-class-P4C4",JSON.stringify(await CS.sealClass(wb,key)));' +
    '  localStorage.setItem("spr-class-index-v1",JSON.stringify([{id:"P4C4",name:"P4C4",school:"ZFY",eal:"",support:"",createdAt:Date.now(),updatedAt:Date.now(),pendingCount:0}]));' +
    '  localStorage.setItem("spr-mode-v1","class");' +
    '  var ring={};ring.P4C4=await CS.wrapKey(key,"' + PW + '");' +
    '  var login=await CS.loginWrap("' + PW + '");' +
    '  localStorage.setItem("spr-auth-v1",JSON.stringify({users:[{username:"Mo",name:"Mo",role:"admin",keyring:ring,login:login},{username:"anna",name:"Anna",role:"teacher",keyring:{},login:null}],session:null}));' +
    '  localStorage.setItem("spr-v2-v1",JSON.stringify({fmt:2,wraps:{},ts:Date.now()}));' +
    '  localStorage.setItem("spr-last-save-at",String(Date.now()-30000));' +
    '  window.__SEED_DONE=true;' +
    ' }catch(e){window.__SEED_ERR=String(e&&e.message||e);}' +
    '})();';
}
/* session seed: class blob + a GARBAGE session key => Open hits the
   decrypt-failure path (scenario b) without an auth gate */
function sessSeed() {
  return DLG_POLY + CHART_STUB +
    seeds.auth([U]) + seeds.mode('class') + seeds.index([P4]) + seeds.blob('P4C4', { fmt: 1 }) +
    'try{sessionStorage.setItem("spr-session",JSON.stringify({user:"Mo",dk:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",keys:{P4C4:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}))}catch(e){}';
}

function boot(pre, hash) {
  try { new Function(pre); } catch (e) { console.log('PRE-SCRIPT SYNTAX ERROR:', e.message); process.exit(2); }
  const vc = new VirtualConsole();
  const html = html0.slice(0, html0.lastIndexOf('</body>')) + '<script>' + pre + '</script>' + html0.slice(html0.lastIndexOf('</body>'));
  const dom = new JSDOM(html, {
    url: 'http://localhost/app/index.html' + (hash || ''),
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000,
    beforeParse(w) {
      try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
      w.__CRYPTO_OK = true;
      w.__FETCHES = [];
      w.fetch = function (url) { w.__FETCHES.push(String(url)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve('[]') }); };
      w.URL.createObjectURL = w.URL.createObjectURL || function () { return 'blob:test'; };
      const RealBlob = w.Blob;
      w.Blob = function (parts, opts) { if (parts && parts.length && typeof parts[0] === 'string') w.__LAST_BLOB_TEXT = parts[0]; return new RealBlob(parts, opts); };
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
    }
  });
  const w = dom.window, d = w.document;
  return { w, d };
}
function click(B, el) { if (!el) throw new Error('click target missing'); el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }
function setVal(B, el, v) { if (!el) return; el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); }
const dlgText = (B) => (((B.d.getElementById('dlg') || {}).textContent || ''));

async function ackPrivacy(B) {
  const b1 = B.d.querySelector('[data-action="privacy-gate-ack"]');
  if (b1 && B.d.getElementById('dlg') && B.d.getElementById('dlg').open) { click(B, b1); await sleep(300); }
  const b2 = B.d.querySelector('[data-action="privacy-ack"]');
  if (b2 && B.d.getElementById('dlg') && B.d.getElementById('dlg').open) { click(B, b2); await sleep(300); }
}
async function loginAs(B, u, p) {
  await ackPrivacy(B);
  setVal(B, B.d.getElementById('loginUser'), u);
  setVal(B, B.d.getElementById('loginPass'), p);
  click(B, B.d.querySelector('[data-action="do-login"]'));
  await waitFor(() => !B.d.body.classList.contains('auth-gate'), 25000);
}
const navIds = (B) => Array.from(B.d.querySelectorAll('.nav a')).map((a) => a.dataset.nav);

(async () => {
  /* ---- W: rich seed — the happy path ---- */
  console.log('== W: single class + key => straight to dashboard ==');
  const W = boot(richSeed(), '');
  await waitFor(() => W.w.__SEED_DONE || W.w.__SEED_ERR, 15000);
  check(!!W.w.__SEED_DONE, 'seed built with ClassStore crypto' + (W.w.__SEED_ERR ? ' (' + W.w.__SEED_ERR + ')' : ''));
  await sleep(300);
  await loginAs(W, 'Mo', PW);
  await waitFor(() => W.w.location.hash.indexOf('#/dashboard') === 0, 12000);   /* auto-open finishes its unwrap */
  check(W.w.location.hash.indexOf('#/dashboard') === 0, 'single class opens automatically (#/dashboard), got ' + W.w.location.hash);
  check(navIds(W).join(',') === 'dashboard,students,entry,reports,ranking,users,manage', 'admin sidebar: 4 tools + Ranking + Users + Manage');
  check(!W.d.getElementById('classSwitch'), 'no class switcher with a single class');
  check(/Updated/.test(W.d.getElementById('content').innerHTML), 'dashboard shows an Updated-at line');

  /* ---- D: Users tab (admin, class open) ---- */
  console.log('== D: Users tab ==');
  W.w.location.hash = '#/users';
  W.w.dispatchEvent(new W.w.Event('hashchange'));
  await sleep(600);
  check(!!W.d.getElementById('usersQ'), 'Users tab renders with a search box');
  const tbody = W.d.querySelector('#app table tbody');
  check(!!tbody && tbody.querySelectorAll('tr').length === 2, 'lists every account on the device');
  check(tbody.innerHTML.indexOf('keyring') === -1 && tbody.innerHTML.indexOf('secret123') === -1, 'no secrets in the table DOM');
  setVal(W, W.d.getElementById('usersQ'), 'anna');
  await sleep(300);
  const tbody2 = W.d.querySelector('#app table tbody');
  check(tbody2.querySelectorAll('tr').length === 1 && tbody2.textContent.includes('anna'), 'search filters the list');
  setVal(W, W.d.getElementById('usersQ'), '');
  await sleep(300);
  click(W, W.d.querySelector('[data-action="users-csv"]'));
  await sleep(200);
  const csv = String(W.w.__LAST_BLOB_TEXT || '');
  check(csv.split('\n')[0] === 'username,display_name,role,class_or_grade,paired_with,status', 'CSV header is exactly the agreed columns');
  check(csv.indexOf('keyring') === -1 && csv.indexOf('secret123') === -1, 'CSV carries no secrets');

  /* ---- E: disable/enable ---- */
  console.log('== E: disable/enable ==');
  const annaRow = () => Array.from(W.d.querySelectorAll('#app table tbody tr')).find((r) => r.textContent.includes('anna'));
  click(W, annaRow().querySelector('[data-action="user-toggle"]'));
  await sleep(400);
  check(/Disabled/.test(annaRow().textContent), 'account shows Disabled after toggle');
  check(JSON.parse(W.w.localStorage.getItem('spr-auth-v1')).users.find((u) => u.username === 'anna').disabled === true, 'disabled flag stored on the account');
  click(W, annaRow().querySelector('[data-action="user-toggle"]'));
  await sleep(300);
  check(!JSON.parse(W.w.localStorage.getItem('spr-auth-v1')).users.find((u) => u.username === 'anna').disabled, 'second toggle re-enables');

  /* ---- F: sync off => zero fetches ---- */
  console.log('== F: sync off => zero Supabase requests ==');
  check(W.w.__FETCHES.length === 0, 'zero network requests so far (sign-in + save + users tab), got ' + W.w.__FETCHES.length);
  W.w.location.hash = '#/dashboard';
  W.w.dispatchEvent(new W.w.Event('hashchange'));
  await sleep(400);
  try { W.w.SPR_DEBUG_SET_DB(W.w.SPR_DEBUG_GET_DB()); } catch (e) {}
  W.w.dispatchEvent(new W.w.Event('online'));
  await sleep(6000);   /* past the 4 s push debounce */
  check(W.w.__FETCHES.length === 0, 'still zero requests after save + online event (sync off), got ' + W.w.__FETCHES.length);

  /* ---- A/c: hash #/classes with a class present => working chooser ---- */
  console.log('== A/c: #/classes with a class present renders the chooser ==');
  const C = boot(
    seeds.auth([U, T]) + seeds.mode('class') + seeds.index([P4]) + seeds.blob('P4C4', { fmt: 1 }) + DLG_POLY, '#/classes');
  await sleep(400);
  await loginAs(C, 'Mo', PW);
  await sleep(700);
  check(C.w.location.hash.indexOf('#/classes') !== -1, 'admin without the key stays on a working chooser screen');
  check(!!C.d.querySelector('[data-action="class-open"][data-id="P4C4"]'), 'chooser shows the class Open button');
  check(!!C.d.querySelector('[data-action="logout"]'), 'chooser always shows Sign out');
  const appHtml = C.d.getElementById('app').innerHTML;
  const outsideDetails = appHtml.split('<details')[0];   /* everything rendered before the collapsed panel */
  check(outsideDetails.indexOf('Key &amp; link') === -1 && outsideDetails.indexOf('Export everything') === -1 && outsideDetails.indexOf('Import class file') === -1, 'no jargon buttons in the default admin view');
  check(appHtml.indexOf('<details') === -1 && appHtml.indexOf('Export everything') === -1, 'chooser has no Advanced panel at all - it lives in Manage & setup (2026-10-24 move)');

  /* ---- A/a: class present but key missing in session ---- */
  console.log('== A/a: Open with key missing => recovery dialog ==');
  click(C, C.d.querySelector('[data-action="class-open"][data-id="P4C4"]'));
  await waitFor(() => /Cannot open P4C4 yet/.test(dlgText(C)), 8000);
  check(/Cannot open P4C4 yet/.test(dlgText(C)), 'recovery dialog explains (key missing)');
  check(/Restore from a backup file/.test(dlgText(C)), 'one primary button (sync off => restore)');
  check(/Sign out/.test(C.d.getElementById('app').innerHTML), 'Sign out still visible behind the dialog');

  /* ---- A/b: blob present but undecryptable ---- */
  console.log('== A/b: undecryptable blob => recovery dialog ==');
  const D = boot(sessSeed(), '#/classes');
  await sleep(900);
  await ackPrivacy(D);
  check(!D.d.body.classList.contains('auth-gate'), 'session-seeded device skips the gate');
  const ob = D.d.querySelector('[data-action="class-open"][data-id="P4C4"]');
  check(!!ob, 'chooser reachable (session restored)');
  if (ob) {
    click(D, ob);
    await waitFor(() => /Could not open P4C4|Cannot open P4C4/.test(dlgText(D)), 8000);
    check(/Could not open P4C4|Cannot open P4C4/.test(dlgText(D)), 'recovery dialog explains (undecryptable blob)');
    check(/Restore from a backup file|Check for a newer copy/.test(dlgText(D)), 'one primary button offered');
  }

  /* ---- B+C: teacher sidebar + users URL guard ---- */
  console.log('== B+C: teacher view ==');
  const E = boot(
    seeds.auth([U, T]) + seeds.mode('class') + seeds.index([P4]) + seeds.blob('P4C4', { fmt: 1 }) + DLG_POLY, '#/users');
  await sleep(400);
  await loginAs(E, 'anna', PW);
  await sleep(700);
  check(navIds(E).length === 0 || navIds(E).join(',') === 'dashboard,students,entry,reports', 'teacher sidebar = Dashboard, Students, Enter scores, Report Cards (or chooser, no key)');
  check(E.w.location.hash !== '#/users', 'teacher opening #/users is redirected away');

  /* ---- X: Advanced lives on Manage & setup, never on the chooser (2026-10-24) ---- */
  console.log('== X: Advanced placement ==');
  check(E.w.location.hash.indexOf('#/classes') === 0 || E.w.location.hash.indexOf('#/dashboard') === 0, 'teacher landed somewhere sane: ' + E.w.location.hash);
  const Ehtml = E.d.getElementById('app').innerHTML + ((E.d.getElementById('content') || {}).innerHTML || '');
  check(Ehtml.indexOf('class-migrate-open') === -1 && Ehtml.indexOf('class-share') === -1 && Ehtml.indexOf('start-fresh') === -1, 'no technical buttons anywhere in the teacher view');
  const M = boot(richSeed(), '');
  await waitFor(() => M.w.__SEED_DONE || M.w.__SEED_ERR, 15000);
  await sleep(300);
  await loginAs(M, 'Mo', PW);
  await sleep(700);
  M.w.location.hash = '#/manage';
  await sleep(900);
  const Mhtml = (M.d.getElementById('content') || {}).innerHTML || '';
  check(Mhtml.indexOf('class-migrate-open') !== -1 || Mhtml.indexOf('class-pair') !== -1, 'Manage & setup hosts the Advanced panel (admin)');
  check(Mhtml.indexOf('start-fresh') !== -1, 'Start fresh is under Manage & setup Advanced');
  check(Mhtml.indexOf('<details') !== -1, 'Advanced is collapsed by default (<details>)');
  const Ch = boot(richSeed(), '');
  await waitFor(() => Ch.w.__SEED_DONE || Ch.w.__SEED_ERR, 15000);
  await sleep(300);
  await loginAs(Ch, 'Mo', PW);
  await sleep(700);
  Ch.w.localStorage.removeItem('spr-class-P4C4');   /* blob gone -> chooser on next navigation */
  Ch.w.location.hash = '#/classes';
  await sleep(500);
  const Chtml = Ch.d.getElementById('app').innerHTML;
  check(Chtml.indexOf('class-migrate-open') === -1 && Chtml.indexOf('data-action="class-pair"') === -1 && Chtml.indexOf('start-fresh') === -1, 'chooser screen carries no technical buttons (admin)');
  check(!!Ch.d.querySelector('[data-action="logout"]'), 'chooser still shows Sign out');
  Ch.w.location.hash = '#/manage';
  await sleep(500);
  check(Ch.w.location.hash === '#/manage', 'admin CAN reach #/manage');

  console.log(bad ? '\nSIMPLE-UI FAILURES: ' + bad : '\nSIMPLE-UI PASSED (' + ok + ')');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
