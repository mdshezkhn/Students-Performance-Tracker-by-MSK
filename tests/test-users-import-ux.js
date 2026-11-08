/* round9 reviewer fix (2026-11-06): owner could not finish a roster import and the Back button on the Users page did nothing.
   T1 Back leaves Users; T2 a sheet with no class_role column needs ONE decision per pair (not one per class slot) and imports. */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

const appHtmlPath = ['../app/index.html', '../dist/app/index.html']
  .map((rel) => path.join(__dirname, rel)).find((p) => fs.existsSync(p));
if (!appHtmlPath) { console.log('FAIL: no app build'); process.exit(1); }
const html0 = fs.readFileSync(appHtmlPath, 'utf8');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'roster-owner.csv'), 'utf8');

let ok = 0, bad = 0;
function check(cond, msg) { if (cond) { ok++; console.log('  ok: ' + msg); } else { bad++; console.log('  FAIL: ' + msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(60); } return !!fn(); }
const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';
const PW = 'secret123';
const __alive = [];
/* close a helper window so jsdom timers keep firing in the survivor */
const shut = (B) => { const i = __alive.indexOf(B.dom); if (i >= 0) __alive.splice(i, 1); try { B.dom.window.close(); } catch (e) {} };

function boot(pre, hash) {
  const vc = new VirtualConsole();
  vc.on('log', (...a) => { const t = a.join(' '); if (t.indexOf('[rk9]') === 0) console.log('  [page]', t.slice(0, 180)); });
  vc.on('jsdomError', (e) => { if (!/window.scrollTo|navigation/.test(String(e.message))) console.log('  [page-err]', ((e.detail && e.detail.stack) || e.message || '').split(String.fromCharCode(10)).slice(0, 3).join(' | ').slice(0, 320)); });
  const html = html0.slice(0, html0.lastIndexOf('</body>')) + '<script>' + pre + '</script>' + html0.slice(html0.lastIndexOf('</body>'));
  const dom = new JSDOM(html, {
    url: 'http://localhost/app/index.html' + (hash || ''),
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 20000000,
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
      w.addEventListener('unhandledrejection', (ev) => { console.log('  [page-reject]', String((ev.reason && (ev.reason.stack || ev.reason.message)) || ev.reason).split(String.fromCharCode(10)).slice(0, 2).join(' | ').slice(0, 300)); });
    }
  });
  const w = dom.window;
  __alive.push(dom);
  while (__alive.length > 5) { try { __alive[0].window.close(); } catch (e) {} __alive.shift(); }
  return { w, d: dom.window.document, dom };
}
function click(B, el) { if (!el) throw new Error('click target missing'); el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }
function setVal(B, el, v) { if (!el) return; el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); }
function dlgEl(B, sel) { const dlg = B.d.getElementById('dlg'); return (dlg && dlg.open) ? dlg.querySelector(sel) : null; }
async function ackGate(B) {
  for (let i = 0; i < 6; i++) {
    const dlg = B.d.getElementById('dlg');
    if (!(dlg && dlg.open)) return;
    const b = dlg.querySelector('[data-action="privacy-gate-ack"], [data-action="privacy-ack"], [data-action="recovery-ack"]');
    if (!b) return;
    const cb = dlg.querySelector('#recoverySaved'); if (cb) cb.checked = true;
    click(B, b); await sleep(350);
  }
}
async function firstRunAdmin(B, user, pw) {
  await sleep(700); await ackGate(B);
  await waitFor(() => B.d.getElementById('suUser') || B.d.querySelector('[data-action="show-setup"]') || B.d.getElementById('loginUser'), 15000);
  if (!B.d.getElementById('suUser')) { const s = B.d.querySelector('[data-action="show-setup"]'); if (s) { click(B, s); await sleep(400); } }
  await waitFor(() => B.d.getElementById('suUser'), 10000);
  setVal(B, B.d.getElementById('suUser'), user);
  setVal(B, B.d.getElementById('suPass'), pw); setVal(B, B.d.getElementById('suConf'), pw);
  click(B, B.d.querySelector('[data-action="first-run"]'));
  /* P0 recovery path: set a master password, then Continue (enables it) */
  await waitFor(() => B.d.getElementById('mrPw'), 20000);
  setVal(B, B.d.getElementById('mrPw'), 'master-pw-9round');
  const rm = B.d.querySelector('[data-action="recovery-master"]');
  if (rm) click(B, rm);
  /* round10: the owner must also DOWNLOAD the owner recovery kit before Continue */
  await waitFor(() => { const k = B.d.querySelector('[data-action="owner-kit-dl"]'); return k && !k.disabled; }, 15000);
  const kb = B.d.querySelector('[data-action="owner-kit-dl"]');
  if (kb) click(B, kb);
  await waitFor(() => { const g = B.d.getElementById('recoveryGo'); return g && !g.disabled; }, 15000);
  const ra = B.d.querySelector('[data-action="recovery-ack"]');
  if (ra) click(B, ra);
  await waitFor(() => !B.d.body.classList.contains('auth-gate'), 25000);
  await sleep(600); await ackGate(B); await sleep(400);
}
async function loginAs(B, u, p) {
  await ackGate(B);
  setVal(B, B.d.getElementById('loginUser'), u);
  setVal(B, B.d.getElementById('loginPass'), p);
  click(B, B.d.querySelector('[data-action="do-login"]'));
  await waitFor(() => !B.d.body.classList.contains('auth-gate'), 25000);
  await sleep(400);
}
function giveFile(B, sel, text, name) {
  const f = new B.w.File([text], name || 'roster.csv', { type: 'text/csv' });
  const inp = B.d.querySelector(sel);
  Object.defineProperty(inp, 'files', { value: { 0: f, length: 1, item: () => f }, configurable: true });
  inp.dispatchEvent(new B.w.Event('change', { bubbles: true }));
}
const auth = (B) => JSON.parse(B.w.localStorage.getItem('spr-auth-v1') || '{"users":[]}');
const index = (B) => JSON.parse(B.w.localStorage.getItem('spr-class-index-v1') || '[]');
const classesOf = (B, un) => index(B).filter((c) => c.eal === un || c.support === un).map((c) => c.name).sort().join(',');
function capturePasswords(B) {
  const dlg = B.d.getElementById('dlg');
  const rows = {};
  if (dlg) Array.from(dlg.querySelectorAll('tbody tr')).forEach((tr) => {
    const tds = tr.querySelectorAll('td');
    if (tds.length === 2) rows[tds[0].textContent.trim()] = tds[1].textContent.trim();
  });
  return rows;
}
function snapshotSeed(B) {
  const keys = [];
  for (let i = 0; i < B.w.localStorage.length; i++) {
    const k = B.w.localStorage.key(i);
    if (k && (k.indexOf('spr-') === 0 || k === 'p4c4-markbook-v2')) keys.push(k);   /* V2_KEY is p4c4-markbook-v2 */
  }
  return keys.map((k) => {
    let v = B.w.localStorage.getItem(k);
    if (k === 'spr-auth-v1') { try { const a = JSON.parse(v); a.session = null; v = JSON.stringify(a); } catch (e) {} }   /* E signs in fresh */
    return 'try{localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(v) + ')}catch(e){}';
  }).join(';');
}

