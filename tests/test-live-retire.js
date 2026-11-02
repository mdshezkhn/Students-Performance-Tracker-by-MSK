/* round9 task 1: Live board is retired (owner decision: duplicates Dashboard).
   1. no 'Live board' nav item anywhere; #/live redirects to #/dashboard
   2. liveboard.js, its build hook and its scoped CSS are gone
   3. Dashboard header says "Saved X ago" (never the word LIVE); cloud copy
      line appears when device sync is on */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

const R = path.join(__dirname, '..');
const appHtmlPath = ['../app/index.html', '../dist/app/index.html']
  .map((rel) => path.join(__dirname, rel)).find((p) => fs.existsSync(p));
if (!appHtmlPath) { console.log('FAIL: no app build'); process.exit(1); }
const html0 = fs.readFileSync(appHtmlPath, 'utf8');

let ok = 0, bad = 0;
function check(cond, msg) { if (cond) { ok++; console.log('  ok: ' + msg); } else { bad++; console.log('  FAIL: ' + msg); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(60); } return !!fn(); }
function fnv36(pw) { let h = 0x811c9dc5; const s = String(pw); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';
const PW = 'secret123';

/* ---- 1. static: files + build hooks gone, built HTML clean ---- */
console.log('== A: liveboard fully removed ==');
check(!fs.existsSync(path.join(R, 'source/liveboard.js')), 'source/liveboard.js deleted');
const build2 = fs.readFileSync(path.join(R, 'source/build2.py'), 'utf8');
check(!/liveboard|__LIVE__/.test(build2), 'build2.py has no liveboard hook');
check(!/liveboard/i.test(html0), 'built app/index.html contains no "liveboard"');
check(!/SPRLiveBoard/.test(html0), 'built app contains no SPRLiveBoard');
const tmpl = fs.readFileSync(path.join(R, 'source/index.template.html'), 'utf8');
check(!/__LIVE__/.test(tmpl), 'index template has no __LIVE__ slot');

/* ---- 2. runtime: nav has no Live; #/live redirects; Saved X ago ---- */
function boot(pre, hash) {
  const vc = new VirtualConsole();
  const html = html0.slice(0, html0.lastIndexOf('</body>')) + '<script>' + pre + '</script>' + html0.slice(html0.lastIndexOf('</body>'));
  const dom = new JSDOM(html, {
    url: 'http://localhost/app/index.html' + (hash || ''),
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000,
    beforeParse(w) {
      try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
      w.__CRYPTO_OK = true;
      w.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve('[]') }); };
      w.URL.createObjectURL = w.URL.createObjectURL || function () { return 'blob:test'; };
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
    }
  });
  return { w: dom.window, d: dom.window.document, dom };
}
function click(B, el) { el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }
function setVal(B, el, v) { if (!el) return; el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); }
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

(async () => {
  /* seed: one real class workbook + keyring (same recipe as test-simple-ui) */
  const seed = DLG_POLY + CHART_STUB +
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
    '  localStorage.setItem("spr-auth-v1",JSON.stringify({users:[{username:"Mo",name:"Mo",role:"admin",keyring:ring,login:login}],session:null}));' +
    '  localStorage.setItem("spr-last-save-at",String(Date.now()-5*60*1000));' +
    '  window.__SEED_DONE=true;' +
    ' }catch(e){window.__SEED_ERR=String(e&&e.message||e);}' +
    '})();';

  console.log('== B: nav + redirect ==');
  const B = boot(seed, '');
  await waitFor(() => B.w.__SEED_DONE || B.w.__SEED_ERR, 15000);
  await sleep(300);
  await loginAs(B, 'Mo', PW);
  await waitFor(() => B.w.location.hash.indexOf('#/dashboard') === 0, 15000);
  const navTxt = (B.d.querySelector('.nav') || {}).textContent || '';
  check(!/Live board/i.test(navTxt), 'sidebar has no Live board item');
  check(!/Live/i.test(navTxt), 'sidebar never shows the word Live');
  const head1 = (B.d.querySelector('.page-head') || {}).textContent || '';
  check(/Saved/.test(head1), 'dashboard header says "Saved ..." (got: ' + head1.trim().slice(0, 80) + ')');
  check(/5\s*min|min ago|just now/.test(head1), 'header shows an age ("5 min ago") — seeded 5 minutes back');
  check(!/\bLIVE\b/.test(head1), 'dashboard header never says LIVE');

  console.log('== C: #/live (old bookmark) lands on Dashboard ==');
  B.w.location.hash = '#/live';
  await sleep(700);
  check(B.w.location.hash.indexOf('#/dashboard') === 0, '#/live redirects to #/dashboard (got ' + B.w.location.hash + ')');
  const head2 = (B.d.querySelector('.page-head h1') || {}).textContent || '';
  check(head1 !== '' && /Class dashboard/.test(head2), 'content rendered is the Class dashboard');

  console.log('== D: cloud-copy line when device sync is on ==');
  const C2 = boot(seed + 'try{var c=JSON.parse(localStorage.getItem("spr-devicesync-v1")||"null")||{};c.channel="chan";c.key="k";c.lastPush=Date.now()-60000;localStorage.setItem("spr-devicesync-v1",JSON.stringify(c));}catch(e){}', '');
  await waitFor(() => C2.w.__SEED_DONE || C2.w.__SEED_ERR, 15000);
  await sleep(300);
  await loginAs(C2, 'Mo', PW);
  await waitFor(() => C2.w.location.hash.indexOf('#/dashboard') === 0, 15000);
  await sleep(400);
  const head3 = (C2.d.querySelector('.page-head') || {}).textContent || '';
  check(/Cloud copy/.test(head3), 'header adds "Cloud copy: <time>" when device sync is on (got: ' + head3.trim().slice(0, 110) + ')');

  try { B.dom.window.close(); C2.dom.window.close(); } catch (e) {}
  console.log('LIVE-RETIRE: ' + ok + ' ok, ' + bad + ' FAIL');
  process.exit(bad ? 1 : 0);
})();
