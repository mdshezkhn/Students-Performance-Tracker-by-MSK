/* round9 task 3: the built-in public-password account is gone.
   A. app source + built file carry no RECOVERY_USER/RECOVERY_PASS/isRecoveryLogin
   B. signing in as MSK with the old public password on an empty device creates
      NOTHING (no accounts, no vault) — behaves exactly like any wrong password
   C. on a device WITH data it does nothing different from a wrong password
   D. source scan: no password-like string literal next to a login comparison
      (regex over source/ + app/index.html; the old literal must never return) */
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');
const R = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(ok, label) {
  console.log('  ' + (ok ? 'ok:' : 'FAIL:') + ' ' + label);
  ok ? pass++ : fail++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* the old public password, for the regression checks (test-only; never printed) */
const OLD_PW = ['Zhong', 'Fang', 'Yuan', '786', '$'].join('');

const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';
const TE = TextEncoder, TD = TextDecoder;
function boot(pre, hash) {
  const html0 = fs.readFileSync(path.join(R, 'app/index.html'), 'utf8');
  const html = html0.slice(0, html0.lastIndexOf('</body>')) + '<script>' + DLG_POLY + CHART_STUB + pre + '</script>' + html0.slice(html0.lastIndexOf('</body>'));
  const dom = new JSDOM(html, {
    url: 'http://localhost/app/index.html' + (hash || ''),
    runScripts: 'dangerously', pretendToBeVisual: true,
    storageQuota: 50000000,
    virtualConsole: (() => { const vc = new VirtualConsole(); return vc; })(),
    beforeParse(w) {
      Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
      if (!w.TextEncoder) w.TextEncoder = TE;
      if (!w.TextDecoder) w.TextDecoder = TD;
      w.scrollTo = () => {};
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
      const RB = w.Blob; const RU = w.URL || {};
      w.Blob = function (parts, opts) { const b = new RB(parts, opts); if (parts && parts.length && typeof parts[0] === 'string') b.__TEXT = parts[0]; return b; };
      w.URL.createObjectURL = () => 'blob:x';
    }
  });
  return { w: dom.window, d: dom.window.document, dom };
}

(async () => {
  console.log('== A: no built-in account in source or build ==');
  for (const f of ['source/app.js', 'app/index.html']) {
    const src = fs.readFileSync(path.join(R, f), 'utf8');
    check(!/RECOVERY_USER|RECOVERY_PASS|isRecoveryLogin/.test(src), f + ' has no RECOVERY account');
  }
  check(fs.readFileSync(path.join(R, 'app/index.html'), 'utf8').indexOf(OLD_PW) === -1, 'built app does not ship the old public password');

  console.log('== B: old password on an EMPTY device creates nothing ==');
  const B = boot('');
  /* ack the privacy gate, then the login card appears */
  const ack = async (X) => {
    for (let i2 = 0; i2 < 40; i2++) {
      const g = X.d.getElementById('dlg');
      if (g && g.open) {
        const box = g.querySelector('#notice-read');
        if (box && !box.checked) { box.checked = true; box.dispatchEvent(new X.w.Event('change', { bubbles: true })); await sleep(150); }
        for (const a of ['privacy-gate-ack', 'privacy-ack']) {
          const b = g.querySelector('[data-action="' + a + '"]');
          if (b && !b.disabled) { b.click(); await sleep(300); }
        }
      }
      if (X.d.getElementById('loginUser') || X.d.getElementById('suUser')) return;
      await sleep(250);
    }
  };
  await ack(B); await sleep(400);
  if (!B.d.getElementById('loginUser')) {
    const su = B.d.querySelector('[data-action="show-setup"]');
    if (su) { su.click(); await sleep(250); }
  }
  await new Promise((r) => { const t = setInterval(() => { if (B.d.getElementById('loginUser')) { clearInterval(t); r(); } }, 200); setTimeout(() => { clearInterval(t); r(); }, 8000); });
  const lu = B.d.getElementById('loginUser'), lp = B.d.getElementById('loginPass');
  if (!lu) {   /* login card may already be up */
  }
  if (lu) {
    lu.value = 'MSK'; lp.value = OLD_PW;
    B.d.querySelector('[data-action="do-login"]').click();
    await sleep(2500);
  }
  if (!lu) console.log('  [dbg] B card: ' + ((B.d.getElementById('dlg') || {}).textContent || 'none').replace(/\s+/g, ' ').slice(0, 140));
  const authB = JSON.parse(B.w.localStorage.getItem('spr-auth-v1') || '{}');
  const v2B = JSON.parse(B.w.localStorage.getItem('p4c4-markbook-v2') || '{}');
  check(!(authB.users || []).length && !v2B.data, 'empty device stays empty (no MSK account, no vault)');
  check(B.d.body.classList.contains('auth-gate'), 'still at the sign-in gate = treated as a wrong password');
  const errB = (B.d.getElementById('loginErr') || {}).textContent || '';
  check(/Invalid username or password|holds no accounts/.test(errB), 'shows the normal wrong-password/empty-device message (got: ' + errB.slice(0, 60) + ')');
  try { B.dom.window.close(); } catch (e) {}

  console.log('== C: old password on a device WITH data does nothing ==');
  const seed = "try{localStorage.setItem('spr-auth-v1',JSON.stringify({users:[{username:'mo',name:'Mo',role:'admin',keyring:{},login:{v:1,salt:'AAAA',it:1000,wrap:{iv:'AAAA',ct:'AAAA'}}}],session:null}))}catch(e){}" +
    "try{localStorage.setItem('p4c4-markbook-v2',JSON.stringify({fmt:2,wraps:{mo:{salt:'AAAA',it:1000,iv:'AAAA',ct:'AAAA'}},ts:1,data:{v:1,iv:'AAAA',ct:'AAAA'}}))}catch(e){}";
  const C = boot(seed);
  await ack(C); await sleep(400);
  const lu2 = C.d.getElementById('loginUser');
  if (lu2) {
    lu2.value = 'MSK'; C.d.getElementById('loginPass').value = OLD_PW;
    C.d.querySelector('[data-action="do-login"]').click();
    await sleep(2000);
  }
  const authC = JSON.parse(C.w.localStorage.getItem('spr-auth-v1') || '{}');
  check((authC.users || []).length === 1 && authC.users[0].username === 'mo', 'existing device: no MSK account appeared');
  check(C.d.body.classList.contains('auth-gate'), 'gate still up (wrong password, nothing else)');
  try { C.dom.window.close(); } catch (e) {}

  console.log('== D: source scan — no password literal beside a login comparison ==');
  const bad = [];
  const scan = (rel) => {
    const src = fs.readFileSync(path.join(R, rel), 'utf8');
    const lines = src.split(/\r?\n/);
    lines.forEach((ln, i) => {
      /* a comparison against a hardcoded string that looks like a password
         (>=8 chars, mixes letters with digits/symbols) on/near a login check */
      if (/(verifyLogin|pwOk|===?\s*p\b|password\s*===?)/i.test(ln)) {
        for (let k = Math.max(0, i - 2); k <= Math.min(lines.length - 1, i + 2); k++) {
          const m = lines[k].match(/['"]([A-Za-z]{4,}[0-9$!@#%&*+][^'"]{3,})['"]/);
          if (m && !/spr-|p4c4|http|padding|Content-|sha256|data:|\.js|\.css|what|Press/i.test(m[1])) bad.push(rel + ':' + (k + 1) + ' ' + m[1].slice(0, 24));
        }
      }
    });
  };
  /* the built app/index.html embeds source/app.js verbatim (build2 splice) and
     vendors Chart.js/xlsx, whose base64/color literals are not passwords — so
     the per-line login scan covers source/, and the built file gets the exact
     literal checks in section A. */
  for (const f of fs.readdirSync(path.join(R, 'source')).filter((x) => x.endsWith('.js'))) scan('source/' + f);
  check(bad.length === 0, 'no password-like literal near login comparisons' + (bad.length ? ' — ' + bad.join(' ; ') : ''));

  console.log('RECOVERY-GONE: ' + pass + ' ok, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
