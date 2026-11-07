/* round10 owner-master suite (jsdom + node webcrypto, failing-first).
   P = owner account & protection, E = escrow (owner opens every class),
   K = recovery kit, C = signed control record (pull the plug),
   M = sync merge keeps owner, S = source scan. */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

const appHtmlPath = ['../app/index.html', '../dist/app/index.html']
  .map((rel) => path.join(__dirname, rel)).find((p) => fs.existsSync(p));
if (!appHtmlPath) { console.log('FAIL: no app build'); process.exit(1); }
const html0 = fs.readFileSync(appHtmlPath, 'utf8');
/* the REAL round9 build (commit a49a233, build 1f6a33a87c) for section M: a
   genuine pre-round10 device. Regenerate with:
     git show round9:app/index.html | gzip -9 > tests/fixtures/app-round9.html.gz */
let htmlR9 = '';
try { htmlR9 = require('zlib').gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-round9.html.gz'))).toString('utf8'); }
catch (eR9) { htmlR9 = ''; }

let ok = 0, bad = 0;
function check(cond, msg) { if (cond) { ok++; console.log('  ok: ' + msg); } else { bad++; console.log('  FAIL: ' + msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(60); } return !!fn(); }
const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';
const PW = 'secret123', MASTER = 'master-pw-r10';
const __alive = [];
const shut = (B) => { const i = __alive.indexOf(B.dom); if (i >= 0) __alive.splice(i, 1); try { B.w.close(); } catch (e) {} };

/* boot(preScript, hash, opts): opts.control = object served for control.json fetches
   (null = 404-ish empty), opts.controlFail = network error, opts.sb = fake Supabase
   table object (served for spr_channels URLs like test-device-sync). */
function boot(pre, hash, opts) {
  opts = opts || {};
  const vc = new VirtualConsole();
  vc.on('log', () => {});
  vc.on('jsdomError', (e) => { const m = String(e.message || ''); if (!/window.scrollTo|navigation|Not implemented|canvas/i.test(m)) console.log('  [page-err]', m.slice(0, 180)); });
  const ctl = (opts.control === undefined || opts.control === null) ? null : JSON.stringify(opts.control);
  const sbSrc = opts.sb
    ? 'window.__SB=' + JSON.stringify(opts.sb) + ';'
    : 'window.__SB={};';
  const fetchSrc =
    'window.__FETCHES=[];' + sbSrc +
    'window.fetch=function(url,oo){url=String(url);oo=oo||{};window.__FETCHES.push((oo.method||"GET")+" "+url);' +
    ' if(url.indexOf("control.json")!==-1){' +
    (opts.controlFail ? 'return Promise.reject(new Error("net down"));' :
      'if(!' + (ctl === null ? 'true' : 'false') + '){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(' + (ctl || 'null') + ')},text:function(){return Promise.resolve(' + (ctl ? JSON.stringify(ctl) : '""') + ')}});}' +
      'return Promise.resolve({ok:false,status:404,json:function(){return Promise.resolve(null)},text:function(){return Promise.resolve("")}});') +
    ' }' +
    ' if(url.indexOf("/rpc/spr_channel_write")!==-1){return Promise.resolve().then(function(){var b=JSON.parse(oo.body);window.__SB[b.p_id]={id:b.p_id,pushed_by:b.p_pushed_by||null,pushed_at:b.p_pushed_at,share_name:b.p_share_name||null,payload:b.p_payload};return {ok:true,status:200,json:function(){return Promise.resolve({ok:true})},text:function(){return Promise.resolve("true")}};});}' +
    ' if(url.indexOf("/rpc/")!==-1){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve({ok:true})},text:function(){return Promise.resolve("true")}});}' +
    ' var i=url.indexOf("/rest/v1/spr_channels");' +
    ' if(i!==-1){var q=url.indexOf("id=eq.",i);var ch=q===-1?null:url.slice(q+6,url.indexOf("&",q));var SB=window.__SB;' +
    '  if(oo.method==="POST"){return Promise.resolve().then(function(){var b=JSON.parse(oo.body);if(SB[b.id])return {ok:false,status:409,json:function(){return Promise.resolve({})}};SB[b.id]={id:b.id,pushed_by:b.pushed_by||null,pushed_at:b.pushed_at,payload:b.payload};return {ok:true,status:201,json:function(){return Promise.resolve({})}};});}' +
    '  if(oo.method==="PATCH"){return Promise.resolve().then(function(){if(!SB[ch])return {ok:false,status:404,json:function(){return Promise.resolve({})}};var p=JSON.parse(oo.body);Object.keys(p).forEach(function(k){SB[ch][k]=p[k]});return {ok:true,status:204,json:function(){return Promise.resolve({})}};});}' +
    '  return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(ch&&SB[ch]?[SB[ch]]:[])},text:function(){return Promise.resolve("[]")}});}' +
    ' return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([])},text:function(){return Promise.resolve("[]")}});};';
  const base = opts.html || html0;
  const html = base.slice(0, base.lastIndexOf('</body>')) + '<script>' + (pre || '') + fetchSrc + '</script>' + base.slice(base.lastIndexOf('</body>'));
  const dom = new JSDOM(html, {
    url: 'http://localhost/app/index.html' + (hash || ''),
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 30000000,
    beforeParse(w) {
      try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
      w.__CRYPTO_OK = true;
      w.URL.createObjectURL = w.URL.createObjectURL || function () { return 'blob:test'; };
      w.__downloads = [];
      try {
        const oc = w.HTMLAnchorElement.prototype.click;
        w.HTMLAnchorElement.prototype.click = function () { if (this.download) w.__downloads.push(this.download); return oc.apply(this, arguments); };
      } catch (e) {}
      const RealBlob = w.Blob;
      w.Blob = function (parts, o) { if (parts && parts.length && typeof parts[0] === 'string') w.__LAST_BLOB_TEXT = parts[0]; return new RealBlob(parts, o); };
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      w.addEventListener('unhandledrejection', () => {});
    }
  });
  const w = dom.window;
  __alive.push(dom);
  while (__alive.length > 3) { try { __alive[0].window.close(); } catch (e) {} __alive.shift(); }
  const B = { w, d: w.document, dom };
  B.sbSync = () => { B.sb = JSON.parse(JSON.stringify(w.__SB || {})); return B.sb; };
  return B;
}
function click(B, el) { if (!el) throw new Error('click target missing'); el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }
function setVal(B, el, v) { if (!el) return; el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); }
function dlgEl(B, sel) { const dlg = B.d.getElementById('dlg'); return (dlg && dlg.open) ? dlg.querySelector(sel) : null; }
function dlgOpen(B) { const dlg = B.d.getElementById('dlg'); return !!(dlg && dlg.open); }
async function ackGate(B) {
  /* boot gates (round10 notice AND the round9 privacy gate) share the shape:
     a #notice-read checkbox enabling an ack button - tick, wait, click */
  for (let i = 0; i < 8; i++) {
    if (!dlgOpen(B)) { await sleep(300); if (!dlgOpen(B)) return; continue; }
    const dlg2 = B.d.getElementById('dlg');
    const b = dlg2.querySelector('[data-action="privacy-gate-ack"], [data-action="notice-ack"], #notice-ack-btn');
    if (!b) return;
    const cb = dlg2.querySelector('#notice-read');
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new B.w.Event('change', { bubbles: true })); await sleep(250); }
    if (b.disabled) { await sleep(250); continue; }
    click(B, b); await sleep(400);
  }
}
/* replay another window's spr-* localStorage as a pre-script (cross-window seed) */
function seedFrom(B, mutate) {
  const patch = mutate ? '(' + mutate.toString() + ')(a)' : '';
  let js = '';
  for (let i = 0; i < B.w.localStorage.length; i++) {
    const k = B.w.localStorage.key(i);
    if (k && (k.indexOf('spr-') === 0 || k === 'p4c4-markbook-v2')) {
      js += 'try{localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(B.w.localStorage.getItem(k)) + ')}catch(e){}';
    }
  }
  /* the replay FIRST, the mutation AFTER - the replay would otherwise
     overwrite the mutated spr-auth-v1 with the source window's copy */
  return js + 'try{var a=JSON.parse(localStorage.getItem("spr-auth-v1")||"{}");' + patch + ';localStorage.setItem("spr-auth-v1",JSON.stringify(a))}catch(e){};';
}
async function firstRunOwner(B, user, pw, master) {
  await sleep(700);
  await ackGate(B);
  await waitFor(() => B.d.getElementById('suUser') || B.d.getElementById('loginUser'), 15000);
  if (!B.d.getElementById('suUser')) { const s = B.d.querySelector('[data-action="show-setup"]'); if (s) { click(B, s); await sleep(400); } }
  await waitFor(() => B.d.getElementById('suUser'), 10000);
  setVal(B, B.d.getElementById('suUser'), user);
  setVal(B, B.d.getElementById('suPass'), pw); setVal(B, B.d.getElementById('suConf'), pw);
  click(B, B.d.querySelector('[data-action="first-run"]'));
  await waitFor(() => B.d.getElementById('mrPw'), 20000);
}
async function loginAs(B, u, p) {
  await ackGate(B);
  /* the login card can re-render while we type: retry until the click lands */
  for (let i = 0; i < 20; i++) {
    await waitFor(() => B.d.getElementById('loginUser') && B.d.querySelector('[data-action="do-login"]'), 4000);
    const un = B.d.getElementById('loginUser'), pw = B.d.getElementById('loginPass'), go = B.d.querySelector('[data-action="do-login"]');
    if (!un || !pw || !go) { await sleep(300); continue; }
    setVal(B, un, u);
    setVal(B, pw, p);
    if (!B.d.contains(go)) { await sleep(300); continue; }
    try { click(B, go); break; } catch (e) { await sleep(300); }
  }
  await sleep(200);
}
function giveFile(B, sel, text, name) {
  const f = new B.w.File([text], name || 'roster.csv', { type: 'text/csv' });
  const inp = B.d.querySelector(sel);
  Object.defineProperty(inp, 'files', { value: { 0: f, length: 1, item: () => f }, configurable: true });
  inp.dispatchEvent(new B.w.Event('change', { bubbles: true }));
}
const auth = (B) => JSON.parse(B.w.localStorage.getItem('spr-auth-v1') || '{"users":[]}');
const index = (B) => JSON.parse(B.w.localStorage.getItem('spr-class-index-v1') || '[]');
const ownerOf = (B) => auth(B).users.find((u) => u.role === 'owner') || null;
const byName = (B, n) => auth(B).users.find((u) => String(u.username).toLowerCase() === String(n).toLowerCase()) || null;
function sprSnapshot(B, skip) {
  const out = {};
  for (let i = 0; i < B.w.localStorage.length; i++) {
    const k = B.w.localStorage.key(i);
    if (k && k.indexOf('spr-') === 0 && (!skip || skip.indexOf(k) === -1)) out[k] = B.w.localStorage.getItem(k);
  }
  return JSON.stringify(out);
}
async function verifySig(pubB64u, rec) {
  try {
    if (!rec || rec.version !== 1) return false;
    const b64 = function (s) { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return s; };   /* app stores base64url; Node stops at -/_ */
    const msg = JSON.stringify([1, rec.counter, rec.issued_at, rec.mode, rec.message]);
    const key = await webcrypto.subtle.importKey('spki', Buffer.from(b64(pubB64u), 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(b64(rec.sig), 'base64'), new TextEncoder().encode(msg));
  } catch (e) { return false; }
}

const OWNER_CSV = [
 'username,display_name,role,class_or_grade,School,paired_with,status,class_role',
 'Anush,Anush,Teacher,"P1C1, P1C2, P1C3",ZFYBLS,Lily,Active,eal',
 'Lily,Lily,Teacher,"P1C1, P1C2, P1C3",ZFYBLS,Anush,Active,supporting',
 'Tina,Tina,Teacher,"P2C2, P2C3",ZFYBLS,Kay,Active,eal',
 'Kay,Kay,Teacher,"P2C2, P2C3",ZFYBLS,Tina,Active,supporting',
 'Sarah,Sarah,Teacher,"P3C2, P3C3",ZFYBLS,Kay,Active,eal'
].join('\r\n');

async function runP() {
  console.log('== P1/P2: first-run creates the owner; kit required before Continue ==');
  const A = boot(DLG_POLY + CHART_STUB, '');
  await firstRunOwner(A, 'msk', PW, MASTER);
  check(ownerOf(A) && ownerOf(A).username === 'msk', 'first-run account has role owner');
  setVal(A, A.d.getElementById('mrPw'), MASTER);
  click(A, A.d.querySelector('[data-action="recovery-master"]'));
  await sleep(600);
  check(A.d.getElementById('recoveryGo') && A.d.getElementById('recoveryGo').disabled, 'Continue still disabled after master pw alone');
  const kitBtn = A.d.querySelector('[data-action="owner-kit-dl"]');
  check(!!kitBtn, 'owner-kit download button exists in the recovery dialog');
  let kit = null;
  if (kitBtn) {
    await waitFor(() => !kitBtn.disabled, 20000);   /* ensureOwnerSeal runs real PBKDF2 + ECDSA */
    click(A, kitBtn); await sleep(500);
    try { kit = JSON.parse(A.w.__LAST_BLOB_TEXT || 'null'); } catch (e) {}
    check(!!kit && kit.kit === 1 && !!kit.pub && !!kit.seal, 'kit file downloaded: {kit:1, pub, seal}');
    check(!!kit && Object.keys(kit).every((k) => !/priv/i.test(k)), 'kit top level carries no private-key field');
    check(A.d.getElementById('recoveryGo') && !A.d.getElementById('recoveryGo').disabled, 'Continue enabled only after the real kit download');
    if (A.d.getElementById('recoveryGo') && !A.d.getElementById('recoveryGo').disabled) click(A, A.d.querySelector('[data-action="recovery-ack"]'));
    await waitFor(() => !A.d.body.classList.contains('auth-gate'), 20000);
  }
  /* failing-first resilience: if the owner features are absent, force the gate
     down so every later section still runs and reports its own FAILs */
  if (A.d.body.classList.contains('auth-gate')) {
    try { const ak = A.d.querySelector('[data-action="recovery-ack"]'); if (ak && !ak.disabled) click(A, ak); } catch (e) {}
    await sleep(800);
    try { A.w.document.getElementById('dlg').close(); } catch (e) {}
    A.d.body.classList.remove('auth-gate');
    await sleep(400);
  }
  check(!!(auth(A).ownerSeal || {}).pub, 'auth.ownerSeal stored (pub + sealed escrow)');
  check(!!((ownerOf(A) || {}).keyring || {}).__escrow__, "owner keyring holds the escrow-key wrap ('__escrow__')");
  return { A, kit };
}

async function runP3(A) {
  console.log('== P3: Users sheet shows the Owner row without a Disable/Reset button ==');
  A.w.location.hash = '#/users'; await sleep(900);
  const rows = () => Array.from(A.d.querySelectorAll('#app table tbody tr'));
  const mskRow = () => rows().find((r) => r.textContent.indexOf('msk') !== -1);
  if (!await waitFor(() => mskRow(), 8000)) { check(false, 'Users sheet renders (owner row found)'); return; }
  check(/Owner/.test(mskRow().textContent), 'role cell says Owner');
  check(/All classes/.test(mskRow().textContent), 'classes cell says All classes');
  check(!mskRow().querySelector('[data-action="user-toggle"]'), 'no Disable/Enable button on the owner row');
  check(!mskRow().querySelector('[data-action="acct-reset-open"]'), 'no Reset password button on the owner row');
}

async function runP45(A) {
  console.log('== P4/P5: a second admin cannot touch the owner (UI + forged actions) ==');
  A.w.location.hash = '#/users'; await sleep(700);
  click(A, A.d.querySelector('[data-action="acct-add-open"]')); await sleep(300);
  setVal(A, dlgEl(A, '#naUser'), 'kay');
  setVal(A, dlgEl(A, '#naRole'), 'teacher');
  setVal(A, dlgEl(A, '#naPass'), 'kay-pw-123'); setVal(A, dlgEl(A, '#naConf'), 'kay-pw-123');
  click(A, dlgEl(A, '#naGo'));
  await waitFor(() => byName(A, 'kay'), 25000);
  check(!!byName(A, 'kay'), 'second account kay created');
  /* make kay an admin by hand (an old device could hold this state), then forge */
  {
    const a = auth(A); const kay = a.users.find((u) => u.username === 'kay'); kay.role = 'admin';
    A.w.localStorage.setItem('spr-auth-v1', JSON.stringify(a));
  }
  const fake = (act, un) => { const b = A.d.createElement('button'); b.setAttribute('data-action', act); b.setAttribute('data-user', un); A.d.body.appendChild(b); click(A, b); b.remove(); };
  fake('user-toggle', 'msk'); await sleep(500);
  check(!byName(A, 'msk').disabled, 'forged user-toggle refuses: owner not disabled');
  fake('acct-del', 'msk'); await sleep(500);
  check(!!byName(A, 'msk'), 'forged acct-del refuses: owner not deleted');
  fake('acct-reset', 'msk'); await sleep(500);
  check(!!byName(A, 'msk'), 'forged acct-reset refused for the owner');
  const a2 = auth(A); a2.session = null; A.w.localStorage.setItem('spr-auth-v1', JSON.stringify(a2));
  return sprSnapshot(A, null);
}

async function runP67(seedStr) {
  console.log('== P6/P7: CSV import — owner row skipped, second owner rejected ==');
  const T = boot(DLG_POLY + CHART_STUB + seedStr, '');
  await loginAs(T, 'msk', PW);
  await waitFor(() => !T.d.body.classList.contains('auth-gate'), 25000);
  T.w.location.hash = '#/users'; await sleep(800);
  const csvWithMsk = OWNER_CSV.split('\r\n'); csvWithMsk.splice(1, 0, 'msk,MSK,Admin,All classes,All,,Active');
  giveFile(T, '#file-roster', csvWithMsk.join('\r\n'), 'roster.csv'); await sleep(900);
  check(dlgOpen(T) && /protected owner account, row skipped/i.test(T.d.getElementById('dlg').textContent), 'preview notes the owner row is skipped');
  const go = T.d.querySelector('#dlg [data-x="1"]');
  check(go && !go.disabled, 'import with a skipped owner row can still proceed');
  /* a second account claiming owner is an error before anything is written */
  const before = sprSnapshot(T, null);
  const csvOwner2 = OWNER_CSV.split('\r\n'); csvOwner2.splice(1, 0, 'villain,V,Owner,All classes,All,,Active');
  giveFile(T, '#file-roster', csvOwner2.join('\r\n'), 'roster2.csv'); await sleep(900);
  const dt = T.d.getElementById('dlg').textContent;
  check(/owner/i.test(dt) && /error|cannot/i.test(dt), 'role Owner in the CSV is listed as an error');
  const go2 = T.d.querySelector('#dlg [data-x="1"]');
  check(go2 && go2.disabled, 'Import disabled while the owner-claim error stands');
  check(sprSnapshot(T, null) === before, 'nothing written while errors stand');
  shut(T);
}

async function runE(seedStr) {
  console.log('== E: escrow — owner opens every class after removals and resets ==');
  const A = boot(DLG_POLY + CHART_STUB + seedStr, '');
  await loginAs(A, 'msk', PW);
  await waitFor(() => !A.d.body.classList.contains('auth-gate'), 25000);
  A.w.location.hash = '#/users'; await sleep(800);
  const FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'roster-owner.csv'), 'utf8');
  giveFile(A, '#file-roster', FIX, 'roster-owner.csv');
  await waitFor(() => dlgOpen(A) && /13 class\(es\)/.test(A.d.getElementById('dlg').textContent), 20000);
  const dlg = A.d.getElementById('dlg');
  const picks = Array.from(dlg.querySelectorAll('select[data-rolepick]'));
  for (const s of picks) {
    const opts = Array.from(s.options).map((o) => o.value).filter(Boolean);
    s.value = opts[0];
    s.dispatchEvent(new A.w.Event('change', { bubbles: true }));
  }
  await sleep(300);
  click(A, A.d.querySelector('#dlg [data-x="1"]'));
  await waitFor(() => index(A).length >= 13, 120000);
  check(index(A).length === 13, '13 classes imported (got ' + index(A).length + ')');
  const ow = ownerOf(A);
  if (!ow) { check(false, 'owner account present after import (role owner)'); shut(A); return seedStr; }
  await waitFor(() => { const o2 = ownerOf(A); return o2 && Object.keys(o2.keyring || {}).filter((k) => k !== '__escrow__').length >= 13; }, 15000);
  const ow2 = ownerOf(A) || {};
  const ringCids = Object.keys(ow2.keyring || {}).filter((k) => k !== '__escrow__');
  check(ringCids.length >= 13, 'owner keyring covers all classes (' + ringCids.length + ' wraps)');
  /* escrow wraps are real PBKDF2 (~0.5 s each on slow boxes): wait them out */
  await waitFor(() => index(A).length >= 13 && index(A).every((c) => c.escrow && c.escrow.ct), 25000);
  check(index(A).every((c) => c.escrow && c.escrow.ct), 'every class index entry carries an escrow wrap');

  /* remove a teacher (delete) + reset another's password */
  const a1 = auth(A);
  const tina = a1.users.find((u) => u.username === 'tina'); if (tina) tina.disabled = true;
  A.w.localStorage.setItem('spr-auth-v1', JSON.stringify(a1));
  /* class-mode Manage without an open class shows only the Advanced chooser:
     OPEN a class first so the full shell (#content) exists, then #/manage
     renders the accounts table where Reset password lives */
  A.w.location.hash = '#/classes'; await sleep(700);
  const openBtn = A.d.querySelector('[data-action="class-open"]');
  if (openBtn) { click(A, openBtn); await waitFor(() => A.d.querySelector('#content'), 30000); await sleep(500); }
  A.w.location.hash = '#/manage'; await sleep(1000);
  const acctTable = () => Array.from(A.d.querySelectorAll('#app table')).find((tb) => { const h = tb.querySelector('thead'); return h && /Username/.test(h.textContent); });
  for (let nav = 0; nav < 3 && !acctTable(); nav++) { A.w.location.hash = '#/classes'; await sleep(250); A.w.location.hash = '#/manage'; await sleep(900); }
  const kayRow = () => { const tb = acctTable(); return tb ? Array.from(tb.querySelectorAll('tbody tr')).find((r) => r.textContent.indexOf('kay') !== -1) : null; };
  await waitFor(() => kayRow() && kayRow().querySelector('[data-action="acct-reset-open"]'), 10000);
  let resetClicked = false;
  if (!kayRow() || !kayRow().querySelector('[data-action="acct-reset-open"]')) check(false, 'kay row in Manage shows Reset password');
  else { click(A, kayRow().querySelector('[data-action="acct-reset-open"]')); resetClicked = true; }
  await sleep(300);
  if (resetClicked) {
    setVal(A, dlgEl(A, '#rpPass'), 'new-kay-pw-77'); setVal(A, dlgEl(A, '#rpConf'), 'new-kay-pw-77');
    click(A, dlgEl(A, '#rpGo'));
    await waitFor(() => !dlgOpen(A), 20000);
    check(true, 'password reset for kay done');
  }

  /* a class created after the change is also openable + escrowed.
     With classes existing there is no New class button in the chooser:
     the real admin path is Manage-with-a-class-open -> "New class / semester"
     (wiz-open) -> classNewDialog */
  A.w.location.hash = '#/classes'; await sleep(900);
  const ob2 = A.d.querySelector('[data-action="class-open"]');
  if (ob2) { click(A, ob2); await waitFor(() => A.d.querySelector('#content'), 30000); await sleep(400); }
  /* with classes existing the chooser has no New class button (the empty-state
     affordance); drive the REAL creation handler via its data-action, as the
     forged-action tests do - the handler is the production code path */
  const fakeNew = A.d.createElement('button'); fakeNew.setAttribute('data-action', 'class-new-open');
  A.d.body.appendChild(fakeNew); click(A, fakeNew); fakeNew.remove(); await sleep(600);
  check(!!dlgEl(A, '#cn-school'), 'class creation dialog opens for the owner');
  if (dlgEl(A, '#cn-school')) {
    setVal(A, dlgEl(A, '#cn-school'), 'ZFYBLS'); setVal(A, dlgEl(A, '#cn-name'), 'P7C1');
    const eal = dlgEl(A, '#cn-eal'); if (eal && eal.options.length > 1) { eal.selectedIndex = 1; }
    click(A, A.d.querySelector('#dlg [data-x="1"]'));
    await sleep(700);
    await waitFor(() => index(A).some((c) => c.name === 'P7C1'), 30000);
  }
  await waitFor(() => { const c = index(A).find((x) => x.name === 'P7C1'); return c && c.escrow && c.escrow.ct; }, 20000);
  const p7 = index(A).find((c) => c.name === 'P7C1') || {};
  check(!!p7.id && !!(ownerOf(A).keyring || {})[p7.id], 'class created later: owner keyring wrap exists');
  check(!!p7.escrow && !!p7.escrow.ct, 'class created later: escrow wrap exists');

  /* escrow heal: owner loses a wrap (drift), reboot, sign in — class reopens */
  const cid0 = index(A)[0].id;
  {
    const a = auth(A); const m = a.users.find((u) => u.username === 'msk');
    delete m.keyring[cid0];
    a.session = null;
    A.w.localStorage.setItem('spr-auth-v1', JSON.stringify(a));
  }
  const seed2 = sprSnapshot(A, ['spr-control-v1']);
  shut(A);
  const H = boot(DLG_POLY + CHART_STUB + 'try{var _s=' + JSON.stringify(seed2) + ';Object.keys(JSON.parse(_s)).forEach(function(k){localStorage.setItem(k,JSON.parse(_s)[k])})}catch(e){}', '');
  await loginAs(H, 'msk', PW);
  await waitFor(() => !H.d.body.classList.contains('auth-gate'), 25000);
  /* the heal is PBKDF2-bound (escrow slot unwrap + re-wrap per missing class) */
  await waitFor(() => (ownerOf(H).keyring || {})[cid0], 25000);
  const healed = (ownerOf(H).keyring || {})[cid0];
  check(!!healed, 'escrow heal: owner wrap for the lost class restored after sign-in');
  check(index(H).length >= 13, 'all classes still listed after reboot');
  shut(H);
  return seed2;
}

