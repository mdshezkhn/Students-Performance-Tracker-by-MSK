/* data-safety regression suite (2026-10-28, reviewer items 1-9).
   Written FAILING FIRST against main f093f2f; every check maps to one
   reviewer item. Seeding is synchronous: the pre-script writes storage
   BEFORE the app boots, so restore sees a consistent world. */
const fs = require('fs'); const path = require('path'); const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');
const CS = require('../source/classstore.js');
const html0 = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V2_KEY = 'p4c4-markbook-v2', AUTH_KEY = 'spr-auth-v1', SAFETY_KEY = 'spr-safety-backups-v1', DS_KEY = 'spr-devicesync-v1';
const DLG_POLY = '(function(){var dd=document.getElementById("dlg");if(dd&&!dd.showModal){dd.showModal=function(){this.open=true};dd.close=function(){this.open=false;if(this.onclose)this.onclose()}}})();';
const CHART_STUB = 'window.Chart=function(){};Chart.defaults={font:{},color:"",borderColor:""};';

let PASS = 0, FAIL = 0;
function check(cond, label) { if (cond) { PASS++; console.log('  ok: ' + label); } else { FAIL++; console.log('  FAIL: ' + label); } }

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sealDbNode(dbObj, dk) {
  const k = await webcrypto.subtle.importKey('raw', dk, 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(dbObj))));
  return { iv: b64u(iv), ct: b64u(ct) };
}
let SEED_JSON = null;
let B_errs = [];
function dbFromSeed(mutate) {
  const seed = JSON.parse(SEED_JSON);
  const db = { semesters: seed.semesters, settings: {} };
  db.currentSemesterId = db.semesters[db.semesters.length - 1].id;
  if (mutate) mutate(db);
  return db;
}
/* returns a preExtra script: storage fully populated before the app boots */
async function preSeed(opts) {
  const o = opts || {};
  const dk = webcrypto.getRandomValues(new Uint8Array(32));
  const db = dbFromSeed(o.mutate);
  const data = await sealDbNode(db, dk);
  const v2 = JSON.stringify({ fmt: 2, wraps: {}, data: data, ts: o.ts || Date.now() });
  const auth = JSON.stringify({ users: [{ username: 'Mo', name: 'Mo', role: 'admin', keyring: {} }], session: { username: 'Mo', name: 'Mo', role: 'admin' } });
  const sess = JSON.stringify({ user: 'Mo', dk: b64u(dk) });
  let pre = 'try{localStorage.setItem("' + V2_KEY + '",' + JSON.stringify(v2) + ');}catch(e){}' +
            'try{localStorage.setItem("' + AUTH_KEY + '",' + JSON.stringify(auth) + ');}catch(e){}' +
            'try{sessionStorage.setItem("spr-session",' + JSON.stringify(sess) + ');}catch(e){}';
  if (o.mirror) pre += 'try{sessionStorage.setItem("spr-session-db",' + JSON.stringify(JSON.stringify(o.mirror)) + ');}catch(e){}';
  if (o.dsCfg) pre += 'try{localStorage.setItem("' + DS_KEY + '",' + JSON.stringify(JSON.stringify(o.dsCfg)) + ');}catch(e){}';
  return pre;
}
const PERSIST_STUB = 'try{Object.defineProperty(navigator,"storage",{value:{persist:async()=>{window.__PERSIST_CALLS=(window.__PERSIST_CALLS||0)+1;return true;},estimate:async()=>({usage:1,quota:2})},configurable:true});}catch(e){}';
function boot(preExtra) {
  const pre = '<script>' + DLG_POLY + CHART_STUB + (preExtra || '') + '</scr' + 'ipt>';
  const i = html0.lastIndexOf('</body>');
  const vc = new VirtualConsole();
  B_errs = [];
  vc.on('jsdomError', (e) => B_errs.push(String(e.message || e).slice(0, 140)));
  const dom = new JSDOM(html0.slice(0, i) + pre + html0.slice(i), {
    url: 'http://localhost/app/index.html#/dashboard', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc, storageQuota: 10000000,
  });
  const w = dom.window;
  try { Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle, configurable: true }); } catch (e) {}
  if (!w.TextEncoder) { w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; }
  return { w, d: w.document };
}
async function waitShell(B, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 12000)) {
    await sleep(250);
    const b = B.d.querySelector('[data-action="privacy-gate-ack"], [data-action="privacy-ack"]');
    if (b) b.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true }));
    if (!B.d.body.classList.contains('auth-gate')) return true;
  }
  return false;
}
function txt(B) { const c = B.d.body.cloneNode(true); c.querySelectorAll('script,style').forEach((n) => n.remove()); return c.textContent || ''; }
function dlgTxt(B) { const d = B.d.getElementById('dlg'); return d ? d.textContent : ''; }
function editStudentField(B, value) {
  const inp = B.d.querySelector('[data-stufield="nameEn"]');
  if (!inp) return false;
  inp.value = value; inp.dispatchEvent(new B.w.Event('input', { bubbles: true }));
  inp.dispatchEvent(new B.w.Event('change', { bubbles: true }));
  return true;
}
function click(B, el) { el.dispatchEvent(new B.w.MouseEvent('click', { bubbles: true })); }

