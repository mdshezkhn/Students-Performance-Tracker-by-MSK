/* probe: teacher opens Manage -> Change my password (legacy-mode device) */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const webcrypto = require('crypto').webcrypto;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = process.env.APP_HTML || path.join(__dirname, '../dist/app/index.html');
const html0 = fs.readFileSync(APP, 'utf8');
function boot(preStorage) {
  const pre = (preStorage ? Object.keys(preStorage).map((k) => 'try{localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(preStorage[k]) + ')}catch(e){}').join('') : '');
  const stub = '<script>' + pre +
    'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};' +
    '(function(){var d=document.getElementById("dlg");if(d&&!d.showModal){d.showModal=function(){this.open=true};d.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();' +
    '</script>';
  const i = html0.lastIndexOf('</body>');
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => console.log('  [jsdom]', String(e.message).slice(0, 120)));
  const dom = new JSDOM(html0.slice(0, i) + stub + html0.slice(i), { runScripts: 'dangerously', url: 'http://localhost/app/index.html#/dashboard', pretendToBeVisual: true, virtualConsole: vc, storageQuota: 10000000 });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle }); } catch (e) {}
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  if (!w.TextDecoder) w.TextDecoder = TextDecoder;
  return { w, d: w.document };
}
const click = (B, el) => el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
const setVal = (B, el, v) => { if (!el) { console.log('  [!] setVal target missing'); return; } el.value = v; el.dispatchEvent(new B.w.Event('input', { bubbles: true })); };
async function waitFor(f, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(150); } return !!f(); }
(async () => {
  const PW = 'probe-pass-123';
  const A = boot();
  await sleep(500);
  for (const a of ['privacy-gate-ack', 'privacy-ack']) { const b = A.d.querySelector('[data-action="' + a + '"]'); if (b) { click(A, b); await sleep(300); } }
  const su = A.d.querySelector('[data-action="show-setup"]'); if (su) { click(A, su); await sleep(300); }
  setVal(A, A.d.getElementById('suUser'), 'Mo');
  setVal(A, A.d.getElementById('suPass'), PW);
  setVal(A, A.d.getElementById('suConf'), PW);
  click(A, A.d.querySelector('[data-action="first-run"]'));
  const inOk = await waitFor(() => !A.d.body.classList.contains('auth-gate'), 25000);
  console.log('signed in:', inOk, '| suErr:', (A.d.getElementById('suErr')||{}).textContent || '(none)', '| gate:', A.d.body.className);
  await sleep(800);
  // load sample so the legacy shell + rail exist, then go to Manage
  const ls = A.d.querySelector('[data-action="load-sample"]');
  console.log('load-sample present:', !!ls);
  if (ls) { click(A, ls); await sleep(1200); }
  console.log('rail exists:', !!A.d.querySelector('.rail'), '| content:', !!A.d.getElementById('content'));
  A.w.location.hash = '#/manage';
  A.w.dispatchEvent(new A.w.Event('hashchange'));
  await sleep(700);
  console.log('hash:', A.w.location.hash, '| manage renders #content:', !!A.d.getElementById('content'), '| len:', (A.d.getElementById('content') || { innerHTML: '' }).innerHTML.length);
  const btn = A.d.querySelector('[data-action="change-pass-open"]');
  console.log('button present:', !!btn, '| in closed details:', btn ? !!btn.closest('details:not([open])') : '-');
  if (btn) {
    click(A, btn);
    await sleep(700);
    const dlg = A.d.getElementById('dlg');
    console.log('after click: dlg open =', dlg && dlg.open, '| cpCur =', !!A.d.getElementById('cpCur'), '| text:', (dlg && dlg.open ? dlg.textContent.slice(0, 80) : '(closed)'));
  }
})().catch((e) => { console.error('ERR', e); process.exit(1); });