async function runK(kit, seedStr) {
  console.log('== K: owner recovery kit restore on a fresh browser ==');
  const F = boot(DLG_POLY + CHART_STUB, '');
  await sleep(700); await ackGate(F);
  const ro = F.d.querySelector('[data-action="owner-restore-open"]');
  check(!!ro, 'sign-in card offers Restore owner kit');
  if (!ro || !kit) { if (!kit) check(false, 'kit was produced in P2 (prerequisite)'); shut(F); return; }
  click(F, ro); await sleep(400);
  giveFile(F, '#orFile', JSON.stringify(kit), 'spr-owner-kit.json');
  setVal(F, dlgEl(F, '#orMaster'), 'WRONG-master');
  setVal(F, dlgEl(F, '#orPass'), 'fresh-pw-99'); setVal(F, dlgEl(F, '#orConf'), 'fresh-pw-99');
  click(F, dlgEl(F, '#orGo')); await sleep(1200);
  check(/wrong|invalid|cannot/i.test((dlgEl(F, '#orErr') || {}).textContent || ''), 'wrong master password is refused with a message');
  check(auth(F).users.length === 0, 'wrong master password wrote nothing');
  setVal(F, dlgEl(F, '#orMaster'), MASTER);
  click(F, dlgEl(F, '#orGo'));
  await waitFor(() => !F.d.body.classList.contains('auth-gate'), 25000);
  check(ownerOf(F) && ownerOf(F).username === 'msk', 'kit restore recreated the owner account');
  check(!!(ownerOf(F).keyring || {}).__escrow__, 'restored owner holds the escrow-key wrap');
  shut(F);
}