const OWNER = [
 'username,display_name,role,class_or_grade,School,paired_with,status',
 'MSK,MSK,Admin,All classes,All,,Active',
 'Anush,Anush,Teacher,"P1C1, P1C2, P1C3",ZFYBLS,Lily,Active',
 'Lily,Lily,Teacher,"P1C1, P1C2, P1C3",ZFYBLS,Anush,Active',
 'Anush,Anush,Teacher,P2C2,ZFYBLS,Tina,Active',
 'Tina,Tina,Teacher,P2C2,ZFYBLS,Anush,Active',
 'Kay,Kay,Teacher,P2C3,ZFYBLS,Tina,Active',
 'Tina,Tina,Teacher,P2C3,ZFYBLS,Kay,Active',
 'Kay,Kay,Teacher,"P3C2, P3C3",ZFYBLS,Sarah,Active',
 'Sarah,Sarah,Teacher,"P3C2, P3C3",ZFYBLS,Kay,Active',
 'Mo,Mo,Teacher,"P4C3, P5C3, P5C4",ZFYBLS,Lisa,Active',
 'Lisa,Lisa,Teacher,"P4C3, P5C3, P5C4",ZFYBLS,Mo,Active',
 'William,William,Teacher,"P4C4, P6C5, P6C6",ZFYBLS,Lisa,Active',
 'Lisa,Lisa,Teacher,"P4C4, P6C5, P6C6",ZFYBLS,William,Active'
].join('\r\n');
(async () => {
  console.log('== T1: Back button leaves the Users page ==');
  const A = boot(DLG_POLY + CHART_STUB, '');
  await firstRunAdmin(A, 'msk', PW);
  A.w.location.hash = '#/users'; await sleep(700);
  check(/Users/.test((A.d.querySelector('#app h1') || {}).textContent || ''), 'on the Users page');
  const back = A.d.querySelector('[data-action="go-back"]');
  check(!!back, 'Back button exists');
  if (back) { click(A, back); await sleep(700); }
  check(A.w.location.hash !== '#/users' && !/^Users$/.test((A.d.querySelector('#app h1') || {}).textContent || ''), 'Back leaves Users (hash=' + A.w.location.hash + ')');

  console.log('== T2: one decision per pair ==');
  A.w.location.hash = '#/users'; await sleep(700);
  giveFile(A, '#file-roster', OWNER, 'roster.csv'); await sleep(900);
  let dlg = A.d.getElementById('dlg');
  check(dlg && dlg.open && /8 account\(s\), 13 class\(es\)/.test(dlg.textContent), 'preview shows 8 accounts + 13 classes (owner row skipped)');
  const pk = Array.from(dlg.querySelectorAll('select[data-rolepick]'));
  check(pk.length === 6, 'exactly 6 pair decisions, one per partnership (got ' + pk.length + ')');
  const go = dlg.querySelector('[data-x="1"]');
  check(go && go.disabled, 'Import disabled until every pair is decided');
  check(/0 of 6/.test(dlg.textContent), 'dialog says how many pairs are decided ("0 of 6")');
  const pick = { 'anush|lily': 'anush', 'anush|tina': 'anush', 'kay|tina': 'kay', 'kay|sarah': 'kay', 'lisa|mo': 'lisa', 'lisa|william': 'lisa' };
  pk.forEach((s) => {
    const opts = Array.from(s.options).map((o) => o.value).filter(Boolean);
    const key = opts.slice().sort().join('|');
    s.value = pick[key] || opts[0];
    s.dispatchEvent(new A.w.Event('change', { bubbles: true }));
  });
  await sleep(300);
  check(!go.disabled, 'Import enabled after all 6 decided');
  check(/6 of 6/.test(dlg.textContent), 'counter reads 6 of 6');
  click(A, go);
  await waitFor(() => { const dl = A.d.getElementById('dlg'); return dl && dl.open && /password/i.test(dl.textContent); }, 170000);
  await waitFor(() => JSON.parse(A.w.localStorage.getItem('spr-class-index-v1') || '[]').length >= 13, 60000);
  const ix = JSON.parse(A.w.localStorage.getItem('spr-class-index-v1') || '[]');
  const of = (n) => ix.find((c) => c.name === n) || {};
  check(ix.length === 13, '13 classes created (got ' + ix.length + ')');
  check(of('P1C1').eal === 'anush' && of('P1C1').support === 'lily', 'P1C1: anush EAL, lily supporting');
  check(of('P5C4').eal === 'lisa' && of('P5C4').support === 'mo', 'P5C4: lisa EAL, mo supporting');
  check(of('P6C6').eal === 'lisa' && of('P6C6').support === 'william', 'P6C6: lisa EAL, william supporting');
  console.log('\nUSERS-IMPORT-UX: ' + ok + ' ok, ' + bad + ' FAIL');
  process.exit(bad ? 1 : 0);
})();
