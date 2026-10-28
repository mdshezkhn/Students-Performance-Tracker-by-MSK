/* notices regression suite (2026-10-28, notices-voice branch).
   A. gate: summary + checkbox + disabled button; acceptance stored as
      {version, date} in localStorage AND the workbook settings (full backup).
   B. version bump re-asks.
   C. viewer dialog: EN/中文 toggle, version line, approval line.
   D. admin School approval card in Manage feeds the notice line. */
const fs = require('fs'); const path = require('path'); const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');
const html0 = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';

let PASS = 0, FAIL = 0;
const check = (c, l) => { if (c) { PASS++; console.log('  ok: ' + l); } else { FAIL++; console.log('  FAIL: ' + l); } };

function boot(preExtra) {
  const pre = '<script>' + DLG_POLY + CHART_STUB + (preExtra || '') + '</scr' + 'ipt>';
  const i = html0.lastIndexOf('</body>');
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const dom = new JSDOM(html0.slice(0, i) + pre + html0.slice(i), {
    url: 'http://localhost/app/index.html#/dashboard', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc, storageQuota: 10000000,
  });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); } catch (e) {}
  if (!w.TextEncoder) { w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; }
  return { w, d: w.document };
}
const dlgTxt = (B) => (B.d.getElementById('dlg') || { textContent: '' }).textContent || '';
const click = (B, el) => el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
const txt = (B) => { const c = B.d.body.cloneNode(true); c.querySelectorAll('script,style').forEach((n) => n.remove()); return c.textContent || ''; };

async function settleGate(B) {   /* returns true if the privacy gate appeared */
  for (let t = 0; t < 24; t++) {
    await sleep(250);
    if (B.d.getElementById('notice-read')) return true;
  }
  return false;
}
async function acceptGate(B) {
  const box = B.d.getElementById('notice-read');
  check(!!box, 'gate shows the "I have read the notice" checkbox');
  const btn = B.d.getElementById('notice-ack-btn');
  check(!!btn && btn.disabled, 'button starts disabled');
  box.checked = true; box.dispatchEvent(new B.w.Event('change', { bubbles: true }));
  check(!btn.disabled, 'checkbox enables the button');
  click(B, btn); await sleep(500);
}
function setupAdmin(B) {
  const su = B.d.querySelector('[data-action="show-setup"]');
  if (su) { click(B, su); return sleep(300); }
  return Promise.resolve();
}