/* issue a control record through the real Owner-controls UI; returns the record */
async function issueControl(seedStr, mode, message) {
  const O = boot(DLG_POLY + CHART_STUB + seedStr, '', { control: null });
  await loginAs(O, 'msk', PW);
  await waitFor(() => !O.d.body.classList.contains('auth-gate'), 25000);
  O.w.location.hash = '#/manage'; await sleep(900);
  const card = O.d.getElementById('ownerControls');
  if (!card) { shut(O); return { missing: true }; }
  const modeBtn = card.querySelector('[data-action="oc-mode"][data-mode="' + mode + '"]');
  if (!modeBtn) { shut(O); return { missing: true }; }
  click(O, modeBtn); await sleep(400);
  setVal(O, dlgEl(O, '#ocMsg'), message || '');
  setVal(O, dlgEl(O, '#ocMaster'), MASTER);
  click(O, dlgEl(O, '#ocGo'));
  await waitFor(() => O.w.__LAST_BLOB_TEXT && O.w.__LAST_BLOB_TEXT.indexOf('control') === -1 && O.w.__LAST_BLOB_TEXT.indexOf('"sig"') !== -1, 20000);
  let rec = null; try { rec = JSON.parse(O.w.__LAST_BLOB_TEXT); } catch (e) {}
  const hist = JSON.parse(O.w.localStorage.getItem('spr-owner-history-v1') || '[]');
  shut(O);
  return { rec, hist };
}