(async () => {
  /* grab the app's own demo seed once (the built bundle embeds it) */
  const P0 = boot(); await sleep(900); SEED_JSON = JSON.stringify(P0.w.SEED); P0.w.close();
  if (!SEED_JSON || SEED_JSON === 'null') { console.error('no SEED in bundle'); process.exit(2); }

  /* ================= 1. two tabs: stale tab must not overwrite ================= */
  console.log('1. stale tab cannot overwrite a newer write');
  {
    const A = boot(await preSeed()); await sleep(300);
    check(await waitShell(A), 'admin signed in');
    A.w.location.hash = '#/students'; await sleep(600);
    /* let any boot-time write (backup nudge etc.) finish so the fake "tab B"
       write below is the last one before the edit */
    await sleep(700);
    let stored;
    for (let t = 0; t < 8; t++) {
      stored = JSON.parse(A.w.localStorage.getItem(V2_KEY));
      await sleep(350);
      const again = JSON.parse(A.w.localStorage.getItem(V2_KEY));
      if (again.ts === stored.ts) break;
      stored = again;
    }
    stored.ts = Date.now() + 90000;                       /* "tab B" wrote newer */
    A.w.localStorage.setItem(V2_KEY, JSON.stringify(stored));
    const edited = editStudentField(A, 'Benjamin-Edited');
    check(edited, 'made an edit in the stale tab');
    await sleep(1200);
    check(!!A.d.getElementById('spr-stale'), 'stale overlay shown (reload prompt)');
    const after = JSON.parse(A.w.localStorage.getItem(V2_KEY));
    check(after.ts === stored.ts, 'stale tab did NOT overwrite the newer blob');
    A.w.close();
  }

  /* ================= 2. failed write must NOT say "Saved" ================= */
  console.log('2. write failure: persistent banner, no false Saved');
  {
    const A = boot(await preSeed()); await sleep(300);
    check(await waitShell(A), 'signed in');
    const origSet = A.w.Storage.prototype.setItem;
    A.w.Storage.prototype.setItem = function (k, v) { if (k === V2_KEY) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } return origSet.call(this, k, v); };
    A.w.location.hash = '#/students'; await sleep(600);
    editStudentField(A, 'Carina');
    await sleep(1200);
    const banner = A.d.getElementById('saveAlert');
    check(!!banner, 'persistent NOT-SAVED banner shown');
    check(!!banner && /NOT SAVED/i.test(banner.textContent), 'banner says NOT SAVED with advice');
    check(!!banner && !!banner.querySelector('[data-action="dl-backup"]'), 'banner has a Download backup button');
    check((A.d.getElementById('savedDot') || {}).textContent !== 'Saved', 'indicator does not claim Saved');
    A.w.Storage.prototype.setItem = origSet;
    A.w.close();
  }

  /* ================= 3. storage.persist + one-tap backup + Manage line ================= */
  console.log('3. persistent storage + backup affordances');
  {
    const A = boot(PERSIST_STUB + await preSeed()); await sleep(300);
    check(await waitShell(A), 'signed in');
    await sleep(600);
    check((A.w.__PERSIST_CALLS || 0) >= 1, 'navigator.storage.persist() requested after sign-in');
    check(!!A.d.querySelector('[data-action="dl-backup"]'), 'one-tap Download backup in the sidebar');
    A.w.location.hash = '#/manage'; await sleep(600);
    check(/Persistent storage/.test(txt(A)), 'Manage shows persistent-storage status');
    A.w.close();
  }

  /* ================= 4. password policy + forced recovery ================= */
  console.log('4. password policy (CS.pwOk) + first-run recovery gate');
  {
    check(typeof CS.pwOk('admin', '1') === 'string', 'admin pw "1" rejected');
    check(typeof CS.pwOk('admin', 'password') === 'string', 'common pw "password" rejected for admin');
    check(CS.pwOk('admin', 'Str0ngPass!73') === null, 'strong admin pw accepted');
    check(CS.pwOk('teacher', 'abc123') === null, 'teacher pw >= 6 accepted');
    check(typeof CS.pwOk('teacher', 'abc12') === 'string', 'teacher pw < 6 rejected');

    const A = boot(); await sleep(700);
    await waitShell(A);   /* privacy gate -> sign-in card */
    const su = A.d.querySelector('[data-action="show-setup"]');
    if (su) { click(A, su); await sleep(300); }
    const set = (id, v) => { const e = A.d.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new A.w.Event('input', { bubbles: true })); } };
    set('suUser', 'Mo'); set('suPass', 'Str0ngPass!73'); set('suConf', 'Str0ngPass!73');
    click(A, A.d.querySelector('[data-action="first-run"]'));
    let recDlg = false;
    for (let t = 0; t < 24; t++) { await sleep(250); recDlg = /recovery|master password/i.test(dlgTxt(A)) && A.d.getElementById('dlg') && A.d.getElementById('dlg').open; if (recDlg) break; }
    check(recDlg, 'first-run stops at a recovery-path dialog (master password or recovery file)');
    const ack = A.d.querySelector('[data-action="recovery-ack"]');
    if (ack) { click(A, ack); await sleep(600); }
    check(!A.d.body.classList.contains('auth-gate') || !!A.d.querySelector('#app .page'), 'setup completes once a recovery path is chosen');
    A.w.close();
  }

  /* ================= 5. device-sync write token on every push ================= */
  console.log('5. sync pushes carry the write token');
  {
    const A = boot(await preSeed({ dsCfg: { on: true, channel: '11111111-2222-3333-4444-555555555555', key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', adoptedAcct: true, writeToken: 'tok-abc123' } }));
    await sleep(300);
    check(await waitShell(A), 'signed in');
    const calls = [];
    A.w.fetch = async (url, opts) => { calls.push({ url: String(url), opts: opts || {} }); return { ok: true, status: 204, json: async () => [] }; };
    A.w.location.hash = '#/students'; await sleep(500);
    editStudentField(A, 'Benjamin');
    A.w.dispatchEvent(new A.w.PageTransitionEvent('pagehide'));
    await sleep(1500);
    const pushes = calls.filter((c) => (/rest\/v1\/spr_channels/.test(c.url) || /rest\/v1\/rpc\/spr_channel_write/.test(c.url)) && (c.opts.method === 'PATCH' || c.opts.method === 'POST'));
    if (!pushes.length) console.log('    [dbg] fetch calls seen:', calls.map((c) => (c.opts.method || 'GET') + ' ' + c.url.slice(-40)).join(' | ') || '(none)');
    check(pushes.length >= 1, 'a push was attempted');
    /* round5 item 1 + round6: a brand-new channel is ARMED at its first insert
       (write_token_hash in the body); an existing row is written via the
       spr_channel_write RPC with the token in the body. This harness has no
       pre-existing row, so the armed insert is the correct path here. */
    const rpcPush = pushes.find((c) => /rpc\/spr_channel_write/.test(c.url));
    const insPush = pushes.find((c) => /rest\/v1\/spr_channels$/.test(c.url.split('?')[0]) && c.opts.method === 'POST');
    check((!!rpcPush && String(rpcPush.opts.body || '').includes('p_token')) ||
          (!!insPush && String(insPush.opts.body || '').includes('write_token_hash')),
      'push carries the token: RPC body (round5) or armed insert (round6)');
    A.w.close();
  }

  /* ================= 6. 300 ms window: mirror newer than store -> recover ================= */
  console.log('6. newer session mirror offers recovery');
  {
    const db2 = dbFromSeed((db) => { db.semesters[db.semesters.length - 1].students[0].nameEn = 'Benjamin'; });   /* the CURRENT semester is the one on screen */
    const A = boot(await preSeed({ ts: Date.now() - 5000, mirror: { ts: Date.now() - 1000, db: db2 } }));
    await sleep(300);
    await waitShell(A); await sleep(900);
    check(/recover/i.test(dlgTxt(A)) && A.d.getElementById('dlg') && A.d.getElementById('dlg').open, 'boot offers to recover the newer mirror');
    const go = A.d.querySelector('#dlg [data-x="1"]');
    if (go) { click(A, go); await sleep(900); }
    A.w.location.hash = '#/students'; await sleep(600);
    const nameInp = A.d.querySelector('[data-stufield="nameEn"]');   /* the editor shows values, not text nodes */
    const anyBen = Array.from(A.d.querySelectorAll('[data-stufield="nameEn"]')).some((i) => i.value === 'Benjamin');
    check(anyBen, 'recovered data (Benjamin) is live after accepting');
    A.w.close();
  }

  /* ================= 7. deletes keep an automatic safety copy ================= */
  console.log('7. deletes stash a safety copy and say so');
  {
    const A = boot(await preSeed()); await sleep(300);
    check(await waitShell(A), 'signed in');
    A.w.location.hash = '#/students'; await sleep(600);
    const del = A.d.querySelector('[data-action="stu-del"]');
    if (!del) { check(false, 'students tab renders remove buttons'); }
    else {
      click(A, del); await sleep(400);
      check(/safety copy/i.test(dlgTxt(A)), 'delete dialog mentions the automatic safety copy');
      const ok = A.d.querySelector('#dlg [data-x="1"]');
      click(A, ok); await sleep(900);
      const list = JSON.parse(A.w.localStorage.getItem(SAFETY_KEY) || '[]');
      check(list.length >= 1 && (list[0].label || '').length > 3, 'safety copy stashed before removal');
    }
    A.w.close();
  }

  /* ================= 8. reset.html is not a one-click public wipe ================= */
  console.log('8. reset.html: ERASE gate + forced raw copy first');
  {
    const rh = fs.readFileSync(path.join(__dirname, '..', 'reset.html'), 'utf8');
    check(/toUpperCase\(\)\s*===?=?\s*['"]ERASE['"]|value\s*===?=?\s*['"]ERASE['"]/.test(rh), 'requires typing ERASE');
    check(/id="wipe"[^>]*disabled/.test(rh), 'wipe button starts disabled');
    check(/(wipe|btn)\s*\.\s*disabled\s*=\s*false|wipe\.removeAttribute\('disabled'\)/.test(rh), 'wipe enables only after the raw copy is saved');
    check(!/optional/i.test(rh), 'raw copy is no longer described as optional');
    check(html0.indexOf('reset.html') === -1, 'app bundle does not link reset.html');
  }

  /* ================= 9. vault mode: admin sees the exposure warning ================= */
  console.log('9. vault mode warns that every sign-in shares the markbook');
  {
    const A = boot(await preSeed()); await sleep(300);
    check(await waitShell(A), 'signed in');
    A.w.location.hash = '#/manage'; await sleep(600);
    check(/single-markbook|each teacher gets their own class|opens this same markbook/i.test(txt(A)), 'Manage shows the vault-mode warning');
    const add = A.d.querySelector('[data-action="acct-add-open"]');
    click(A, add); await sleep(400);
    check(/same markbook|their own class/i.test(dlgTxt(A)), 'Add-account dialog carries the warning');
    A.w.close();
  }

  console.log('\nDATA-SAFETY: ' + PASS + ' ok, ' + FAIL + ' FAIL');
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR:', e.stack || e.message); process.exit(2); });
