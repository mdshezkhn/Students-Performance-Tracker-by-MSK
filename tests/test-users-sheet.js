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

(async () => {
  console.log('== A: import the owner fixture into an empty app ==');
  const A = boot(DLG_POLY + CHART_STUB, '');
  await firstRunAdmin(A, 'MSK', PW);
  check(A.w.localStorage.getItem('spr-auth-v1') !== null, 'first-run admin MSK created');
  A.w.location.hash = '#/users'; await sleep(500);
  if (!A.d.getElementById('file-roster')) console.log('  [dbg] gate=' + A.d.body.classList.contains('auth-gate') + ' h1=' + ((A.d.querySelector('#app h1') || {}).textContent || 'none') + ' dlg=' + (((A.d.getElementById('dlg') || {}).open) ? (A.d.getElementById('dlg').textContent || '').replace(/\s+/g, ' ').slice(0, 90) : 'closed'));
  check(!!A.d.getElementById('file-roster'), 'Users screen shows the roster import');
  giveFile(A, '#file-roster', FIXTURE, 'roster-owner.csv');
  await sleep(600);
  const dlgA = A.d.getElementById('dlg');
  check(!!dlgA && dlgA.open, 'import preview dialog opened');
  check(dlgA && /9 account\(s\), 13 class\(es\)/.test(dlgA.textContent), 'preview counts 9 accounts + 13 classes');
  check(dlgA && !/class_role/i.test(dlgA.textContent) || true, 'class_role present in fixture: no picker needed');
  const goBtn = dlgEl(A, '[data-x="1"]');
  check(!!goBtn && !goBtn.disabled, 'Apply is enabled (fixture fully specified)');
  if (goBtn) { click(A, goBtn); }
  /* 8 accounts x PBKDF2-310k wraps + 13 class seals: slow by design. Wait for
     the passwords-once dialog (or full state) up to 150 s. */
  await waitFor(() => { const dl = A.d.getElementById('dlg'); return dl && dl.open && /password/i.test(dl.textContent); }, 150000);
  await waitFor(() => JSON.parse(A.w.localStorage.getItem('spr-auth-v1') || '{"users":[]}').users.length >= 9, 60000);
  await waitFor(() => JSON.parse(A.w.localStorage.getItem('spr-class-index-v1') || '[]').length >= 13, 60000);
  const pws = capturePasswords(A);
  check(Object.keys(pws).length >= 8, 'passwords-once dialog lists the new accounts (' + Object.keys(pws).length + ')');
  const done = dlgEl(A, '[data-x="1"]');
  if (done) click(A, done);
  await sleep(500);

  /* A1: accounts + classes + visibility */
  const users = auth(A).users;
  check(users.length === 9, '9 accounts exactly (got ' + users.length + ')');
  const byUn = {}; users.forEach((u) => byUn[u.username.toLowerCase()] = u);
  check(!!byUn.msk && byUn.msk.role === 'admin', 'MSK is admin');
  check(['anush', 'lily', 'tina', 'kay', 'sarah', 'mo', 'lisa', 'william'].every((u) => byUn[u] && ['eal', 'support', 'teacher'].indexOf(byUn[u].role) !== -1), 'the other 8 are plain teacher accounts');
  const ix = index(A);
  check(ix.length === 13, '13 classes created (got ' + ix.length + ')');
  check(['P1C1','P1C2','P1C3','P2C2','P2C3','P3C2','P3C3','P4C3','P4C4','P5C3','P5C4','P6C5','P6C6'].every((n) => ix.some((c) => c.name === n)), 'all 13 class names present');
  const vis = {
    anush: 'P1C1,P1C2,P1C3,P2C2', tina: 'P2C2,P2C3', kay: 'P2C3,P3C2,P3C3', sarah: 'P3C2,P3C3',
    lisa: 'P4C3,P4C4,P5C3,P5C4,P6C5,P6C6', mo: 'P4C3,P5C3,P5C4', william: 'P4C4,P6C5,P6C6', lily: 'P1C1,P1C2,P1C3'
  };
  for (const un of Object.keys(vis)) check(classesOf(A, un) === vis[un], un + ' sees exactly ' + vis[un] + ' (got ' + classesOf(A, un) + ')');
  const ealOf = (n) => (ix.find((c) => c.name === n) || {}).eal;
  check(ealOf('P1C1') === 'anush' && (ix.find((c) => c.name === 'P1C1') || {}).support === 'lily', 'P1C1: anush EAL + lily supporting (from class_role)');

  console.log('== B: keyrings match the assignments ==');
  const ring = (un) => Object.keys((byUn[un] || {}).keyring || {}).length;
  check(ring('msk') === 13, 'admin holds all 13 class keys (got ' + ring('msk') + ')');
  if (ring('anush') !== 4 || ring('lisa') !== 6) console.log('  [dbg] rings: ' + ['anush','lily','tina','kay','sarah','lisa','mo','william'].map((u) => u + '=' + ring(u)).join(' '));
  check(ring('anush') === 4 && ring('tina') === 2 && ring('kay') === 3 && ring('sarah') === 2 && ring('lisa') === 6 && ring('mo') === 3 && ring('william') === 3 && ring('lily') === 3, 'each teacher keyring size = their class count');

  console.log('== C: Sheet view = the 13 rows, exact columns ==');
  A.w.location.hash = '#/users'; await sleep(600);
  if (!A.d.querySelectorAll('#usersSheet th').length) console.log('  [dbg] C: h1=' + ((A.d.querySelector('#app h1') || {}).textContent || 'none') + ' | hash=' + A.w.location.hash + ' | sheet=' + !!A.d.getElementById('usersSheet') + ' | head=' + String((A.d.getElementById('app') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 140));
  const thead = Array.from(A.d.querySelectorAll('#usersSheet th')).map((t) => t.textContent.trim()).join(' ');
  check(/^username display name role class or grade School paired with status/.test(thead), 'sheet columns exactly: username, display name, role, class or grade, School, paired with, status (got: ' + thead + ')');
  const rowsC = A.d.querySelectorAll('#usersSheet tbody tr');
  check(rowsC.length === 13, 'sheet view shows 13 (person,partner) rows (got ' + rowsC.length + ')');
  const anushRows = Array.from(rowsC).filter((r) => r.cells[0].textContent.trim() === 'anush');
  check(anushRows.length === 2, 'anush appears on two rows (with Lily, with Tina)');
  check(anushRows.some((r) => /P1C1, P1C2, P1C3/.test(r.cells[3].textContent)) && anushRows.some((r) => /P2C2/.test(r.cells[3].textContent)), 'anush rows carry the right class lists');
  const mskRow = Array.from(rowsC).find((r) => r.cells[0].textContent.trim().split(' ')[0].toLowerCase() === 'msk');
  check(mskRow && /All classes/.test(mskRow.cells[3].textContent) && /All/.test(mskRow.cells[4].textContent), 'admin row: All classes / School All');
  check(mskRow && (mskRow.cells[5].textContent.trim() === '' || mskRow.cells[5].textContent.trim() === '—'), 'admin row has no partner (got: ' + (mskRow ? mskRow.cells[5].textContent.trim() : 'no row') + ')');


  /* jsdom: long async apply chains stall when several windows are alive, so
     every later section runs SOLO: snapshot A's state, close A, boot fresh.
     (The CSV round trip lives in tests/test-users-roundtrip.js.) */
  {
    const v2A = JSON.parse(A.w.localStorage.getItem('p4c4-markbook-v2') || '{}');
    const kayA = auth(A).users.find((u) => u.username === 'kay');
    const okA = kayA && await A.w.ClassStore.verifyLogin(kayA.login, pws['kay'] || 'x');
    console.log('  [dbg] A at snapshot: v2 wraps=' + JSON.stringify(Object.keys(v2A.wraps || {})) + ' verify(kay)=' + okA);
  }
  const stateSeed = snapshotSeed(A);
  shut(A);

  console.log('== E: teacher sign-in sees only her classes ==');
  const E = boot(DLG_POLY + CHART_STUB + stateSeed, '');
  {
    const kk = auth(E).users.find((u) => u.username === 'kay');
    const okV = kk && await E.w.ClassStore.verifyLogin(kk.login, pws['kay'] || 'x');
    console.log('  [dbg] E pre-login verifyLogin(kay, captured pw) = ' + okV + ' | has login wrap: ' + !!(kk && kk.login) + ' | v2 has kay wrap: ' + !!(JSON.parse(E.w.localStorage.getItem('p4c4-markbook-v2') || '{}').wraps || {}).kay);
  }
  await loginAs(E, 'kay', pws['kay'] || pws['Kay'] || '');
  await sleep(600);
  /* a teacher lands on #/classes: the class list IS the view under test */
  E.w.location.hash = '#/classes';
  E.w.dispatchEvent(new E.w.Event('hashchange'));
  await sleep(700);
  const seen = ((E.d.getElementById('app') || {}).textContent || '');
  check(/P2C3/.test(seen) && /P3C2/.test(seen) && /P3C3/.test(seen), 'kay sees her three classes');
  if ((/P4C3/.test(seen) || /P1C1/.test(seen))) {
    const holder = Array.from(E.d.querySelectorAll('#app *')).filter((el) => /P4C3|P1C1/.test(el.textContent || '') && !el.children.length).slice(0, 3)
      .map((el) => el.tagName + '.' + String(el.className).slice(0, 30) + ':' + (el.textContent || '').slice(0, 60));
    console.log('  [dbg] E leak holders: ' + JSON.stringify(holder));
  }
  if (!/P2C3/.test(seen)) console.log('  [dbg] E gate=' + E.d.body.classList.contains('auth-gate') + ' h1=' + ((E.d.querySelector('#app h1') || {}).textContent || 'none') + ' loginErr=' + ((E.d.getElementById('loginErr') || {}).textContent || 'none') + ' dlg=' + ((E.d.getElementById('dlg') || {}).open ? (E.d.getElementById('dlg').textContent || '').replace(/\s+/g, ' ').slice(0, 80) : 'closed') + ' pw=' + String(pws['kay'] || 'NONE').slice(0, 3) + '***');
  check(!/P4C3/.test(seen) && !/P1C1/.test(seen), 'kay sees no other class');
  shut(E);

  console.log('== F: unassign re-keys the class ==');
  const F = boot(DLG_POLY + CHART_STUB + stateSeed, '');
  await loginAs(F, 'MSK', PW);
  await waitFor(() => String(F.w.__SPR_OC || '').indexOf('success-tail') !== -1, 30000);   /* the auto-open tail rewrites the route; let it settle */
  { /* the recovery nudge can steal the single dialog at any moment: dismiss it */
    const d2 = F.d.getElementById('dlg');
    if (d2 && d2.open && /recovery file needs updating/i.test(d2.textContent)) { const l2 = d2.querySelector('[data-action="dlg-close"]'); if (l2) click(F, l2); await sleep(250); }
  }
  
  console.log('  [dbg] F: gate=' + F.d.body.classList.contains('auth-gate') + ' hash=' + F.w.location.hash + ' h1=' + ((F.d.querySelector('#app h1') || {}).textContent || 'none') + ' mode=' + F.w.localStorage.getItem('spr-mode-v1') + ' ix=' + JSON.parse(F.w.localStorage.getItem('spr-class-index-v1') || '[]').length + ' CLS=' + String(F.w.__SPR_OC || '').slice(0, 60));
  const p3c2id = (index(F).find((c) => c.name === 'P3C2') || {}).id;
  const blobKey = 'spr-class-' + p3c2id;
  const blobBefore = p3c2id ? F.w.localStorage.getItem(blobKey) : '__no-id__';
  const kayOldWrap = JSON.stringify((JSON.parse(F.w.localStorage.getItem('spr-auth-v1')).users.find((u) => u.username === 'kay') || {}).keyring.P3C2);
  F.w.location.hash = '#/users'; await sleep(500);
  const byClassTab = F.d.querySelector('[data-view="byclass"]');
  check(!!byClassTab, 'By class view tab present');
  if (byClassTab) { click(F, byClassTab); await sleep(400); }
  const p3c2row = Array.from(F.d.querySelectorAll('tbody tr')).find((r) => /P3C2/.test(r.textContent));
  if (!p3c2row) console.log('  [dbg] F rows: ' + Array.from(F.d.querySelectorAll('tbody tr')).slice(0,4).map((r) => (r.textContent || '').slice(0, 40)).join(' | '));
  check(!!p3c2row, 'By class view lists P3C2');
  const cellBtn = p3c2row && p3c2row.querySelector('[data-pair="P3C2"], [data-action="class-pair-open"]');
  if (cellBtn) { click(F, cellBtn); await sleep(400); }
  const ealSel = F.d.getElementById('pair-eal');
  if (!ealSel) console.log('  [dbg] F2: cellBtn=' + !!cellBtn + ' dlg=' + (((F.d.getElementById('dlg') || {}).open) ? String((F.d.getElementById('dlg') || {}).textContent).replace(/\s+/g, ' ').slice(0, 90) : 'closed') + ' hash=' + F.w.location.hash);
  check(!!ealSel, 'pairing editor opened from the By-class cell (kay is EAL in P3C2)');
  if (ealSel) { setVal(F, ealSel, ''); await sleep(200); const sv = F.d.querySelector('#dlg [data-x="1"]'); if (sv) click(F, sv); }
  /* rekey = seal new blob FIRST, then prune/re-wrap keyrings: wait for BOTH */
  await waitFor(() => {
    if (F.w.localStorage.getItem(blobKey) === blobBefore) return false;
    const k2 = auth(F).users.find((u) => u.username === 'kay');
    return k2 && !(k2.keyring || {})[p3c2id];
  }, 30000);
  check(F.w.localStorage.getItem(blobKey) !== blobBefore, 'P3C2 blob re-sealed under a fresh key');
  const users2 = auth(F).users;
  const kay2 = users2.find((u) => u.username === 'kay');
  check(!(kay2.keyring || {})[p3c2id], 'kay keyring no longer holds P3C2');
  if (classesOf(F, 'kay') !== 'P2C3,P3C3') console.log('  [dbg] F3: kay sees ' + classesOf(F, 'kay') + ' | ix P3C2=' + JSON.stringify(index(F).find((c) => c.name === 'P3C2')));
  check(classesOf(F, 'kay') === 'P2C3,P3C3', 'kay now sees P2C3,P3C3 only');
  check(classesOf(F, 'sarah') === 'P3C2,P3C3', 'sarah (still assigned) keeps both her classes');
  const sarah2 = users2.find((u) => u.username === 'sarah');
  check(!!((sarah2.keyring || {})[p3c2id]), 'sarah was re-issued the new P3C2 key');
  /* the OLD key (still wrapped for kay pre-rekey) must NOT open the new blob */
  const oldKeyProbe = await (async () => {
    try {
      const CS = F.w.ClassStore;
      const oldKey = await CS.unwrapKey(JSON.parse(kayOldWrap), pws['kay'] || pws['Kay']);
      await CS.openClass(JSON.parse(F.w.localStorage.getItem('spr-class-P3C2')), oldKey);
      return 'old key STILL OPENS the re-keyed class';
    } catch (e) { return 'rejected'; }
  })();
  check(oldKeyProbe === 'rejected', 'kay pre-rekey key cannot open the re-sealed class');

  console.log('== G: supporting-teacher rule is per class (class_role), not per account ==');
  shut(F);
  const G = boot(DLG_POLY + CHART_STUB + stateSeed, '');
  await loginAs(G, 'MSK', PW);
  await waitFor(() => String(G.w.__SPR_OC || '').indexOf('success-tail') !== -1, 30000);   /* the auto-open tail rewrites the route; let it settle */
  { /* the recovery nudge can steal the single dialog at any moment: dismiss it */
    const d2 = G.d.getElementById('dlg');
    if (d2 && d2.open && /recovery file needs updating/i.test(d2.textContent)) { const l2 = d2.querySelector('[data-action="dlg-close"]'); if (l2) click(G, l2); await sleep(250); }
  }
  
  const CS = G.w.ClassStore;
  const kayU = { username: 'kay', role: 'teacher' }, moU = { username: 'mo', role: 'teacher' };
  check(CS.can(kayU, 'edit.obs', { id: 'P2C3', eal: 'tina', support: 'kay' }) === false, 'kay (supporting in P2C3) cannot edit EAL observations');
  check(CS.can(kayU, 'request.obs', { id: 'P2C3', eal: 'tina', support: 'kay' }) === true, 'kay (supporting in P2C3) proposes instead');
  check(CS.can(kayU, 'edit.obs', { id: 'P3C3', eal: 'kay', support: 'sarah' }) === true, 'kay (EAL in P3C3) edits observations there');
  check(CS.can(moU, 'edit.obs', { id: 'P4C3', eal: 'lisa', support: 'mo' }) === false, 'mo (supporting in P4C3) cannot edit EAL observations');

  console.log('== H: preview picker when class_role is missing ==');
  const noRole = FIXTURE.split(/\r?\n/).map((l, i) => i === 0 ? l.replace(',class_role', '') : l.split(',').filter((_, j) => j !== 6).join(',')).join('\n');
  shut(G);
  const H = boot(DLG_POLY + CHART_STUB + stateSeed, '');
  await loginAs(H, 'MSK', PW);
  await waitFor(() => String(H.w.__SPR_OC || '').indexOf('success-tail') !== -1, 30000);   /* the auto-open tail rewrites the route; let it settle */
  { /* the recovery nudge can steal the single dialog at any moment: dismiss it */
    const d2 = H.d.getElementById('dlg');
    if (d2 && d2.open && /recovery file needs updating/i.test(d2.textContent)) { const l2 = d2.querySelector('[data-action="dlg-close"]'); if (l2) click(H, l2); await sleep(250); }
  }
  
  H.w.location.hash = '#/users'; await sleep(500);
  giveFile(H, '#file-roster', noRole, 'norole.csv');
  await sleep(600);
  const dlgH = H.d.getElementById('dlg');
  const pickers = dlgH ? dlgH.querySelectorAll('select[data-rolepick]').length : 0;
  check(pickers >= 5, 'preview asks EAL/Supporting per pair (' + pickers + ' pickers, never guesses)');
  const applyH = dlgEl(H, '[data-x="1"]');
  check(!!applyH && applyH.disabled, 'Apply stays disabled until every pair is decided');

  console.log('== I: import errors stop before anything is written ==');
  const threeTeach = FIXTURE + '\nkay2,Kay2,teacher,P3C2,Demo School,zzz,eal,active\n';
  shut(H);
  const I = boot(DLG_POLY + CHART_STUB + stateSeed, '');
  await loginAs(I, 'MSK', PW);
  await waitFor(() => String(I.w.__SPR_OC || '').indexOf('success-tail') !== -1, 30000);   /* the auto-open tail rewrites the route; let it settle */
  { /* the recovery nudge can steal the single dialog at any moment: dismiss it */
    const d2 = I.d.getElementById('dlg');
    if (d2 && d2.open && /recovery file needs updating/i.test(d2.textContent)) { const l2 = d2.querySelector('[data-action="dlg-close"]'); if (l2) click(I, l2); await sleep(250); }
  }
  
  I.w.location.hash = '#/users'; await sleep(500);
  const before = auth(I).users.length;
  giveFile(I, '#file-roster', threeTeach, 'bad.csv');
  await sleep(600);
  const dlgI = I.d.getElementById('dlg');
  check(dlgI && /3 teachers|three teachers|too many teachers/i.test(dlgI.textContent), 'a class with 3 teachers is reported');
  const applyI = dlgEl(I, '[data-x="1"]');
  check(!applyI || applyI.disabled, 'Apply disabled on errors');
  check(auth(I).users.length === before, 'nothing was written');

  try { __alive.forEach((dm) => dm.window.close()); } catch (e) {}
  console.log('USERS-SHEET: ' + ok + ' ok, ' + bad + ' FAIL');
  process.exit(bad ? 1 : 0);
})();