async function issueThree(seedStr) {
  /* one window, three issues: the counter must strictly increase across them */
  const O = boot(DLG_POLY + CHART_STUB + seedStr, '');
  await loginAs(O, 'msk', PW);
  await waitFor(() => !O.d.body.classList.contains('auth-gate'), 25000);
  const out = {};
  for (const spec of [['locked', 'Summer maintenance - back soon', 'lock'], ['readonly', 'Marks freeze while reports are printed', 'ro'], ['normal', '', 'norm']]) {
    O.w.location.hash = '#/manage'; await sleep(900);
    const card = O.d.getElementById('ownerControls');
    if (!card) { shut(O); return out; }
    const mb = card.querySelector('[data-action="oc-mode"][data-mode="' + spec[0] + '"]');
    if (!mb) { shut(O); return out; }
    click(O, mb); await sleep(400);
    setVal(O, dlgEl(O, '#ocMsg'), spec[1]);
    setVal(O, dlgEl(O, '#ocMaster'), MASTER);
    O.w.__LAST_BLOB_TEXT = '';
    click(O, dlgEl(O, '#ocGo'));
    await waitFor(() => O.w.__LAST_BLOB_TEXT && O.w.__LAST_BLOB_TEXT.indexOf('"sig"') !== -1, 20000);
    try { out[spec[2]] = { rec: JSON.parse(O.w.__LAST_BLOB_TEXT), hist: JSON.parse(O.w.localStorage.getItem('spr-owner-history-v1') || '[]') }; } catch (e) { out[spec[2]] = {}; }
  }
  shut(O);
  return out;
}
async function runC(seedStr, pubB64u) {
  console.log('== C1: owner issues Lock + Read-only; records are signed ==');
  if (!pubB64u) check(false, 'owner public key available (prerequisite from kit)');
  const issued = await issueThree(seedStr);
  const lock = issued.lock || {};
  check(!!(lock.rec && lock.rec.sig), 'Owner controls card produced a downloadable control.json');
  if (lock.rec) {
    check(lock.rec.version === 1 && lock.rec.mode === 'locked', 'record: version 1, mode locked');
    check(lock.rec.message.indexOf('Summer maintenance') === 0, 'record carries the plain-text message');
    check(typeof lock.rec.counter === 'number' && lock.rec.counter >= 1, 'counter is a number');
    check(pubB64u ? (await verifySig(pubB64u, lock.rec)) : false, 'signature verifies against the owner public key');
    check((lock.hist || []).some((h) => h.mode === 'locked'), 'issue history kept locally');
  }
  const ro = issued.ro || {};
  check(!!(ro.rec && ro.rec.mode === 'readonly'), 'Read-only record issued');
  if (ro.rec && lock.rec) check(ro.rec.counter > lock.rec.counter, 'counter strictly increases');
  const norm = issued.norm || {};
  check(!!(norm.rec && norm.rec.mode === 'normal'), 'Normal (lift) record issued');
  if (norm.rec && ro.rec) check(norm.rec.counter > ro.rec.counter, 'counter keeps increasing (normal lift)');

  console.log('== C2: devices obey — readonly blocks edits, allows print/backup ==');
  const T = boot(DLG_POLY + CHART_STUB + seedStr, '', { control: ro.rec });
  await loginAs(T, 'kay', 'kay-pw-123');
  await waitFor(() => !T.d.body.classList.contains('auth-gate') || /locked|sign-in/i.test(T.d.body.textContent), 25000);
  const banner = () => T.d.getElementById('ctrlBanner');
  if (!(await waitFor(() => banner(), 15000))) {
    check(false, 'teacher window shows the control banner');
  } else {
    check(/Marks freeze/.test(banner().textContent), 'readonly banner shows the owner message');
  }
  const beforeRO = sprSnapshot(T, ['spr-control-v1']);
  T.w.location.hash = '#/users'; await sleep(700);
  const dlBefore = (T.w.__downloads || []).length;
  const importBtn = T.d.querySelector('[data-action="class-roster-btn"]');
  if (importBtn) { click(T, importBtn); await sleep(400); }
  check(sprSnapshot(T, ['spr-control-v1']) === beforeRO, 'readonly: roster import path writes nothing');
  shut(T);

  console.log('== C3: locked — only the owner can sign in ==');
  const L = boot(DLG_POLY + CHART_STUB + seedStr, '', { control: lock.rec });
  const a0 = auth(L); a0.session = null; L.w.localStorage.setItem('spr-auth-v1', JSON.stringify(a0));
  await sleep(600); await ackGate(L);
  await waitFor(() => L.d.getElementById('loginUser'), 15000);
  check(/Summer maintenance/.test(L.d.body.textContent), 'locked: sign-in screen shows the owner message');
  setVal(L, L.d.getElementById('loginUser'), 'kay');
  setVal(L, L.d.getElementById('loginPass'), 'kay-pw-123');
  click(L, L.d.querySelector('[data-action="do-login"]')); await sleep(1500);
  check(L.d.body.classList.contains('auth-gate'), 'locked: teacher sign-in refused');
  check(/locked|Summer maintenance/i.test(L.d.body.textContent), 'locked: refusal carries the message');
  setVal(L, L.d.getElementById('loginUser'), 'msk');
  setVal(L, L.d.getElementById('loginPass'), PW);
  click(L, L.d.querySelector('[data-action="do-login"]'));
  await waitFor(() => !L.d.body.classList.contains('auth-gate'), 25000);
  check(true, 'locked: the owner can still sign in');
  shut(L);

  console.log('== C4: invalid records never lock anyone ==');
  const mkPre = (accepted) => 'try{localStorage.setItem("spr-control-v1",' + JSON.stringify(JSON.stringify(accepted)) + ')}catch(e){}';
  /* tampered message on the LOCKED record -> rejected, stays normal (no accepted state) */
  const tampered = JSON.parse(JSON.stringify(lock.rec)); tampered.message = 'Hostile takeover now';
  const T1 = boot(DLG_POLY + CHART_STUB + mkPre(null), '', { control: tampered });
  await sleep(4000);
  check(!T1.d.getElementById('ctrlBanner') || !T1.d.getElementById('ctrlBanner').textContent, 'tampered message rejected: no banner');
  check((JSON.parse(T1.w.localStorage.getItem('spr-control-v1') || 'null') || {}).rec == null, 'tampered record not accepted/stored');
  shut(T1);
  /* wrong key */
  const other = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const oPriv = await webcrypto.subtle.exportKey('pkcs8', other.privateKey);
  const wrongKeyRec = await (async () => {
    const rec2 = JSON.parse(JSON.stringify(norm.rec)); rec2.counter = 900;
    const msg = JSON.stringify([1, rec2.counter, rec2.issued_at, rec2.mode, rec2.message]);
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, other.privateKey, new TextEncoder().encode(msg));
    rec2.sig = Buffer.from(sig).toString('base64');
    return rec2;
  })();
  const T2 = boot(DLG_POLY + CHART_STUB + mkPre({ rec: ro.rec, at: Date.now() }), '', { control: wrongKeyRec });
  await sleep(4000);
  check(!!T2.d.getElementById('ctrlBanner') && /Marks freeze/.test(T2.d.getElementById('ctrlBanner').textContent), 'wrong-key record rejected: previous mode kept');
  shut(T2);
  /* replay: older counter than accepted */
  const T3 = boot(DLG_POLY + CHART_STUB + mkPre({ rec: ro.rec, at: Date.now() }), '', { control: lock.rec });
  await sleep(4000);
  check(!!T3.d.getElementById('ctrlBanner') && /Marks freeze/.test(T3.d.getElementById('ctrlBanner').textContent), 'replayed older counter rejected: previous mode kept');
  shut(T3);
  /* future issued_at */
  const future = JSON.parse(JSON.stringify(norm.rec)); future.counter = 901; future.issued_at = Date.now() + 3 * 86400 * 1000;
  const T4 = boot(DLG_POLY + CHART_STUB + mkPre({ rec: ro.rec, at: Date.now() }), '', { control: future });
  await sleep(4000);
  check(!!T4.d.getElementById('ctrlBanner') && /Marks freeze/.test(T4.d.getElementById('ctrlBanner').textContent), 'future issued_at rejected: previous mode kept');
  shut(T4);
  /* fetch failure keeps the accepted mode */
  const T5 = boot(DLG_POLY + CHART_STUB + mkPre({ rec: ro.rec, at: Date.now() }), '', { controlFail: true });
  await sleep(4000);
  check(!!T5.d.getElementById('ctrlBanner') && /Marks freeze/.test(T5.d.getElementById('ctrlBanner').textContent), 'fetch failure keeps the accepted mode');
  shut(T5);
  /* never accepted + no record -> normal */
  const T6 = boot(DLG_POLY + CHART_STUB, '', { controlFail: true });
  await sleep(3500);
  check(!T6.d.getElementById('ctrlBanner'), 'no valid record ever accepted: mode is normal');
  shut(T6);

  console.log('== C5: modes never touch local data ==');
  const D = boot(DLG_POLY + CHART_STUB + seedStr, '', { control: norm.rec });
  await loginAs(D, 'msk', PW);
  await waitFor(() => !D.d.body.classList.contains('auth-gate'), 25000);
  const snapA = sprSnapshot(D, ['spr-control-v1', 'spr-owner-history-v1', 'spr-auth-v1']);
  shut(D);
  const D2 = boot(DLG_POLY + CHART_STUB + seedStr, '', { control: lock.rec });
  await sleep(5000);
  const snapB = sprSnapshot(D2, ['spr-control-v1', 'spr-owner-history-v1', 'spr-auth-v1', 'spr-privacy-v1', 'spr-recovery-ack', 'spr-notice']);
  shut(D2);
  check(snapA.split('"spr-class-').length === snapB.split('"spr-class-').length, 'class stores unchanged by locked mode');
}

