/* Standalone check (also in npm run test:jsdom): the rail-less Classes screen
   must never dead-end — 2026-10-24 trapped-user fixes:
   A) Sign out + Privacy always present (escape).
   B) With device sync on: "Check for newer copy" present (a class-less device
      can never reach Manage → Device sync).
   C) Open on a class this device cannot unlock → an actionable dialog (not a
      vanishing toast), whose confirm triggers the cloud pull check. */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

const appHtmlPath = ['../dist/app/index.html', '../app/index.html']
  .map((rel) => path.join(__dirname, rel)).find((p) => fs.existsSync(p));
const html0 = fs.readFileSync(appHtmlPath, 'utf8');

const IX = [{ id: 'c1', name: 'Grade 5 English', school: 'ESL', eal: 'te1', support: 'ts1', createdAt: 1, updatedAt: 1 }];
function preJs(dsOn) {
  let s =
    'try{localStorage.setItem("spr-mode-v1","class")}catch(e){}' +
    'try{localStorage.setItem("spr-class-index-v1",' + JSON.stringify(JSON.stringify(IX)) + ')}catch(e){}' +
    'try{localStorage.setItem("spr-auth-v1",JSON.stringify({users:[{username:"te1",name:"Teacher One",role:"eal",keyring:{}}],session:null}))}catch(e){}' +
    'try{sessionStorage.setItem("spr-session",JSON.stringify({user:"te1",dk:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",keys:{}}))}catch(e){}' +
    'window.__SB={};' +
    'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
    'window.fetch=function(u,o){window.__fetches=(window.__fetches||[])+1;return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([])}})};' +
    '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
  if (dsOn) s += 'try{localStorage.setItem("spr-devicesync-v1",JSON.stringify({on:true,owner:"mo",channel:"11111111-2222-3333-4444-555555555555",key:"AAAA",device:"Test · device",pairedAt:"2026-10-24T00:00:00Z"}))}catch(e){}';
  return s;
}
function boot(pre) {
  const html = html0.slice(0, html0.lastIndexOf('</body>')) + '<script>' + pre + '</script>' + html0.slice(html0.lastIndexOf('</body>'));
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/app/index.html#/classes', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
  const w = dom.window, d = w.document;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  return { w, d };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let ok = 0, bad = 0;
  const check = (c, m) => { if (c) { ok++; console.log('  ok:', m); } else { bad++; console.log('  FAIL:', m); } };

  /* ---- A: escape basics, sync OFF ---- */
  console.log('== A: escape bar (sync off) ==');
  const A = boot(preJs(false));
  await sleep(1500);
  check(/Your classes/.test(A.d.body.textContent || ''), 'classes screen rendered for a class-mode teacher with no key');
  check(!!A.d.querySelector('.page [data-action="logout"]'), 'Sign out button present on the Classes screen');
  check(!!A.d.querySelector('.page [data-action="privacy-open"]'), 'Privacy link present on the Classes screen');
  check(!A.d.querySelector('.page [data-action="ds-now"]'), 'no sync-check button when device sync is off');
  const out = A.d.querySelector('.page [data-action="logout"]');
  if (out) {
    out.dispatchEvent(new A.w.MouseEvent('click', { bubbles: true }));
    await sleep(700);
    check(!(A.w.sessionStorage.getItem && A.w.sessionStorage.getItem('spr-session')), 'Sign out click clears the session (escape works)');
  }

  /* ---- B/C: sync ON — pull button + honest open-failure dialog ---- */
  console.log('== B: sync-check button + open-failure dialog (sync on) ==');
  const B = boot(preJs(true));
  await sleep(1500);
  const syncBtn = B.d.querySelector('.page [data-action="ds-now"]');
  check(!!syncBtn, '"Check for newer copy" present on the Classes screen when sync is on');
  const openBtn = B.d.querySelector('[data-action="class-open"]');
  check(!!openBtn, 'class card offers Open');
  if (openBtn) {
    openBtn.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
    await sleep(900);
    const dlg = B.d.getElementById('dlg');
    const dt = dlg ? (dlg.textContent || '') : '';
    check(!!(dlg && dlg.open), 'cannot-open shows a DIALOG (not a vanishing toast)');
    check(/Cannot open|does not hold the unlock key/.test(dt), 'dialog says what is wrong');
    check(/Check for a newer copy/.test(dt), 'dialog offers the concrete way out');
    const confirm = dlg ? dlg.querySelector('[data-x="1"]') : null;
    if (confirm) {
      confirm.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
      await sleep(900);
      check((B.w.__fetches || 0) > 0, 'confirming the dialog actually contacts the cloud (pull check ran)');
    }
  }

  /* ---- D: Start fresh on this device — the user-requested nuke button ---- */
  console.log('== D: Start fresh wipes spr-* state after an automatic backup ==');
  const C = boot(preJs(true));
  await sleep(1500);
  A.w.localStorage.setItem('spr-last-class', 'x');   /* marker a wipe must remove */
  C.w.localStorage.setItem('spr-last-class', 'x');
  const freshBtn = C.d.querySelector('.page [data-action="start-fresh"]');
  check(!!freshBtn, '"Start fresh on this device" button present');
  if (freshBtn) {
    freshBtn.dispatchEvent(new C.w.MouseEvent('click', { bubbles: true }));
    await sleep(600);
    const dlg = C.d.getElementById('dlg');
    check(!!(dlg && dlg.open && /Start fresh on this device/.test(dlg.textContent || '')), 'confirm dialog warns this device only');
    const yes = dlg ? dlg.querySelector('[data-x="1"]') : null;
    if (yes) {
      yes.dispatchEvent(new C.w.MouseEvent('click', { bubbles: true }));
      await sleep(1600);   /* 700ms backup grace + wipe */
      let leftovers = 0;
      for (let i = 0; i < C.w.localStorage.length; i++) { const k = C.w.localStorage.key(i); if (k && k.indexOf('spr-') === 0) leftovers++; }
      check(leftovers === 0, 'every spr-* localStorage key erased');
      check(!C.w.sessionStorage.getItem('spr-session'), 'session storage erased (signed out)');
    }
  }

  /* ---- E: sign-in username matching is case-insensitive + trimmed ---- */
  console.log('== E: "mo" opens the "Mo" account (the 2026-10-24 lockout) ==');
  const pwHash = fnv36('secret123');
  const E = boot(
    'try{localStorage.setItem("spr-auth-v1",JSON.stringify({users:[{username:"Mo",name:"Mo",role:"admin",hash:"' + pwHash + '",keyring:{}}],session:null}))}catch(e){}' +
    'try{localStorage.setItem("spr-mode-v1","archive")}catch(e){}' +
    '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();'
  );
  await sleep(1500);
  /* first run: the privacy gate + privacy notice sit over the sign-in card */
  for (const act of ['privacy-gate-ack', 'privacy-ack']) {
    const b = E.d.querySelector('[data-action="' + act + '"]');
    if (b) { b.dispatchEvent(new E.w.MouseEvent('click', { bubbles: true })); await sleep(400); }
  }
  check(!!E.d.querySelector('[data-action="do-login"]'), 'sign-in card shown');
  const eu = E.d.querySelector('#loginUser'), ep = E.d.querySelector('#loginPass');
  if (eu && ep) {
    eu.value = '  mo  '; ep.value = 'secret123';   /* wrong case + stray spaces, right password */
    E.d.querySelector('[data-action="do-login"]').dispatchEvent(new E.w.MouseEvent('click', { bubbles: true }));
    await sleep(2500);
    const errEl = E.d.querySelector('#loginErr');
    check(!E.d.body.classList.contains('auth-gate'), '"mo" + password opens the "Mo" account (no lockout)');
    check(!(errEl && /Invalid username or password/.test(errEl.textContent || '')), 'no false "Invalid username or password"');
  }

  /* ---- F: zero-account device gets an actionable error, not a dead end ---- */
  console.log('== F: wiped device points to the pairing link ==');
  const F = boot(
    'try{localStorage.setItem("spr-auth-v1",JSON.stringify({users:[],session:null}))}catch(e){}' +
    'try{localStorage.setItem("spr-mode-v1","archive")}catch(e){}' +
    '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();'
  );
  await sleep(1500);
  for (const act of ['privacy-gate-ack', 'privacy-ack']) {
    const b = F.d.querySelector('[data-action="' + act + '"]');
    if (b) { b.dispatchEvent(new F.w.MouseEvent('click', { bubbles: true })); await sleep(400); }
  }
  const fu = F.d.querySelector('#loginUser'), fp = F.d.querySelector('#loginPass');
  if (fu && fp) {
    fu.value = 'mo'; fp.value = 'whatever1';
    F.d.querySelector('[data-action="do-login"]').dispatchEvent(new F.w.MouseEvent('click', { bubbles: true }));
    await sleep(2000);
    const ferr = F.d.querySelector('#loginErr');
    check(!!(ferr && /I use SPR on another device/.test(ferr.textContent || '')), 'empty-device error points to the pairing link');
  }

  console.log(bad ? 'ESCAPE-CHECK FAILURES: ' + bad : 'ESCAPE-CHECK PASSED (' + ok + ')');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });

/* ---- helpers for part E (legacy-hash accounts sign in without async crypto) ---- */
function fnv36(pw) {   /* mirrors app hashPassword() */
  let h = 0x811c9dc5;
  const s = String(pw);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
