/* Standalone check (2026-10-24): the user's exact flow on the stuck device —
   MAIN device (class mode, class P4C4, sync on) publishes its row;
   a FRESH device pairs via "I use SPR on another device", signs in, and
   clicks Open on the class card → MUST land on #/dashboard (the app screen),
   and after a reload it must auto-open straight into the class. */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

const appHtmlPath = ['../dist/app/index.html', '../app/index.html']
  .map((rel) => path.join(__dirname, rel)).find((p) => fs.existsSync(p));
const html0 = fs.readFileSync(appHtmlPath, 'utf8');

const CHAN = '11111111-2222-3333-4444-555555555555';
const PW = 'school-pass-1';

/* fake Supabase REST, shared table across boots (inside each window; Node mirror below) */
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
  ' return Promise.resolve(H(200, chan && SB[chan] ? [SB[chan]] : []));' +
  '}';

let SB = {};
function syncSB(B) { SB = JSON.parse(JSON.stringify(B.w.__SB || {})); }

const DLG_POLY =
  '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';

/* MAIN device seed: class-mode device with one class, keyring wrap + login wrap
   under PW, sync configured. Built with the app's own ClassStore crypto. */
function mainSeed() {
  return DLG_POLY + CHART_STUB +
    'window.__SB=' + JSON.stringify(SB) + ';' +
    'window.fetch=(' + SB_FETCH_SRC + ');' +
    '(async function(){' +
    ' while(!window.__CRYPTO_OK){await new Promise(function(r){setTimeout(r,10);});}' +
    ' try{' +
    '  var CS=window.ClassStore;' +
    '  var key=CS.genKey();' +
    '  var wb={sprClass:1,id:"P4C4",name:"P4C4",school:"ZFY",eal:"",support:"",settings:{autoTotal:true,spTotal:20,daTotal:10},currentSemesterId:null,semesters:[],pending:[],audit:[]};' +
    '  localStorage.setItem("spr-class-P4C4",JSON.stringify(await CS.sealClass(wb,key)));' +
    '  localStorage.setItem("spr-class-index-v1",JSON.stringify([{id:"P4C4",name:"P4C4",school:"ZFY",eal:"",support:"",createdAt:Date.now(),updatedAt:Date.now(),pendingCount:0}]));' +
    '  localStorage.setItem("spr-mode-v1","class");' +
    '  var ring={};ring.P4C4=await CS.wrapKey(key,"' + PW + '");' +
    '  var login=await CS.loginWrap("' + PW + '");' +
    '  localStorage.setItem("spr-auth-v1",JSON.stringify({users:[{username:"Mo",name:"Mohammed Shehzad Khan (Teacher Mo)",role:"admin",keyring:ring,login:login}],session:null}));' +
    '  localStorage.setItem("spr-v2-v1",JSON.stringify({fmt:2,wraps:{},ts:Date.now()}));' +
    '  localStorage.setItem("spr-devicesync-v1",JSON.stringify({on:true,owner:"Mo",channel:"' + CHAN + '",key:CS.b64uFromBytes(CS.genKey()),device:"Test · main",pairedAt:new Date().toISOString()}));' +
    '  window.__SEED_DONE=true;' +
    ' }catch(e){window.__SEED_ERR=String(e&&e.message||e);}' +
    '})();';
}

function freshPre() {
  return DLG_POLY + CHART_STUB +
    'window.__SB=' + JSON.stringify(SB) + ';' +
    'window.fetch=(' + SB_FETCH_SRC + ');';
}

function boot(pre, hash) {
  try { new Function(pre); } catch (e) { console.log('PRE-SCRIPT SYNTAX ERROR:', e.message); process.exit(2); }
  const html = html0.slice(0, html0.lastIndexOf('</body>')) + '<script>' + pre + '</script>' + html0.slice(html0.lastIndexOf('</body>'));
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/app/index.html' + (hash || ''), pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
  const w = dom.window, d = w.document;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
  w.__CRYPTO_OK = true;
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  return { w, d };
}

let ok = 0, bad = 0;
function check(cond, label) { if (cond) { ok++; console.log('  ok: ' + label); } else { bad++; console.log('  FAIL: ' + label); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(300); } return cond(); }
function click(B, el) { if (!el) throw new Error('click target missing'); el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }
function setVal(B, el, v) { if (!el) return; el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); }
function saveLS(B) { const o = {}; for (let i = 0; i < B.w.localStorage.length; i++) { const k = B.w.localStorage.key(i); o[k] = B.w.localStorage.getItem(k); } const s = {}; for (let i = 0; i < B.w.sessionStorage.length; i++) { const k = B.w.sessionStorage.key(i); s[k] = B.w.sessionStorage.getItem(k); } return { ls: o, ss: s }; }
function reboot(B) { const st = saveLS(B); const ls = JSON.stringify(st.ls); const ss = JSON.stringify(st.ss); return boot('try{var _L=' + ls + ';for(var k in _L)localStorage.setItem(k,_L[k]);var _S=' + ss + ';for(var k in _S)sessionStorage.setItem(k,_S[k]);}catch(e){}' + freshPre()); }
async function ackGate(B) { const b = B.d.querySelector('[data-action="privacy-gate-ack"]'); if (b && B.d.getElementById('dlg') && B.d.getElementById('dlg').open) { click(B, b); await sleep(300); } }
async function ackPrivacy(B) { const d = B.d.getElementById('dlg'); if (d && d.open && B.d.querySelector('[data-action="privacy-ack"]')) { click(B, B.d.querySelector('[data-action="privacy-ack"]')); await sleep(300); } }