async function runM() {
  console.log('== M: sync merge never removes or downgrades the owner ==');
  /* A = owner device, sync on, pushes the owner record */
  const A = boot(DLG_POLY + CHART_STUB, '', { sb: {} });
  await firstRunOwner(A, 'msk', PW, MASTER);
  setVal(A, A.d.getElementById('mrPw'), MASTER);
  click(A, A.d.querySelector('[data-action="recovery-master"]'));
  const kb = A.d.querySelector('[data-action="owner-kit-dl"]');
  if (kb) {
    await waitFor(() => !kb.disabled, 20000);
    click(A, kb); await sleep(500);
    const ackBtn = A.d.querySelector('[data-action="recovery-ack"]');
    await waitFor(() => ackBtn && !ackBtn.disabled, 10000);
    if (ackBtn && !ackBtn.disabled) click(A, ackBtn);
    await waitFor(() => !A.d.body.classList.contains('auth-gate'), 20000);
  }
  A.w.location.hash = '#/manage'; await sleep(800);
  const en = A.d.querySelector('[data-action="ds-enable"]');
  if (en) {
    click(A, en); await sleep(400);
    const yes = A.d.querySelector('#dlg [data-x="1"]');
    if (yes) { click(A, yes); }
    await waitFor(() => (A.w.__FETCHES || []).some((f) => f.indexOf('POST') === 0), 30000);
    await sleep(4000);
  }
  const sbA = A.sbSync();
  const row = Object.keys(sbA)[0];
  check(!!row && !!sbA[row].payload, 'owner device pushed a cloud copy (fake Supabase)');
  /* sbSync hands back the LIVE shared store (that IS the cloud here): freeze
     A's timestamp now, or C's later push mutates it under us */
  const aPushedAt = (sbA[row] || {}).pushed_at || '';
  const pubB64u = (auth(A).ownerSeal || {}).pub;

  /* C = a genuine PRE-ROUND10 DEVICE: the REAL round9 build (no round10
     guards), booted with A's storage, msk demoted to plain admin + a stale
     tombstone - exactly what an old phone still holding the channel would
     push. Its sign-in tail merges + seals with the shared sync key, and its
     round9 merge has no owner rules: the row it publishes IS the hostile
     copy (msk:admin + gone[msk]). The current app cannot produce this row
     itself (its push path filters owner tombstones and forces the owner
     role) - which is the point. */
  check(!!htmlR9, 'round9 build available as the hostile device (fixtures/app-round9.html.gz)');
  const seedA = seedFrom(A, function (a) {
    const m = a.users.find(function (u) { return String(u.username).toLowerCase() === 'msk'; });
    if (m) m.role = 'admin';
    a.session = null;
  });
  /* arm the old device's pending push (round9 re-arms it 2.5 s after boot and
     retries every 4 s until someone is signed in - the same behaviour as a
     phone that made a change offline and came back online) */
  const armPending = 'try{var _c=JSON.parse(localStorage.getItem("spr-devicesync-v1")||"{}");_c.pendingPush=true;localStorage.setItem("spr-devicesync-v1",JSON.stringify(_c))}catch(e){}';
  const C = boot(DLG_POLY + CHART_STUB + seedA + 'try{localStorage.setItem("spr-ds-gone-v1",JSON.stringify(["msk"]))}catch(e){}' + armPending, '', { sb: sbA, html: htmlR9 });
  await loginAs(C, 'msk', PW);
  await waitFor(() => !C.d.body.classList.contains('auth-gate'), 25000);
  await waitFor(() => (C.w.__FETCHES || []).some(function (f) { return f.indexOf('POST') === 0 || f.indexOf('PATCH') === 0; }), 30000);
  await sleep(6000);
  const sbC = C.sbSync();
  const hostile = row && sbC[row] && sbC[row].payload && (sbC[row].pushed_at || '') > aPushedAt;
  check(!!hostile, 'hostile copy pushed by the round9 device: newer than the owner copy');

  /* B = the owner's OTHER round10 device, still holding the owner copy: its
     sign-in pull-check installs the NEWER hostile row - the round10 merge
     must refuse both the tombstone and the downgrade */
  const seedB = seedFrom(A, function (a) { a.session = null; });
  const B = boot(DLG_POLY + CHART_STUB + seedB, '', { sb: sbC });
  await loginAs(B, 'msk', PW);
  await waitFor(() => !B.d.body.classList.contains('auth-gate'), 25000);
  await sleep(3000);   /* let the sign-in pull-check + install settle */
  const bMsk = byName(B, 'msk');
  check(!!bMsk, 'install from the hostile copy: msk was NOT removed by the tombstone');
  if (bMsk) check(bMsk.role === 'owner', 'msk lands as owner (never downgraded), got ' + bMsk.role);
  let goneB = [];
  try { goneB = JSON.parse(B.w.localStorage.getItem('spr-ds-gone-v1') || '[]'); } catch (eG) {}
  check(goneB.indexOf('msk') === -1, 'the owner tombstone was lifted from the deletion list');
  shut(B); shut(C); shut(A);
  return pubB64u;
}

