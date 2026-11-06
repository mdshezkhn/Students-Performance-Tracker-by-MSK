/* round9 task 2: Users tab = one row per person+partner, exactly like the
   owner's sheet; classes are the source of pairing; import/export round-trip;
   unassign re-keys the class. Fixture: tests/fixtures/roster-owner.csv (13
   rows, 9 accounts, 13 classes). Written BEFORE the implementation. */
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
    if (k && k.indexOf('spr-') === 0) keys.push(k);
  }
  return keys.map((k) => {
    let v = B.w.localStorage.getItem(k);
    if (k === 'spr-auth-v1') { try { const a = JSON.parse(v); a.session = null; v = JSON.stringify(a); } catch (e) {} }   /* E signs in fresh */
    return 'try{localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(v) + ')}catch(e){}';
  }).join(';');
}

(async () => {
  console.log('== A: build the export source (fixture import) ==');
  const A = boot(DLG_POLY + CHART_STUB, '');
  await firstRunAdmin(A, 'MSK', PW);
  A.w.location.hash = '#/users'; await sleep(500);
  giveFile(A, '#file-roster', FIXTURE, 'roster-owner.csv');
  await sleep(600);
  const goA = dlgEl(A, '[data-x="1"]');
  if (goA) click(A, goA);
  await waitFor(() => { const dl = A.d.getElementById('dlg'); return dl && dl.open && /password/i.test(dl.textContent); }, 150000);
  await waitFor(() => JSON.parse(A.w.localStorage.getItem('spr-auth-v1') || '{"users":[]}').users.length >= 9, 60000);
  await waitFor(() => JSON.parse(A.w.localStorage.getItem('spr-class-index-v1') || '[]').length >= 13, 120000);
  const dDone = dlgEl(A, '[data-x="1"]'); if (dDone) click(A, dDone);
  await sleep(400);

  const csvBtn = A.d.querySelector('[data-action="users-csv"]');
  check(!!csvBtn, 'Download list (CSV) present');
  if (csvBtn) click(A, csvBtn);
  await sleep(300);
  const csv = A.w.__LAST_BLOB_TEXT || '';
  check(csv.charCodeAt(0) === 0xFEFF, 'CSV starts with UTF-8 BOM (Excel-safe Chinese names)');
  check(/^username,display_name,role,class_or_grade,School,paired_with,status/.test(csv.slice(1)), 'CSV header exact');
  const csvRows = csv.slice(1).trim().split(/\r?\n/).length - 1;
  check(csvRows === 13, 'CSV carries 13 data rows (got ' + csvRows + ')');
  const stateSeed = snapshotSeed(A);
  const stateA = JSON.stringify({ users: auth(A).users.map((u) => [u.username, u.role]).sort(), ix: index(A).map((c) => [c.name, c.eal, c.support]).sort() });
  shut(A);
  console.log('== D: CSV export (BOM + exact header) and round trip ==');
  const D = boot(DLG_POLY + CHART_STUB, '');
  await firstRunAdmin(D, 'MSK', PW);
  D.w.location.hash = '#/users'; await sleep(500);
  D.w.location.hash = '#/users'; await sleep(500);
  giveFile(D, '#file-roster', csv, 'roundtrip.csv');
  await sleep(600);
  const goD = dlgEl(D, '[data-x="1"]');
  if (!goD) console.log('  [dbg] D dlg: ' + (((D.d.getElementById('dlg') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 160)));
  check(!!goD, 'round-trip preview opens (exported CSV re-importable)');
  if (goD) { const t=(D.d.getElementById('dlg').textContent || '').replace(/\s+/g, ' '); console.log('  [dbg] D apply disabled=' + goD.disabled + ' | ' + t.slice(0, 90) + ' || ' + t.slice(90, 400)); }
  if (goD) click(D, goD);
  await waitFor(() => { const dl = D.d.getElementById('dlg'); return dl && dl.open && /password/i.test(dl.textContent); }, 150000);
  await waitFor(() => JSON.parse(D.w.localStorage.getItem('spr-auth-v1') || '{"users":[]}').users.length >= 9, 60000);
  /* the class loop runs AFTER account creation: wait for the index too
     (the /password/i dialog match can hit the preview text mid-apply) */
  await waitFor(() => JSON.parse(D.w.localStorage.getItem('spr-class-index-v1') || '[]').length >= 13, 300000);
  await sleep(1500);
  const dDone2 = dlgEl(D, '[data-x="1"]'); if (dDone2) click(D, dDone2);
  await sleep(400);
  const strip = (B) => JSON.stringify({
    users: auth(B).users.map((u) => [u.username, u.role]).sort(),
    ix: index(B).map((c) => [c.name, c.eal, c.support]).sort()
  });
  const stripD = JSON.stringify({ users: auth(D).users.map((u) => [u.username, u.role]).sort(), ix: index(D).map((c) => [c.name, c.eal, c.support]).sort() });
  if (stateA !== stripD) console.log('  [dbg] A=' + stateA.slice(0, 160) + ' || D=' + stripD.slice(0, 160));
  check(stateA === stripD, 'round trip: identical account+assignment state');
  shut(D);
  try { __alive.forEach((dm) => dm.window.close()); } catch (e) {}
  console.log('ROUND-TRIP: ' + ok + ' ok, ' + bad + ' FAIL');
  process.exit(bad ? 1 : 0);
})();