(async () => {
  console.log('A. gate + acceptance record');
  {
    const A = boot(); await sleep(700);
    check(await settleGate(A), 'first-run privacy gate appears');
    check(/Nothing is sent anywhere/.test(dlgTxt(A)), 'gate shows the honest summary');
    await acceptGate(A);
    let raw = null;
    for (let t = 0; t < 20 && !raw; t++) { await sleep(250); raw = A.w.localStorage.getItem('spr-privacy-ack-v1'); }
    check(!!raw && JSON.parse(raw).v === '1' && !!JSON.parse(raw).date, 'acceptance stored as {version, date}');
    await setupAdmin(A);
    const set = (id, v) => { const e = A.d.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new A.w.Event('input', { bubbles: true })); } };
    set('suUser', 'Mo'); set('suPass', 'good-pass-77'); set('suConf', 'good-pass-77');
    click(A, A.d.querySelector('[data-action="first-run"]'));
    for (let t = 0; t < 30; t++) { await sleep(250); if (!A.d.body.classList.contains('auth-gate')) break; }
    check(!A.d.body.classList.contains('auth-gate'), 'admin signed in');
    const db = A.w.SPR_DEBUG_GET_DB();
    check(!!(db.settings && db.settings.noticeAccept && db.settings.noticeAccept.v === '1'), 'acceptance is in the workbook settings (rides in the full backup)');
    A.w.close();
  }

  console.log('B. version change re-asks');
  {
    const pre = 'try{localStorage.setItem("spr-privacy-ack-v1",\'{"v":"0","date":"2026-10-01"}\');}catch(e){}';
    const B = boot(pre); await sleep(700);
    check(await settleGate(B), 'an older accepted version re-opens the gate');
    B.w.close();
    const C = boot(pre.replace('"0"', '"1"')); await sleep(900);
    check(!C.d.getElementById('notice-read'), 'the current version does not re-ask');
    C.w.close();
  }

  console.log('C. viewer: EN/中文 toggle + version line');
  {
    const D = boot(); await sleep(700); await settleGate(D); await acceptGate(D);
    const open = D.d.querySelector('[data-action="privacy-open"]');
    check(!!open, 'footer notice link present in the shell');
    if (open) {
      click(D, open); await sleep(400);
      check(/About SPR and your student data/.test(dlgTxt(D)), 'full notice (EN) shown');
      check(/Notice v1, 28 Oct 2026/.test(dlgTxt(D)), 'version + date line shown');
      const zh = D.d.querySelector('[data-action="notice-lang"][data-lang="zh"]');
      click(D, zh); await sleep(400);
      check(/关于 SPR 和学生数据/.test(dlgTxt(D)), '中文 version of the notice shown');
      check(/Notice v1, 28 Oct 2026/.test(dlgTxt(D)), 'version line survives the toggle');
    }
    D.w.close();
  }

  console.log('D. school approval record');
  {
    const E = boot(); await sleep(700); await settleGate(E); await acceptGate(E); await setupAdmin(E);
    const set = (id, v) => { const e = E.d.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new E.w.Event('input', { bubbles: true })); } };
    set('suUser', 'Mo'); set('suPass', 'good-pass-77'); set('suConf', 'good-pass-77');
    click(E, E.d.querySelector('[data-action="first-run"]'));
    for (let t = 0; t < 30; t++) { await sleep(250); if (!E.d.body.classList.contains('auth-gate')) break; }
    /* empty DB -> the welcome screen: load the sample so Manage renders */
    const samp = E.d.querySelector('[data-action="load-sample"]');
    if (samp) { click(E, samp); await sleep(900); const yes = E.d.querySelector('#dlg [data-x="1"]'); if (yes) { click(E, yes); await sleep(600); } }
    E.w.location.hash = '#/manage'; await sleep(700);
    const by = E.d.getElementById('ap-by');
    check(!!by, 'School approval card present for the admin');
    check(/No school approval recorded yet/.test(txt(E)), 'gentle empty line when nothing recorded');
    set('ap-by', 'Principal Wang, academic director'); set('ap-date', '2026-10-28'); set('ap-ref', 'email: SPR approval, 28 Oct');
    click(E, E.d.querySelector('[data-action="approval-save"]')); await sleep(500);
    const db = E.w.SPR_DEBUG_GET_DB();
    check(!!(db.settings.schoolApproval && /Wang/.test(db.settings.schoolApproval.by)), 'approval stored in settings (rides in the full backup)');
    const open = E.d.querySelector('[data-action="privacy-open"]');
    E.w.eval('document.addEventListener("click", function(e){ window.__LAST = e.target.closest && (e.target.closest("[data-action]")||{}).dataset ? e.target.closest("[data-action]").dataset.action : "(none)"; });');
    open.dispatchEvent(new E.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(80);
    console.log('    [dbg] last action seen:', E.w.eval('window.__LAST'), '| dlg open:', (E.d.getElementById('dlg') || {}).open);
    for (const ms of [100, 200, 300, 500]) { await sleep(ms === 100 ? 100 : ms === 200 ? 100 : ms === 300 ? 100 : 200); console.log('    [dbg] t+' + ms + ' open:', (E.d.getElementById('dlg') || {}).open, '| open?', dlgTxt(E).slice(0, 40)); }
    check(/approved by Principal Wang, academic director on 2026-10-28/.test(dlgTxt(E)), 'approval sentence at the bottom of the notice');
    E.w.close();
  }

  console.log('\nNOTICES: ' + PASS + ' ok, ' + FAIL + ' FAIL');
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e.stack || e.message); process.exit(2); });