(async function main() {
  console.log('== MAIN device: seeded class P4C4 + sync; sign in and publish ==');
  const A = boot(mainSeed(), '#/classes');
  await waitFor(() => A.w.__SEED_DONE || A.w.__SEED_ERR, 15000);
  check(!!A.w.__SEED_DONE && !A.w.__SEED_ERR, 'seed built with ClassStore crypto' + (A.w.__SEED_ERR ? ' (' + A.w.__SEED_ERR + ')' : ''));
  await sleep(600);
  await ackGate(A); await ackPrivacy(A);
  setVal(A, A.d.getElementById('loginUser'), 'Mo');
  setVal(A, A.d.getElementById('loginPass'), PW);
  click(A, A.d.querySelector('[data-action="do-login"]'));
  const inA = await waitFor(() => !A.d.body.classList.contains('auth-gate'), 25000);
  check(inA, 'MAIN signed in');
  await sleep(800);
  check(A.w.location.hash.indexOf('#/dashboard') === 0 || A.w.location.hash.indexOf('#/classes') !== -1, 'MAIN landed somewhere sane: ' + A.w.location.hash);
  /* force a push: the app re-pushes on 'online' when the last push failed —
     set lastResult=fail and raise the event (no debug hook needed) */
  try {
    const cfg = JSON.parse(A.w.localStorage.getItem('spr-devicesync-v1'));
    cfg.lastResult = 'fail';
    A.w.localStorage.setItem('spr-devicesync-v1', JSON.stringify(cfg));
    A.w.dispatchEvent(new A.w.Event('online'));
  } catch (e) {}
  const pushed = await waitFor(() => { syncSB(A); return Object.keys(SB).some(function (id) { return SB[id] && SB[id].payload && SB[id].payload.sprDS === 1; }); }, 30000);
  check(pushed, 'MAIN published the school row (sprDS envelope)');

  console.log('== FRESH device: pair via "I use SPR on another device", sign in, click Open ==');
  const B = boot(freshPre(), '');
  await sleep(700);
  await ackGate(B);
  const otherLink = B.d.querySelector('[data-action="login-other-device"]');
  check(!!otherLink, 'fresh device shows "I use SPR on another device"');
  if (!otherLink) { console.log(bad ? 'ESCAPE FAILURES: ' + bad : 'PAIR-OPEN PASSED (' + ok + ')'); process.exit(bad ? 1 : 0); }
  click(B, otherLink);
  await sleep(500);
  setVal(B, B.d.getElementById('odUser'), 'mo');           /* lowercase, like the user */
  setVal(B, B.d.getElementById('odPass'), PW);
  const cont = B.d.querySelector('#dlg [data-x="1"]');
  cont.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(120);
  await sleep(1500);
  const offered = await waitFor(() => /Open the cloud copy here|Wrong password|No cloud copy|cannot reach/.test((B.d.getElementById('dlg') || {}).textContent || ''), 90000);
  check(offered, 'cloud copy found and offered');
  if (offered) {
    click(B, B.d.querySelector('#dlg .dlg-actions [data-x="1"]'));
    for (let t = 0; t < 6; t++) {
      await sleep(700);
      const dl = B.d.getElementById('dlg') || {};
      const toasts = Array.from(B.d.querySelectorAll('#toast-root .toast')).map(function (t) { return t.textContent; });
    }
    const inB = await waitFor(() => !B.d.body.classList.contains('auth-gate'), 30000);
    if (!inB) {
      let au = null; try { au = JSON.parse(B.w.localStorage.getItem('spr-auth-v1') || 'null'); } catch (e) {}
    }
    check(inB, 'fresh device signed in after adoption');
    await sleep(900);
    const onDash = B.w.location.hash.indexOf('#/dashboard') === 0;
    if (onDash) {
      check(true, 'paired sign-in AUTO-OPENED the class (#/dashboard)');
    } else {
      check(B.w.location.hash.indexOf('#/classes') !== -1, 'landed on the classes screen: ' + B.w.location.hash);
      const openBtn = B.d.querySelector('[data-action="class-open"][data-id="P4C4"]');
      check(!!openBtn, 'P4C4 card offers Open');
      if (openBtn) {
        click(B, openBtn);
        await waitFor(() => B.w.location.hash.indexOf('#/dashboard') === 0 || /Cannot open|Could not open/.test((B.d.getElementById('dlg') || {}).textContent || ''), 15000);
        check(B.w.location.hash.indexOf('#/dashboard') === 0, 'Open navigated to #/dashboard (the app screen)');
      }
    }
      /* reload persistence: rebooting must auto-open the class directly */
      if (B.w.location.hash.indexOf('#/dashboard') === 0) {
        const C = reboot(B, B.w.location.hash);   /* a real refresh keeps the URL */
        await waitFor(() => C.w.__appReady !== undefined || C.d.body.className.length > 0, 5000);
        await sleep(1500);
        check(C.w.location.hash.indexOf('#/dashboard') === 0, 'after reload the class auto-opens: ' + C.w.location.hash);
      }
  }

  console.log(bad ? 'PAIR-OPEN FAILURES: ' + bad : 'PAIR-OPEN PASSED (' + ok + ')');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