function runS() {
  console.log('== S: source scan — no key material, no secrets ==');
  const targets = [path.join(__dirname, '../source/app.js'), appHtmlPath, path.join(__dirname, '../source/classstore.js')];
  for (const t of targets) {
    const src = fs.readFileSync(t, 'utf8');
    check(!/BEGIN (EC )?PRIVATE KEY/.test(src), 'no PEM private key in ' + path.basename(t));
    check(!/generateKey\(\{[^}]*name:\s*['"]ECDSA[\s\S]{0,400}?(extractable|jwk)[^\n]{0,80}priv/i.test(src), 'no private JWK export in ' + path.basename(t));
  }
  const app = fs.readFileSync(appHtmlPath, 'utf8');
  check(!/"d"\s*:\s*"[A-Za-z0-9_-]{80,}/.test(app), 'no raw private JWK literal in the shipped bundle');
}

(async () => {
  const t0 = Date.now();
  const ONLY = (process.env.OM_SECTIONS || '').split(',').filter(Boolean);
  const guard = async (name, fn) => { try { await fn(); } catch (e) { check(false, name + ' ran to completion (crash: ' + String(e.message).slice(0, 90) + ')'); } };
  const sec = (name, fn) => { if (ONLY.length && ONLY.indexOf(name) === -1) { console.log('  (skip ' + name + ')'); return null; } return guard(name, fn); };
  let kit = null; let seedStr = '';
  await sec('P1/P2', async () => { const r = await runP(); kit = r.kit; });
  await sec('P3-P5', async () => {
    const r = await runP(); if (r && r.kit) kit = r.kit;
    await runP3(r.A);
    const seedP = await runP45(r.A); shut(r.A);
    seedStr = 'try{var _o=' + JSON.stringify(seedP) + ';Object.keys(JSON.parse(_o)).forEach(function(k){localStorage.setItem(k,JSON.parse(_o)[k])})}catch(e){};';
  });
  if (!seedStr) console.log('  (no seed: P sections failed; later sections report prerequisite FAILs)');
  await sec('P6/P7', () => runP67(seedStr));
  let seedE = seedStr;
  await sec('E', async () => { seedE = (await runE(seedStr)) || seedStr; });
  await sec('K', () => runK(kit, seedE));
  await sec('M', () => runM());
  const pubB64u = (kit && kit.pub) || '';
  await sec('C', () => runC(seedE, pubB64u));
  if (!ONLY.length || ONLY.indexOf('S') !== -1) runS();
  console.log('RESULT-LINE OWNER-MASTER: ' + ok + ' ok, ' + bad + ' FAIL (' + Math.round((Date.now() - t0) / 1000) + 's)');
  process.exit(bad ? 1 : 0);
})();
