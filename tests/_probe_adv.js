const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');
const html0 = fs.readFileSync('dist/app/index.html', 'utf8');
const IX = [{ id: 'c1', name: 'Grade 5 English', school: 'ESL', eal: 'te1', support: '', createdAt: 1790000000000 }];
const pre =
  'try{localStorage.setItem("spr-mode-v1","class")}catch(e){}' +
  'try{localStorage.setItem("spr-class-index-v1",' + JSON.stringify(JSON.stringify(IX)) + ')}catch(e){}' +
  'try{localStorage.setItem("spr-auth-v1",JSON.stringify({users:[{username:"te1",name:"Admin One",role:"admin",keyring:{}}],session:null}))}catch(e){}' +
  'try{sessionStorage.setItem("spr-session",JSON.stringify({user:"te1",dk:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",keys:{}}))}catch(e){}' +
  'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
  'window.fetch=function(u,o){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve([])}})};' +
  '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const html = html0.slice(0, html0.lastIndexOf('</body>')) + '<script>' + pre + '</script>' + html0.slice(html0.lastIndexOf('</body>'));
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => console.log('  [jsdomError]', String(e && e.message || e).slice(0, 140)));
  const dom = new JSDOM(html, { url: 'http://localhost/app/index.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, d = w.document;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
  w.__CRYPTO_OK = true;
  await sleep(1500);
  console.log('hash:', w.location.hash);
  console.log('gate:', d.body.classList.contains('auth-gate'));
  const app = d.getElementById('app');
  console.log('has <details>:', app.innerHTML.indexOf('<details') !== -1);
  console.log('has start-fresh:', !!d.querySelector('[data-action="start-fresh"]'));
  console.log('has ds-now:', !!d.querySelector('[data-action="ds-now"]'));
  console.log('pageHead:', (app.textContent || '').slice(0, 80));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
