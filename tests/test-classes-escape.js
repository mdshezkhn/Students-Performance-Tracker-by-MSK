/* Standalone check (not part of the suites): the rail-less Classes screen
   must carry Sign out + Privacy — the 2026-10-24 trapped-user fix. */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

const appHtmlPath = ['../dist/app/index.html', '../app/index.html']
  .map((rel) => path.join(__dirname, rel)).find((p) => fs.existsSync(p));
const html0 = fs.readFileSync(appHtmlPath, 'utf8');

const IX = [{ id: 'c1', name: 'Grade 5 English', school: 'ESL', eal: 'te1', support: 'ts1', createdAt: 1, updatedAt: 1 }];
const pre =
  'try{localStorage.setItem("spr-mode-v1","class")}catch(e){}' +
  'try{localStorage.setItem("spr-class-index-v1",' + JSON.stringify(JSON.stringify(IX)) + ')}catch(e){}' +
  'try{localStorage.setItem("spr-auth-v1",JSON.stringify({users:[{username:"te1",name:"Teacher One",role:"eal",keyring:{}}],session:null}))}catch(e){}' +
  'try{sessionStorage.setItem("spr-session",JSON.stringify({user:"te1",dk:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",keys:{}}))}catch(e){}' +
  'window.__SB={};' +
  'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
  'window.fetch=function(){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([])}})};' +
  '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const html = html0.slice(0, html0.lastIndexOf('</body>')) + '<script>' + pre + '</script>' + html0.slice(html0.lastIndexOf('</body>'));
const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/app/index.html#/classes', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
const w = dom.window, d = w.document;
try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
if (!w.TextEncoder) w.TextEncoder = TextEncoder;
if (!w.TextDecoder) w.TextDecoder = TextDecoder;

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ok = 0, bad = 0;
  const check = (c, m) => { if (c) { ok++; console.log('  ok:', m); } else { bad++; console.log('  FAIL:', m); } };
  await sleep(1500);
  const t = d.body.textContent || '';
  check(/Your classes/.test(t), 'classes screen rendered for a class-mode teacher with no key');
  const out = d.querySelector('.page [data-action="logout"]');
  check(!!out, 'Sign out button present on the Classes screen');
  check(!!d.querySelector('.page [data-action="privacy-open"]'), 'Privacy link present on the Classes screen');
  check(/No classes yet|Your administrator will pair you/.test(t) || !!d.querySelector('[data-action="class-open"]'), 'empty-pairing state handled (not an error screen)');
  if (out) {
    out.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(700);
    const gone = !(w.sessionStorage.getItem && w.sessionStorage.getItem('spr-session'));
    check(gone, 'Sign out click clears the session (escape works)');
  }
  console.log(bad ? 'ESCAPE-CHECK FAILURES: ' + bad : 'ESCAPE-CHECK PASSED (' + ok + ')');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
