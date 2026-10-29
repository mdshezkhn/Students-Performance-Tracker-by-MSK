/* =========================================================================
   P4C4 Markbook: UI application (requires: Calc, Util, ExcelBridge, XLSX,
   Chart, window.SEED)
   ========================================================================= */
(function () {
  'use strict';
  const C = window.Calc, U = window.Util, EB = window.ExcelBridge, XLSX = window.XLSX, A = window.Analysis;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const SKILLS = C.SKILLS;
  const GRADE_HEX = { 'A*': '#1d7a4a', A: '#58a05f', B: '#c9973b', C: '#ce7b33', D: '#c4453c', U: '#9aa0a0' };
  const GC = { 'A*': 'g-As', A: 'g-A', B: 'g-B', C: 'g-C', D: 'g-D', U: 'g-U' };
  const COLORS = { obs: '#3e7c68', sp: '#8a5e86', da: '#4a7397', cls: '#9aa79f',
    Listening: '#3e7c68', Speaking: '#8a5e86', Writing: '#c9973b', Reading: '#b2683f' };
  const gBadge = (l) => (l ? '<span class="g ' + GC[l] + '">' + U.esc(l) + '</span>' : '<span class="g g-none">–</span>');
  /* ---- assessment-completeness gate (single source of truth: Calc) ---- */
  const nOf9 = (g) => C.assessedCount(g);
  const gateOk = (g) => C.assessedCount(g) >= C.FINAL_MIN_ASSESSED;
  const gateFinal = (g) => C.assessedCount(g) >= C.COMPONENTS_ALL.length;
  function provChip(g) { /* neutral, text-first chip for records below the gate */
    return '<span class="g prov" title="Final grades appear when at least 6 of 9 grading components have recorded assessment data.">' + nOf9(g) + '/9</span>';
  }
  function finalCell(g) { /* Grading table Final column */
    if (!gateOk(g)) return '<span class="small muted">Not yet assessed</span>';
    return '<b>' + fmt(g.final, 1) + '</b>' + (gateFinal(g) ? '' : ' <span class="small muted">P' + nOf9(g) + '/9</span>');
  }
  function gradeCell(g) {
    if (!gateOk(g)) return provChip(g);
    return gBadge(g.letter) + (gateFinal(g) ? '' : '<span class="small muted"> ' + nOf9(g) + '/9</span>');
  };
  const fmt = (v, d) => (v === null || v === undefined || isNaN(v)) ? '–' : Number(v).toFixed(d === undefined ? 1 : d);
  const r1x = (v) => (v === null ? null : Math.round(v * 10) / 10);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  /* ================================ state ================================ */
  const LS_KEY = 'p4c4-markbook-v1';
  const V2_KEY = 'p4c4-markbook-v2';
  const CORRUPT_PREFIX = 'p4c4-markbook-corrupt-';
  let DB = null, saveTimer = null;
  let SESSION = { user: null, dk: null, pw: null };   // raw 256-bit master key, memory only (online mode); pw = signed-in password, memory only: used to re-wrap the device-sync key so fresh devices can bootstrap by sign-in alone
  function cryptoOK() { return !!(window.crypto && window.crypto.subtle); }
  const ui = { q: '', grQ: '', gsort: { k: 'final', d: -1 }, entryMonth: {}, wizMonths: null, anMode: 'class', anStu: null };

  function acadRank(m) { const i = U.MONTHS.indexOf(m); return i < 0 ? 99 : ((i - 8 + 12) % 12) + 1; }
  function normalizeSemester(sem) {
    sem.school = sem.school || 'School';
    sem.className = sem.className || '';
    sem.teachers = Array.isArray(sem.teachers) ? sem.teachers : [];
    const m = String(sem.name || '').match(/(20\d{2})[\s._-]*(fall|spring)/i);
    sem.year = sem.year || (m ? Number(m[1]) : null);
    sem.period = sem.period || (m ? m[2].toLowerCase() : null);
    sem.months = (sem.months || []).filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => acadRank(a) - acadRank(b));
    sem.students = sem.students || [];
    sem.students.forEach((s) => { if (s) s.gender = U.normGender(s.gender); });
    sem.observations = sem.observations || {};
    sem.spelling = sem.spelling || {};
    sem.daily = sem.daily || {};
    sem.tests = sem.tests || {};
    sem.reportNotes = sem.reportNotes || {}; /* teacher-edited report wording (Brief 2) */
    /* self-heal any invalid stored scores (legacy saves, hand-edited backups);
       count surfaces in __droppedInvalid (non-enumerable) for a one-time toast */
    const moved = C.sanitizeSemester(sem);
    if (moved.length) {
      /* non-destructive: values are quarantined into sem.review for the
         teacher to fix or discard: a safety copy is stashed first so nothing
         is ever silently lost (browser only; pure loads in Node) */
      try { if (typeof stashSafetyBackup === 'function') stashSafetyBackup('before quarantining invalid scores'); } catch (e) {}
      sem.review = sem.review || [];
      for (const mv of moved) {
        if (!sem.review.some((r) => r.area === mv.area && r.sid === mv.sid && r.month === mv.month && r.key === mv.key && r.value === mv.value)) sem.review.push(mv);
      }
      Object.defineProperty(sem, '__movedInvalid', { value: moved.length, enumerable: false, configurable: true });
    }
    return sem;
  }
  function emptyDB() {
    return { v: 1, currentSemesterId: null, semesters: [],
      credit: 'Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)',
      author: 'Mohammed Shehzad Khan (Teacher Mo)',
      settings: { autoTotal: true, spTotal: 20, daTotal: 10 } };
  }
  function seedFromWindow() {
    const db = emptyDB();
    if (window.SEED && Array.isArray(window.SEED.semesters) && window.SEED.semesters.length) {
      db.semesters = window.SEED.semesters.map((s) => normalizeSemester(JSON.parse(JSON.stringify(s))));
      db.semesters.forEach((s) => { if (!s.teachers.length) s.teachers = ['Mo', 'Lisa']; });
      db.currentSemesterId = db.semesters[db.semesters.length - 1].id;
    }
    return db;
  }
  function loadDBLegacy() {
    /* Legacy plaintext loader (offline file:// mode / pre-encryption data).
       NEVER wipes on failure: a broken payload is preserved for recovery. */
    let raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) {}
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.semesters)) throw new Error('bad shape');
      return normalizeDB(d);
    } catch (e) {
      try { localStorage.setItem(CORRUPT_PREFIX + Date.now(), raw); } catch (e2) {}
      window.__SPR_CORRUPT = { at: Date.now(), raw: raw };
      return null;
    }
  }
  function readV2() {
    try { const v = JSON.parse(localStorage.getItem(V2_KEY)); return (v && v.fmt === 2 && v.data) ? v : null; } catch (e) { return null; }
  }
  function completenessCount(g) {
    try {
      const p = g.parts || {};
      const keys = Object.keys(p);
      return keys.filter((k) => p[k] !== null && p[k] !== undefined).length + '/' + (keys.length || 9);
    } catch (e) { return '?'; }
  }
  function normalizeDB(db) {
    db.semesters.forEach(normalizeSemester);
    db.settings = Object.assign({ autoTotal: true, spTotal: 20, daTotal: 10 }, db.settings || {});
    if (!db.semesters.find((s) => s.id === db.currentSemesterId)) db.currentSemesterId = db.semesters[0] ? db.semesters[0].id : null;
    return db;
  }
  function saveDB(silent) {
    /* online: immediate plaintext mirror in sessionStorage (dies with the tab)
       + debounced ENCRYPTED write to localStorage; offline: legacy plaintext. */
    try { if (SESSION.dk) sessionStorage.setItem('spr-session-db', JSON.stringify({ ts: Date.now(), db: DB })); } catch (e) {}
    try { localStorage.setItem('spr-edits-since-backup', String((Number(localStorage.getItem('spr-edits-since-backup')) || 0) + 1)); } catch (e5) {}
    clearTimeout(saveTimer);
    if (CLS && CLS_KEY) saveTimer = setTimeout(() => classPersistNow(silent), 300);
    else if (cryptoOK() && SESSION.dk) saveTimer = setTimeout(() => persistNow(silent), 300);
    else saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) { toast('Could not save: storage full?', true); }
      flashSaved(silent);
    }, 300);
  }
  function flashSaved(silent) {
    const dot = $('#savedDot');
    if (dot && !silent) {
      dot.textContent = 'Saved'; dot.classList.add('flash');
      setTimeout(() => { dot.textContent = ''; dot.classList.remove('flash'); }, 1300);
    }
  }
  /* ---- data-safety (2026-10-28): honest save reporting + stale-tab guard ----
     A write that fails must never claim Saved (item 2), and a tab holding a
     stale copy must never write over a newer one (item 1). */
  let KNOWN_STORE_TS = 0;   /* ts of the v2 blob this tab loaded or last wrote */
  let CLS_TS = 0;           /* ts of the class blob this tab loaded or last wrote */
  let SPR_STALE = false;    /* another window wrote newer data; this tab is read-only */
  let saveRetryTimer = null;
  let SPR_PERSIST = null;   /* navigator.storage.persist() result, shown in Manage */
  function classBlobTs(rawStr) { try { const b = JSON.parse(rawStr); return (b && b.ts) || 0; } catch (e) { return 0; } }
  function storedV2Ts() { try { const v = JSON.parse(localStorage.getItem(V2_KEY)); return (v && v.ts) || 0; } catch (e) { return 0; } }
  function showStaleOverlay() {
    if (document.getElementById('spr-stale')) return;
    SPR_STALE = true;
    const d = document.createElement('div');
    d.id = 'spr-stale';
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(29,33,26,.62);display:flex;align-items:center;justify-content:center;padding:20px';
    d.innerHTML = '<div style="max-width:440px;background:#fffdf6;border-radius:14px;padding:26px 28px;box-shadow:0 18px 60px rgba(0,0,0,.35)">' +
      '<h3 style="margin:0 0 8px;font-family:var(--font-display)">Another window changed this class</h3>' +
      '<p class="small" style="margin:0 0 16px">This window is out of date. Saving here would erase the newer changes, so editing is paused.</p>' +
      '<button class="btn primary" data-action="stale-reload">Reload to continue</button></div>';
    document.body.appendChild(d);
  }
  function saveFailedBanner() {
    if (document.getElementById('saveAlert')) return;
    const b = document.createElement('div'); b.id = 'saveAlert';
    b.style.cssText = 'position:sticky;top:0;z-index:900;background:#8f2f2b;color:#fff;padding:10px 16px;font-size:14px';
    b.innerHTML = '<b>NOT SAVED</b> \u2014 storage is full or blocked. Download a backup now. ' +
      '<button class="btn sm" data-action="dl-backup" style="margin-left:8px">Download backup</button>';
    document.body.insertBefore(b, document.body.firstChild);
    clearTimeout(saveRetryTimer);
    saveRetryTimer = setTimeout(() => { saveRetryTimer = null; persistNow(true); }, 10000);
  }
  function saveOkBanner() { const b = document.getElementById('saveAlert'); if (b) b.remove(); }
  window.addEventListener('beforeunload', function (e) {
    if (document.getElementById('saveAlert')) { e.preventDefault(); e.returnValue = ''; }
  });
  function requestPersistentStorage() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return;
      if (navigator.storage.persisted) {
        /* current truth FIRST (answers in ms); persist() refines it after */
        navigator.storage.persisted().then(function (yes) { if (SPR_PERSIST === null) { SPR_PERSIST = !!yes; if (location.hash === '#/manage') renderManage(); } }).catch(function () {});
      }
      navigator.storage.persist().then(function (ok) { SPR_PERSIST = !!ok; if (location.hash === '#/manage') renderManage(); }).catch(function () { SPR_PERSIST = false; });
      setTimeout(function () { if (SPR_PERSIST === null) { SPR_PERSIST = false; if (location.hash === '#/manage') renderManage(); } }, 3000);   /* round5 item 4: never stick on checking */
    } catch (e) { SPR_PERSIST = false; }
  }
  async function persistNow(silent) {
    if (SPR_STALE) { showStaleOverlay(); return false; }
    if (CLS && CLS_KEY) { return classPersistNow(silent); }
    try {
      if (storedV2Ts() > KNOWN_STORE_TS) { showStaleOverlay(); return false; }   /* another tab wrote newer data */
      const v2 = readV2() || { fmt: 2, wraps: {} };
      v2.fmt = 2;
      v2.data = await sealDB(DB, SESSION.dk);
      v2.ts = Date.now();
      KNOWN_STORE_TS = v2.ts;
      if (!writeV2(v2)) { saveFailedBanner(); return false; }   /* quota/blocked */
      saveOkBanner();
      flashSaved(silent);
      return true;
    } catch (e) {
      toast('Could not save: storage full?', true);
      saveFailedBanner();
      return false;
    }
  }
  /* ---- payload validation: every import path (sync pull/join, JSON restore,
     Excel import) passes through here before data reaches the app ---- */
  function validateDB(db) {
    if (!db || typeof db !== 'object' || !Array.isArray(db.semesters)) throw new Error('not a valid SPR workbook (missing semesters)');
    if (db.semesters.length > 60) throw new Error('too many semesters');
    if (JSON.stringify(db).length > 4000000) throw new Error('workbook too large');
    for (const s of db.semesters) {
      if (!s || typeof s !== 'object') throw new Error('bad semester entry');
      if (!Array.isArray(s.months) || !s.months.length || s.months.some((m) => typeof m !== 'string' || !/^[A-Za-z]+$/.test(m))) throw new Error('bad month list in "' + String(s.name || '').slice(0, 30) + '"');
      if (!Array.isArray(s.students)) throw new Error('bad students in "' + String(s.name || '').slice(0, 30) + '"');
      if (s.students.length > 400) throw new Error('too many students in "' + String(s.name || '').slice(0, 30) + '"');
      for (const st of s.students) {
        if (!st || typeof st !== 'object') throw new Error('bad student entry');
        if (typeof st.id !== 'string' || !st.id || /[^A-Za-z0-9_\-]/.test(st.id)) throw new Error('bad student id: ' + String(st.id).slice(0, 24));
        for (const k of ['nameCn', 'nameEn']) {
          if (st[k] != null && typeof st[k] !== 'string') throw new Error('bad name field in student ' + st.id);
        }
      }
    }
    return db;
  }
  function downloadBackup() {
    try {
      const blob = new Blob([JSON.stringify(DB)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'SPR-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      try { localStorage.setItem('spr-edits-since-backup', '0'); } catch (e2) {}
      saveOkBanner();
    } catch (e) {}
  }
  /* in-app safety copy kept BEFORE data gets replaced (join link, cloud copy,
     backup restore). No file lands in Downloads: non-technical teachers saw
     the sudden .json and lost trust in the app. Last 3 copies, and if the
     storage quota refuses, fall back to the old file download so a copy is
     never silently missing. */
  const SAFETY_KEY = 'spr-safety-backups-v1';
  function stashSafetyBackup(label) {
    try {
      const list = JSON.parse(localStorage.getItem(SAFETY_KEY) || '[]');
      list.unshift({ t: Date.now(), label: label || 'before replace', db: DB });
      while (list.length > 3) list.pop();
      localStorage.setItem(SAFETY_KEY, JSON.stringify(list));
      toast('Safety copy kept: Manage → Backups can bring it back');
      return true;
    } catch (e) { downloadBackup(); return false; }
  }
  function safetyBackups() {
    try { const l = JSON.parse(localStorage.getItem(SAFETY_KEY) || '[]'); return Array.isArray(l) ? l : []; }
    catch (e) { return []; }
  }
  function persistReplaced(db) {
    validateDB(db);
    normalizeDB(db);
    DB = db;
    if (cryptoOK() && SESSION.dk) persistNow(true);
    else { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) {} }
    location.reload();
  }
  /* ---- encryption core (online mode): PBKDF2-SHA256 310k -> AES-GCM.
     Random master key, wrapped per user with their login password; the key
     only ever lives in memory + sessionStorage (cleared when the tab closes). ---- */
  const PBKDF2_IT = 600000, PBKDF2_IT_LEGACY = 310000;   /* P1.1: v2 wraps; legacy wraps keep their own count */
  async function deriveKeyBits(password, saltBytes, iterations) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: iterations || PBKDF2_IT, hash: 'SHA-256' }, base, 256));
  }
  async function aesKeyRaw(raw) { return subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  async function sealDB(dbObj, dk) {
    const k = await aesKeyRaw(dk);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(dbObj))));
    return { iv: b64uFromBytes(iv), ct: b64uFromBytes(ct) };
  }
  async function unsealDB(data, dk) {
    const k = await aesKeyRaw(dk);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: bytesFromB64u(data.iv) }, k, bytesFromB64u(data.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function makeWrap(dk, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kb = await deriveKeyBits(password, salt);
    const k = await aesKeyRaw(kb);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv }, k, dk));
    return { v: 2, it: PBKDF2_IT, salt: b64uFromBytes(salt), iv: b64uFromBytes(iv), ct: b64uFromBytes(ct) };
  }
  async function unwrapWrap(w, password) {
    const kb = await deriveKeyBits(password, bytesFromB64u(w.salt), w.it || PBKDF2_IT_LEGACY);
    const k = await aesKeyRaw(kb);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytesFromB64u(w.iv) }, k, bytesFromB64u(w.ct)));
  }
  function cur() { return DB.semesters.find((s) => s.id === DB.currentSemesterId) || DB.semesters[0] || null; }

  /* ================================ class mode ================================
     Per-class encrypted workbooks (agreed-rule scoping: see ClassStore header
     and docs/CLASS-MODE.md). Mode 'legacy' keeps the single-blob markbook;
     mode 'class' stores one sealed blob per class + a per-user keyring of
     class keys wrapped under each account's own password. */
  const CS = window.ClassStore;
  const MODE_KEY = 'spr-mode-v1';
  const CLASS_INDEX_KEY = 'spr-class-index-v1';
  const classBlobKey = (id) => 'spr-class-' + id;
  function sprMode() { try { return localStorage.getItem(MODE_KEY) === 'class' ? 'class' : 'legacy'; } catch (e) { return 'legacy'; } }
  function classIndex() { try { const ix = JSON.parse(localStorage.getItem(CLASS_INDEX_KEY) || '[]'); return Array.isArray(ix) ? ix : []; } catch (e) { return []; } }
  function setClassIndex(ix) { localStorage.setItem(CLASS_INDEX_KEY, JSON.stringify(ix)); }
  function classRole(r) { return r === 'management' ? 'manager' : r === 'teacher' ? 'eal' : r; }
  function myUser() {
    const u = currentUser();
    if (!u || !u.username) return null;
    return { username: u.username, name: u.name || u.username, role: classRole(u.role) };
  }
  let CLS = null;            /* { id } of the open class (class mode) */
  let CLS_KEY = null;        /* raw AES key bytes of the open class */
  function clsMeta() { return CLS ? classIndex().find((c) => c.id === CLS.id) || null : null; }
  function canDo(action) {
    if (sprMode() !== 'class' || !CLS) return true;   /* legacy mode keeps today's behaviour */
    return CS.can(myUser(), action, clsMeta());
  }
  function classPendingCount() { return (DB && Array.isArray(DB.pending)) ? DB.pending.length : 0; }
  /* the class list / open-close cycle ------------------------------------------ */
  /* recovery dialog for "the wrap exists but this password cannot open it":
     the key was sealed under a one-time migration/setup password. Offers the
     plain recoveries (cloud copy / backup file) AND: new: deriving the key
     from that one-time password, then re-sealing it under the admin's own
     password so plain sign-in works from then on. Resolves:
       'open'    key recovered + in SESSION (caller falls through to open)
       'pull'    user chose "check for a newer copy"
       'restore' user chose "restore from a backup file"
       null      dismissed */
  function cannotUnlockDialog(meta, id, meRaw) {
    return new Promise((resolve) => {
      const primary = dsOn() ? 'Check for a newer copy' : 'Restore from a backup file';
      openDlg(
        '<h3>Cannot open ' + U.esc(meta.name) + ' on this device</h3>' +
        '<p class="small">The saved copy needs its class key, and this device cannot derive it from your password. This happens when the class was set up while the sign-in had expired: the key was then saved under a one-time password that was shown only once.</p>' +
        '<div class="dlg-actions" style="flex-wrap:wrap;gap:8px">' +
        '<button class="btn" data-otp="1">I have the one-time password from setup</button>' +
        '<button class="btn primary" data-x="1">' + primary + '</button>' +
        '<button class="btn" data-x="0">Not now</button></div>');
      const dlg = document.getElementById('dlg');
      const done = (v) => { try { dlg.removeEventListener('click', h); } catch (e2) {} try { closeDlg(); } catch (e3) {} resolve(v); };
      function h(e) {
        const b = e.target.closest('[data-otp],[data-otp-apply],[data-x]');
        if (!b) return;
        if (b.hasAttribute('data-otp')) {
          e.preventDefault(); e.stopPropagation();
          openDlg(
            '<h3>Enter the one-time password</h3>' +
            '<p class="small">It was shown once when the class was set up (a slip like <code>abc12-def34-ghi56-jkl78</code>). It opens this class: SPR then saves the key under your own password again, so ordinary sign-in keeps working.</p>' +
            '<input class="inp" id="otp-inp" autocomplete="off" spellcheck="false" placeholder="one-time password">' +
            '<p class="small" id="otp-err" style="color:#c0392b;margin:6px 0 0"></p>' +
            '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button>' +
            '<button class="btn primary" data-otp-apply="1">Unlock with it</button></div>');
          const inp = document.getElementById('otp-inp'); if (inp) inp.focus();
          return;
        }
        if (b.hasAttribute('data-otp-apply')) {
          e.preventDefault(); e.stopPropagation();
          const val = ((document.getElementById('otp-inp') || {}).value || '').trim();
          (async () => {
            let k = null;
            try { k = await CS.unwrapKey(meRaw.keyring[id], val); } catch (e2) { k = null; }
            if (!k) { const er = document.getElementById('otp-err'); if (er) er.textContent = 'That password does not match the one shown at setup. Check the slip and try again.'; return; }
            SESSION.keys[id] = k; classKeysToSession();
            try {   /* re-seal under the admin's own password: plain sign-in works from now on */
              const auth = getAuth();
              const u = auth.users.find((x) => x.username === meRaw.username);
              if (u && SESSION.pw) { u.keyring = u.keyring || {}; u.keyring[id] = await CS.wrapKey(k, SESSION.pw); saveAuth(auth); }
            } catch (e3) {}
            done('open');
          })();
          return;
        }
        done(b.getAttribute('data-x') === '1' ? (dsOn() ? 'pull' : 'restore') : null);
      }
      dlg.addEventListener('click', h);
    });
  }

  async function openClass(id) {
    try { window.__SPR_OC = 'entered ' + id; } catch (e9) {}
    const meta = classIndex().find((c) => c.id === id);
    if (!meta) { try { window.__SPR_OC += ' | no-meta'; } catch (e9) {} toast('That class no longer exists here', true); return; }
    const raw = localStorage.getItem(classBlobKey(id));
    let key = (SESSION.keys || {})[id];
    if (!raw || !key) {
      /* the account holds a wrap for this class but the session does not hold
         the unwrapped key. Three honest cases:
           a) session restored (no password in memory) -> one real sign-in
              derives it: say so;
           b) password in memory -> derive RIGHT NOW, no re-sign-in theatre;
           c) derive impossible (the wrap lives under a one-time migration
              password this device never saw) -> say exactly that and offer
              the real recoveries (cloud copy / backup file). Never advice
              that cannot work. */
      const me2 = myUser();
      const meRaw = me2 && (getAuth().users || []).find(function (x) { return x.username === me2.username; });
      if (raw && meRaw && meRaw.keyring && meRaw.keyring[id]) {   /* myUser() has no keyring: read the raw auth record */
        if (!SESSION.pw) {
          const okRe = await confirmDlg('One more sign-in needed',
            'This device holds your key for <b>' + U.esc(meta.name) + '</b>, but this session was restored without it. Sign in once more and the class opens straight away.',
            'Sign out now');
          if (okRe) doLogout();
          return;
        }
        try { key = await CS.unwrapKey(meRaw.keyring[id], SESSION.pw); } catch (e) { key = null; }
        if (key) {
          SESSION.keys[id] = key;
          classKeysToSession();
          /* fall through — the class opens below */
        } else {
          const res = await cannotUnlockDialog(meta, id, meRaw);
          if (res === 'open') { key = SESSION.keys[id];   /* recovered from the one-time password: fall through, the class opens now */ }
          else {
            if (res === 'pull') dsPullCheck(true);
            else if (res === 'restore') { const f = document.getElementById('file-restore-all'); if (f) f.click(); }
            return;
          }
        }
      } else {
      /* never a dead end: one sentence + ONE primary button + Sign out is
         always visible on the screen behind */
      const what = !raw
        ? 'The data for <b>' + U.esc(meta.name) + '</b> is not on this device.'
        : 'This device does not hold the key that opens <b>' + U.esc(meta.name) + '</b>.';
      const ok = await confirmDlg('Cannot open ' + meta.name + ' yet',
        what + '<br><br>' + (dsOn()
          ? 'Pull the newest copy from the cloud now? Your current data is kept as a safety copy.'
          : 'Restore a backup file on this screen' + (myUser() && myUser().role !== 'admin' ? ', or ask your admin to set up device sync for you.' : '.')),
        dsOn() ? 'Check for a newer copy' : 'Restore from a backup file');
      if (ok) {
        if (dsOn()) dsPullCheck(true);
        else { const f = document.getElementById('file-restore-all'); if (f) f.click(); }
      }
      return;
      }   /* else: no wrap at all: the generic recovery above */
    }
    try {
      const wb = normalizeDB(await CS.openClass(JSON.parse(raw), key));
      CLS = { id: id }; CLS_KEY = key;              /* only now is the class open */
      CLS_TS = classBlobTs(raw) || Date.now();      /* item 1: adopt the blob we just opened */
      DB = wb;
      DB.sprClass = 1; DB.id = id;   /* DB IS the class workbook now */
      ui.classOpen = true;
      /* self-heal: if the stored wrap cannot be derived from the user's real
         password (e.g. it was sealed under a one-time migration password on
         another device), re-seal it now while we hold the correct key:
         after this, sign-in alone unlocks the class again on every device */
      if (SESSION.pw) {
        const meH = myUser();
        const meRawH = meH && (getAuth().users || []).find(function (x) { return x.username === meH.username; });
        if (meRawH) {
          let wrapOk = false;
          try { wrapOk = !!(meRawH.keyring && meRawH.keyring[id] && await CS.unwrapKey(meRawH.keyring[id], SESSION.pw)); } catch (e) {}
          if (!wrapOk) {
            try {
              meRawH.keyring = meRawH.keyring || {};
              meRawH.keyring[id] = await CS.wrapKey(key, SESSION.pw);
              saveAuth(getAuth());
              classKeysToSession();
              toast('Class key repaired on this device');
            } catch (e) {}
          }
        }
      }
      try { localStorage.setItem('spr-last-class', id); } catch (e) {}
      try { window.__SPR_OC += ' | success-tail'; } catch (e9) {}
      buildShell(); location.hash = '#/dashboard'; route();
    } catch (e) {
      CLS = null; CLS_KEY = null;
      const ok = await confirmDlg('Could not open ' + meta.name,
        'The saved copy on this device does not match this device\u2019s key.<br><br>' + (dsOn()
          ? 'Pull the newest copy from the cloud now? Your current data is kept as a safety copy.'
          : 'Restore a backup file on this screen' + (myUser() && myUser().role !== 'admin' ? ', or ask your admin for help.' : '.')),
        dsOn() ? 'Check for a newer copy' : 'Restore from a backup file');
      if (ok) {
        if (dsOn()) dsPullCheck(true);
        else { const f = document.getElementById('file-restore-all'); if (f) f.click(); }
      }
    }
  }
  function closeClass() {
    if (RESTORING) return;   /* never discard a class that is being restored right now */
    try { if (saveTimer) { clearTimeout(saveTimer); persistNow(true); } } catch (e) {}
    CLS = null; CLS_KEY = null; ui.classOpen = false;
    DB = emptyDB();
    buildShell(); location.hash = '#/classes'; route();
  }
  async function classPersistNow(silent) {
    if (!CLS || !CLS_KEY) return false;
    try { localStorage.setItem('spr-last-save-at', String(Date.now())); } catch (e0) {}
    try {
      if (SPR_STALE) { showStaleOverlay(); return false; }
      let prevTs = 0;
      try { const prev = JSON.parse(localStorage.getItem(classBlobKey(CLS.id)) || 'null'); prevTs = (prev && prev.ts) || 0; } catch (e1) {}
      if (prevTs > (CLS_TS || 0)) { showStaleOverlay(); return false; }   /* another tab saved this class newer */
      const blob = await CS.sealClass(DB, CLS_KEY);
      blob.ts = Date.now(); CLS_TS = blob.ts;
      localStorage.setItem(classBlobKey(CLS.id), JSON.stringify(blob));
      const ix = classIndex(); const m = ix.find((c) => c.id === CLS.id);
      if (m) { m.updatedAt = Date.now(); m.pendingCount = classPendingCount(); setClassIndex(ix); }
      saveOkBanner();
      flashSaved(silent);
      /* shared-database hook (later phase): a school Supabase table will
         broadcast per-score changes so co-teachers' dashboards update live.
         Today's device sync only copies the whole sealed workbook. */
      scheduleSyncPush();
      return true;
    } catch (e) {
      toast('Could not save the class workbook: storage full?', true);
      saveFailedBanner();
      clearTimeout(saveRetryTimer);
      saveRetryTimer = setTimeout(() => { saveRetryTimer = null; classPersistNow(true); }, 10000);
      return false;
    }
  }
  function classKeysToSession() {
    try {
      const out = {};
      for (const k of Object.keys(SESSION.keys || {})) out[k] = b64uFromBytes(SESSION.keys[k]);
      sessionStorage.setItem('spr-session', JSON.stringify({ user: SESSION.user, dk: b64uFromBytes(SESSION.dk), keys: out }));
    } catch (e) {}
  }


  /* ================================ charts ================================ */
  const liveCharts = [];
  function mkChart(id, cfg) {
    const el = document.getElementById(id);
    if (!el) return;
    liveCharts.push(new Chart(el.getContext('2d'), cfg));
  }
  function killCharts() { while (liveCharts.length) { try { liveCharts.pop().destroy(); } catch (e) {} } }
  function chartTheme() {
    Chart.defaults.font.family = '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = '#5b6a62';
    Chart.defaults.borderColor = 'rgba(34,49,44,0.08)';
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) Chart.defaults.animation = false;
  }
  function ds(label, data, color, extra) {
    return Object.assign({ label: label, data: data, borderColor: color, backgroundColor: color + '22',
      tension: 0.3, borderWidth: 2, pointRadius: 3, spanGaps: true }, extra || {});
  }
  function lineOpts(min, max) {
    return { responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { y: { min: min, max: max, ticks: { callback: (v) => v + '%' } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } } };
  }

  /* ============================ toast & dialogs ============================ */
  function toast(msg, err) {
    if (typeof document === 'undefined' || !document.getElementById) return;   /* window already torn down (close during an in-flight save) */
    const root = $('#toast-root'); if (!root) return;
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => t.remove(), err ? 5200 : 2600);
  }
  /* toast with a single action (e.g. Undo) — auto-dismisses */
  function toastAction(msg, label, fn, ms) {
    const root = $('#toast-root'); if (!root) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = '<span>' + U.esc(msg) + '</span> <button type="button" class="btn sm">' + U.esc(label) + '</button>';
    root.appendChild(t);
    let done = false;
    const fin = () => { if (!done) { done = true; try { t.remove(); } catch (e) {} } };
    t.querySelector('button').addEventListener('click', () => { fin(); fn(); });
    setTimeout(fin, ms || 10000);
  }
  function openDlg(html, onmount) {
    const d = $('#dlg');
    d.innerHTML = html;
    if (!d.open) d.showModal();
    if (onmount) onmount(d);
  }
  function closeDlg() {
    const d = $('#dlg');
    if (d.open) { try { d.close(); } catch (e) {} }
    d.innerHTML = '';
  }
  function confirmDlg(title, msgHtml, okLabel) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      openDlg(
        '<h3>' + U.esc(title) + '</h3><p class="small">' + msgHtml + '</p>' +
        '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button>' +
        '<button class="btn danger" data-x="1">' + U.esc(okLabel || 'Delete') + '</button></div>',
        (d) => {
          d.onclick = (e) => {
            const b = e.target.closest('[data-x]');
            /* resolve BEFORE closeDlg(): closing fires the dialog's close event,
               whose onclose would otherwise win the race and always resolve false */
            if (b) { fin(b.dataset.x === '1'); closeDlg(); }
          };
          d.onclose = () => fin(false);
        }
      );
    });
  }

  /* ============================ shell & router ============================ */
  /* simple-ui sidebar: teachers see FOUR things - Grading and Analysis stay
     reachable from the dashboard buttons. Admin adds Users + Manage & setup;
     Ranking keeps its current role rules (admin + management). */
  const NAV_T = [['dashboard', 'Dashboard'], ['students', 'Students'], ['entry', 'Enter scores'], ['reports', 'Report Cards']];
  function navList() {
    const r = classRole((currentUser() || {}).role);
    let list;
    if (r === 'admin') list = NAV_T.concat([['ranking', 'Ranking'], ['users', 'Users'], ['help', 'Help & training'], ['manage', 'Manage & setup']]);
    else if (r === 'manager') list = NAV_T.concat([['ranking', 'Ranking'], ['help', 'Help & training'], ['manage', 'Manage & setup']]);
    else list = NAV_T.concat([['help', 'Help & training'], ['manage', 'Manage & setup']]);   /* non-admin: password card + Help & training (2026-10-27, owner requests 2-3) */
    if (CLS && classPendingCount() && canDo('review')) list.splice(2, 0, ['review', 'Review (' + classPendingCount() + ')']);
    return list;
  }
  /* roles: admin (Mo) sees & controls everything; management sees Ranking too;
     teacher = the everyday markbook tools, exactly as before */
  function roleLabel(r) {
    /* display the STORED role faithfully — classRole() maps legacy 'teacher'
       to 'eal' for permissions, but the Users tab must not re-label a plain
       teacher as an EAL teacher (2026-10-24 review note) */
    const raw = String(r || '');
    const labels = { admin: 'Admin', manager: 'Manager', management: 'Manager', eal: 'EAL teacher', support: 'Supporting teacher', teacher: 'Teacher' };
    return labels[raw] || labels[classRole(raw)] || (CS && CS.roleLabel(classRole(raw))) || raw;
  }
  function isMgmt() { const r = classRole((currentUser() || {}).role); return r === 'admin' || r === 'manager'; }
  function buildShell() {
    const sem = cur();
    $('#app').innerHTML =
      '<div class="app">' +
        '<nav class="rail">' +
          '<div class="wordmark"><div class="wm-class">Student\'s Performance Report</div>' +
          '<div class="wm-sub">' + U.esc((sem && sem.school) || 'ESL') + (sem && sem.className ? ' · ' + U.esc(sem.className) : '') + '</div></div>' +
          '<div class="nav">' + navList().map((n) => '<a href="#/' + n[0] + '" data-nav="' + n[0] + '">' + n[1] + '</a>').join('') + '</div>' +
          '<div class="rail-foot">' +
          /* password self-service moved to Manage & setup (2026-10-25, owner
             request): Manage is now visible to every role; non-admins get
             the password card there only */
          (function () {   /* small class switcher - only when this account holds more than one class */
            if (sprMode() !== 'class') return '';
            const ix = CS.classesFor(myUser() || {}, classIndex());
            if (ix.length < 2) return '';
            return '<label for="classSwitch">Class</label><select id="classSwitch">' +
              ix.map((c) => '<option value="' + U.esc(c.id) + '"' + (CLS && CLS.id === c.id ? ' selected' : '') + '>' + U.esc(c.name) + '</option>').join('') + '</select>';
          })() +
          '<label for="semSelect">Semester</label>' +
            '<select id="semSelect">' + DB.semesters.map((s) => '<option value="' + U.esc(s.id) + '"' + (s.id === DB.currentSemesterId ? ' selected' : '') + '>' + U.esc(s.name) + '</option>').join('') + '</select>' +
            '<div class="saved-dot" id="savedDot"></div>' +
            '<button class="btn sm" data-action="dl-backup" style="margin:2px 0 6px" title="Download a full backup file of this class">Download backup</button>' +
            (function() { var u = currentUser(); if (!u) return '';
              var ini = (u.name || u.username).charAt(0).toUpperCase();
              return '<div class="user-chip"><span class="uc-avatar">' + U.esc(ini) + '</span>' +
                '<span class="uc-info"><b>' + U.esc(u.name || u.username) + '</b><small>' + roleLabel(u.role) + '</small></span>' +
                '<button class="uc-out" data-action="logout" title="Sign out">Sign out</button></div>'; })() +
            '<span class="conf-tag">Confidential: student data</span>' +
            '<div class="rail-privacy"><a href="#" data-action="privacy-open">Privacy &amp; data notice</a></div>' +
            '<div class="quote">Designed for teachers, by a teacher<br>— Mohammed Shehzad Khan (Teacher Mo)</div></div>' +
        '</nav>' +
        '<main class="page"><div id="content"></div></main>' +
      '</div>' +
      '';;
  }
  function syncRailMeta() {
    const sem = cur();
    const wm = $('.wm-class'); if (wm) wm.textContent = (sem && sem.className) || 'Class markbook';
    const ws = $('.wm-sub'); if (ws) ws.textContent = (sem && sem.school) || 'ESL performance tracker';
    const sel = $('#semSelect');
    if (sel) sel.innerHTML = DB.semesters.map((s) => '<option value="' + U.esc(s.id) + '"' + (s.id === DB.currentSemesterId ? ' selected' : '') + '>' + U.esc(s.name) + '</option>').join('');
  }
  function railActive(view) {
    const navId = view === 'student' ? 'students' : view;
    $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === navId));
  }
  function pageHead(title, sub, actions) {
    return '<header class="page-head"><div><h1>' + title + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
      '<div class="actions">' + (actions || '') + '</div></header>';
  }
  function route() {
    /* while the sign-in gate owns the screen, routing must do NOTHING — an
       async hashchange from an earlier redirect would otherwise closeDlg()
       the login card right after it opened */
    if (document.body.classList.contains('auth-gate')) return;
    killCharts(); closeDlg();
    /* class mode gates run BEFORE the empty-DB welcome check: a class device
       with no class open has an empty in-memory DB but must see its class list */
    if (sprMode() === 'class' && !document.body.classList.contains('auth-gate')) {
      const cv = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'dashboard';
      if (!CLS && cv !== 'classes' && cv !== 'help' && !((cv === 'users' || cv === 'manage') && classRole((currentUser() || {}).role) === 'admin')) { location.hash = '#/classes'; return; }
      if (cv === 'users') { if (classRole((currentUser() || {}).role) === 'admin') { renderUsers(); window.scrollTo(0, 0); return; } location.hash = '#/classes'; return; }
      if (cv === 'classes') { if (CLS) { closeClass(); return; } renderClasses(); railActive('classes'); window.scrollTo(0, 0); return; }
      if (cv === 'help' && !CLS) { renderHelp(); railActive('help'); window.scrollTo(0, 0); return; }   /* Help works from the chooser too (self-contained, 2026-10-27): exempted from the redirect above */
      if (cv === 'manage') {
        /* every role may open Manage now (2026-10-25): admins get the full
           setup page, non-admins get the password card (renderManage branches
           by role). With a class open the shell may have been wiped by a
           self-contained page (Users): rebuild it before writing #content. */
        if (CLS && !$('#content')) buildShell();
        renderManage(); railActive('manage'); window.scrollTo(0, 0); return;
      }
    }
    if (!$('#content')) buildShell();   /* a self-contained page (Users/classes) may have wiped the shell: every switch view needs it back */
    if (!DB.semesters.length) { renderWelcome(); return; }
    if (!cur()) DB.currentSemesterId = DB.semesters[0].id;
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    let view = parts[0] || 'dashboard';
    if (sprMode() === 'class' && !CLS) { if (view !== 'classes') { location.hash = '#/classes'; return; } renderClasses(); railActive('classes'); return; }
    if (view === 'classes') { if (CLS) { closeClass(); return; } renderClasses(); railActive('classes'); return; }
    if (view === 'ranking' && !isMgmt()) view = 'dashboard';   /* Ranking is Admin + Management only */
    if (view === 'users' && sprMode() === 'class' && classRole((currentUser() || {}).role) !== 'admin') { location.hash = '#/dashboard'; return; }   /* Users: class-mode admin-only (legacy mode has no class roles) */
    /* Manage & setup: every role (2026-10-25) - non-admins get the password card only (renderManage branches by role) */
    const navView = view;
    switch (view) {
      case 'students': renderStudents(); break;
      case 'student': renderStudent(decodeURIComponent(parts[1] || '')); break;
      case 'entry': renderEntry(parts[1] || 'sp'); break;
      case 'grading': renderGrading(); break;
      case 'analysis': ui.anMode = parts[1] === 'student' ? 'student' : 'class'; renderAnalysis(); break;
      case 'reports': ui.rptMode = parts[1] === 'student' ? 'student' : 'class'; renderReports(); break;
      case 'report': renderReportCard(decodeURIComponent(parts[1] || '')); break;
      case 'ranking': renderRanking(); break;
      case 'manage': renderManage(); break;
      case 'help': renderHelp(); break;
      case 'users': renderUsers(); break;
      case 'review': renderReview(); break;
      default: renderDashboard();
    }
    railActive(navView);
    window.scrollTo(0, 0);
  }


  /* ============================== class screens ==============================
     Class home, review queue, pending proposals, pairing, roster import,
     migration wizard, class files / share links, export & restore. */

  function classCard(c) {
    const me = myUser() || {};
    const mine = c.eal === me.username ? 'EAL teacher' : c.support === me.username ? 'Supporting teacher' : (me.role === 'manager' ? 'Read-only' : me.role === 'admin' ? 'Admin' : '');
    const pend = (c.pendingCount || 0) && (me.role === 'admin' || c.eal === me.username) ? '<span class="pend-badge">' + c.pendingCount + ' to review</span>' : '';
    const when = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '';
    return '<div class="class-card">' +
      '<div class="cc-main"><b class="cc-name">' + U.esc(c.name) + '</b>' +
      '<span class="cc-school">' + U.esc(c.school || '') + '</span>' +
      '<div class="cc-pair small">' + U.esc(c.eal || '(none yet)') + ' ↔ ' + U.esc(c.support || '(none yet)') + '</div>' +
      '<div class="small muted">' + (when ? 'updated ' + when : 'never opened') + '</div></div>' +
      '<div class="cc-side">' + (mine ? '<span class="cc-role">' + U.esc(mine) + '</span>' : '') + pend +
      '<button class="btn sm primary" data-action="class-open" data-id="' + U.esc(c.id) + '">Open</button>' +
      '</div></div>';
  }

  function renderClasses() {
    const me = myUser() || { username: '', role: 'teacher' };
    const ix = classIndex();
    const mine = CS.classesFor(me, ix);
    const admin = me.role === 'admin';
    const legacySource = admin && sprMode() === 'legacy' && DB && DB.semesters && DB.semesters.length;
    /* simple-ui: this screen is a plain chooser. Everything technical lives in
       the admin-only Advanced panel below; teachers see class name + Open. */
    $('#app').innerHTML =
      '<div class="app"><main class="page" style="max-width:980px;margin:0 auto;width:100%">' +
      /* way out + recovery - always a visible Sign out; the sync check lives
         here because a device that cannot open a class reaches nowhere else */
      '<div class="flex" style="justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        (dsOn() ? '<button class="uc-out" data-action="ds-now" style="font-size:11.5px;padding:5px 12px">Check for newer copy</button>' : '') +
        '<button class="uc-out" data-action="privacy-open" style="font-size:11.5px;padding:5px 12px">Privacy &amp; data notice</button>' +
        '<button class="uc-out" data-action="logout" style="font-size:11.5px;padding:5px 12px">Sign out</button>' +
      '</div>' +
      pageHead(mine.length > 1 ? 'Choose your class' : admin ? 'Your classes' : 'My class',
        U.esc(me.name || me.username) + ' · ' + roleLabel(me.role) +
        (me.role === 'manager' ? ': whole school, read-only' : me.role === 'support' ? ': you edit spelling, daily assignments and tests; observation changes go to your EAL partner for approval' : me.role === 'eal' ? ': you edit your class and approve observation changes from your support partner' : '')) +
      (me.role === 'manager' ? '<p class="small muted" style="margin:0 0 14px">Manager view: every class, read-only. Printing and on-screen review are open; editing stays with each class&rsquo;s teachers.</p>' : '') +
      (mine.length ? '<div class="class-grid">' + mine.map(classCard).join('') + '</div>'
        : '<div class="empty" style="padding:44px 24px"><div class="big">' + (admin ? 'No classes yet' : 'No class yet: ask your admin') + '</div>' +
          '<p class="small">' + (admin ? 'Create a class to get started.' : 'Your administrator sets up your class: it appears here the moment they do.') + '</p>' +
          (admin ? '<div class="flex" style="justify-content:center"><button class="btn primary" data-action="class-new-open">New class</button></div>' : '') +
          '</div>') +

      '<div class="quote-inline">Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)</div>' +
      '<input type="file" id="file-class" accept=".json,application/json" hidden>' +
      '<input type="file" id="file-roster" accept=".csv,text/csv" hidden>' +
      '</main></div>';
  }
  /* admin-only Advanced panel - every technical action, one plain description,
     collapsed by default; nothing here is reachable by teachers */
  function renderClassesAdvanced(ix, legacySource) {
    return '<details style="margin-top:26px;border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:10px 14px;background:rgba(127,127,127,.04)">' +
      '<summary style="cursor:pointer"><b>Advanced</b> <span class="small muted">(admin): setup, pairing and recovery tools</span></summary>' +
      '<div style="margin-top:12px">' +
        '<div class="flex" style="gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap"><button class="btn" data-action="class-import-btn">Import class file</button><span class="small muted">Add a class from a file another device exported.</span></div>' +
        '<div class="flex" style="gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap"><button class="btn" data-action="class-roster-btn">Import roster (accounts CSV)</button><span class="small muted">Create several sign-ins at once from a CSV list.</span></div>' +
        '<div class="flex" style="gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap"><button class="btn" data-action="export-all">Export everything</button><span class="small muted">Download a full safety copy of all data.</span></div>' +
        '<div class="flex" style="gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap"><button class="btn" data-action="restore-all-btn">Restore everything</button><span class="small muted">Load such a safety copy back in.</span></div>' +
      '</div>' +
      (legacySource ? '<div class="panel" style="margin:12px 0 0;border-color:#c9973b"><b>Split the single markbook into per-class workbooks</b>' +
        '<p class="small">' + DB.semesters.length + ' semester(s) still live in the old single storage. Migration gives every class its own key: a dry run and a backup come first.</p>' +
        '<button class="btn primary" data-action="class-migrate-open">Review migration…</button></div>' : '') +
      (ix.length ? '<h4 style="margin:16px 0 8px">Pairing &amp; share links</h4><table class="tbl"><tbody>' +
        ix.map((c) => '<tr><td>' + U.esc(c.name) + '</td><td>' + U.esc(c.eal || '(none yet)') + ' ↔ ' + U.esc(c.support || '(none yet)') + '</td>' +
          '<td><button class="btn sm" data-action="class-pair" data-id="' + U.esc(c.id) + '">Pair…</button> ' +
          '<button class="btn sm" data-action="class-share" data-id="' + U.esc(c.id) + '">Key &amp; link</button></td></tr>').join('') +
        '</tbody></table>' +
        '<p class="small muted" style="margin:8px 0 0">Each class is a separate encrypted workbook; only colleagues holding that class&rsquo;s key can open it: an <b>agreed-rule control between colleagues</b>, so hand keys only to your own class team.</p>' : '') +
      '<div style="margin-top:14px;border-top:1px solid rgba(127,127,127,.25);padding-top:10px">' +
        '<button class="uc-out" data-action="start-fresh" style="color:#8c3a2b;border-color:#d8b0a6">Start fresh on this device</button>' +
        '<span class="small muted" style="margin-left:8px">Wipes SPR from this browser and starts over: a backup download is offered first.</span></div>' +
      '</details>';
  }

  /* ---- support teacher proposes an observation change ---- */
  function proposeDialog(el) {
    const sem = cur();
    if (!sem) return;
    const sid = el.dataset.sid, month = el.dataset.month, key = el.dataset.key;
    const skill = key.split('-LO')[0], lo = Number(key.split('-LO')[1]);
    const curV = C.obsValue(sem, sid, month, skill, lo);
    openDlg(
      '<h3>Propose an observation change</h3>' +
      '<p class="small">Observations belong to the EAL teacher. Your proposal is queued for them: the score does not change until they approve it.</p>' +
      '<div class="flex" style="gap:10px;align-items:center;flex-wrap:wrap">' +
      '<span class="small">Current: <b>' + (curV === null ? '—' : curV) + '</b></span>' +
      '<label class="small">Proposed: <input class="inp" id="prop-val" inputmode="decimal" style="width:90px" value=""></label></div>' +
      '<div style="margin-top:8px"><textarea class="inp" id="prop-note" rows="2" style="width:100%" placeholder="Why this change? (shown to the EAL teacher)"></textarea></div>' +
      '<div class="login-err" id="prop-err" aria-live="assertive"></div>' +
      '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1">Send proposal</button></div>',
      (d) => {
        d.onclick = (e) => {
          const b = e.target.closest('[data-x]');
          if (!b) return;
          if (b.dataset.x === '0') { closeDlg(); return; }
          const v = U.num($('#prop-val').value);
          if (!C.validObs(v)) { $('#prop-err').textContent = 'Enter a score between 0 and 10.'; return; }
          const r = CS.requestChange(DB, { semId: sem.id, sid: sid, month: month, key: key, newValue: v, by: myUser().username, note: ($('#prop-note').value || '').trim() });
          if (r.error) { $('#prop-err').textContent = r.error; return; }
          closeDlg(); saveDB(true);
          toast('Proposal sent to the EAL teacher'); buildShell(); route();
        };
      });
  }

  /* ---- EAL / admin review queue ---- */
  function renderReview() {
    if (!canDo('review')) { location.hash = '#/dashboard'; return; }
    const pend = DB.pending || [];
    const rows = pend.map((p) => {
      const sem = DB.semesters.find((x) => x.id === p.semId) || {};
      const stu = (sem.students || []).find((x) => x.id === p.sid) || {};
      return '<tr><td>' + U.esc(stu.nameEn || stu.nameCn || p.sid) + '</td>' +
        '<td>' + U.esc(sem.name || p.semId) + '</td><td>' + U.esc(p.month) + '</td><td>' + U.esc(p.key) + '</td>' +
        '<td class="num"><b>' + (p.oldValue === null ? '—' : p.oldValue) + '</b> → <b class="prop-new">' + p.newValue + '</b></td>' +
        '<td>' + U.esc(p.requestedBy) + '</td><td class="small muted">' + new Date(p.time).toLocaleString() + '</td>' +
        '<td>' + (p.note ? '<span class="small">' + U.esc(p.note) + '</span>' : '<span class="muted small">—</span>') + '</td>' +
        '<td><button class="btn sm primary" data-action="review-approve" data-id="' + U.esc(p.id) + '">Approve</button> ' +
        '<button class="btn sm danger" data-action="review-reject" data-id="' + U.esc(p.id) + '">Return</button></td></tr>';
    }).join('');
    $('#content').innerHTML = pageHead('Review proposed changes', 'supporting teacher&rsquo;s observation edits apply only after you approve',
      '<button class="btn" data-action="export-xlsx">Export SPR Excel</button>') +
      (pend.length ?
        '<div class="sheet"><table class="tbl"><thead><tr><th>Student</th><th>Semester</th><th>Month</th><th>Cell</th><th>Change</th><th>By</th><th>When</th><th>Note</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="small muted">Approving applies the new score immediately and records both values in this class&rsquo;s audit log. Returning leaves the score exactly as it was: also logged.</p>'
        : '<div class="empty" style="padding:40px"><div class="big">Nothing waiting</div><p class="small">Proposed observation changes from your support partner appear here.</p></div>');
  }
  function reviewDecide(id, approve) {
    const p = (DB.pending || []).find((x) => x.id === id);
    if (!p) return;
    if (approve) {
      CS.approveChange(DB, id, { by: myUser().username });
      saveDB(true); toast('Change applied and logged'); buildShell(); route(); return;
    }
    openDlg(
      '<h3>Return this change</h3><p class="small">The score stays at <b>' + (p.oldValue === null ? '—' : p.oldValue) + '</b>. An optional reason goes to the audit log.</p>' +
      '<textarea class="inp" id="rej-note" rows="2" style="width:100%" placeholder="Reason (optional)"></textarea>' +
      '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn danger" data-x="1">Return</button></div>',
      (d) => { d.onclick = (e) => { const b = e.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === '1') { CS.rejectChange(DB, id, { by: myUser().username, reason: ($('#rej-note').value || '').trim() }); saveDB(true); toast('Returned: score unchanged'); } closeDlg(); buildShell(); route(); }; });
  }

  /* ---- audit log view ---- */
  function auditPanelHtml(wb) {
    const rows = (wb.audit || []).slice(-60).reverse().map((a) =>
      '<tr><td class="small muted">' + new Date(a.t).toLocaleString() + '</td><td>' + U.esc(a.by || '—') + '</td>' +
      '<td>' + U.esc(a.action) + '</td><td class="small">' + U.esc(a.cell || '—') + '</td>' +
      '<td>' + U.esc(a.old === null || a.old === undefined ? '—' : String(a.old)) + ' → ' + U.esc(a.new === null || a.new === undefined ? '—' : String(a.new)) + '</td>' +
      '<td class="small">' + U.esc(a.note || '') + '</td></tr>').join('');
    return '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Audit log: this class</h3>' +
      '<p class="small muted" style="margin:-6px 0 12px">Who changed what, when, and every approval decision. Newest 60 of ' + (wb.audit || []).length + ' shown here; the full log travels inside every backup and Excel export.</p>' +
      ((wb.audit || []).length ? '<div class="sheet" style="max-height:340px;overflow:auto"><table class="tbl"><thead><tr><th>When</th><th>By</th><th>Action</th><th>Cell</th><th>Value</th><th>Note</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="small muted">Nothing recorded yet.</p>') +
      '<p class="small muted" style="margin-top:8px">Honest limits: this log lives inside the class workbook. Colleagues who hold the class key follow these rules by agreement: SPR cannot cryptographically stop a key holder from rewriting history.</p>';
  }

  /* ---- admin: create a new class (in class mode) ---- */
  function classNewDialog() {
    const me = myUser() || {};
    if (me.role !== 'admin') return;
    const ealOpts = getAuth().users.filter((u) => classRole(u.role) === 'eal').map((u) => '<option value="' + U.esc(u.username) + '">' + U.esc(u.username) + '</option>').join('');
    const supOpts = getAuth().users.filter((u) => classRole(u.role) === 'support').map((u) => '<option value="' + U.esc(u.username) + '">' + U.esc(u.username) + '</option>').join('');
    openDlg(
      '<h3>New class</h3>' +
      '<div class="flex" style="gap:10px;flex-wrap:wrap"><label class="small">School <input class="inp" id="cn-school" style="width:160px" value=""></label>' +
      '<label class="small">Class name <input class="inp" id="cn-name" style="width:120px" placeholder="P4C4"></label></div>' +
      '<div class="flex" style="gap:10px;margin-top:8px;flex-wrap:wrap"><label class="small">EAL teacher <select class="inp" id="cn-eal"><option value="">(set later)</option>' + ealOpts + '</select></label>' +
      '<label class="small">Support teacher <select class="inp" id="cn-sup"><option value="">(set later)</option>' + supOpts + '</select></label></div>' +
      '<p class="small muted" style="margin-top:8px">Pairing a teacher now issues their class key with a fresh password (shown once). You can also pair later.</p>' +
      '<div class="login-err" id="cn-err"></div>' +
      '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1">Create class</button></div>',
      (d) => {
        d.onclick = async (e) => {
          const b = e.target.closest('[data-x]');
          if (!b) return;
          if (b.dataset.x === '0') { closeDlg(); return; }
          const name = ($('#cn-name').value || '').trim();
          if (!name) { $('#cn-err').textContent = 'Give the class a name.'; return; }
          if (classIndex().some((c) => c.name === name)) { $('#cn-err').textContent = 'A class with this name already exists.'; return; }
          const school = ($('#cn-school').value || '').trim() || 'School';
          const ealU = $('#cn-eal').value, supU = $('#cn-sup').value;
          closeDlg();
          await createClassWorkbook(school, name, ealU, supU);
        };
      });
  }
  async function createClassWorkbook(school, name, eal, support) {
    const cid = 'c-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) + '-' + Math.random().toString(36).slice(2, 6);
    const key = CS.genKey();
    const wb = { sprClass: 1, id: cid, name: name, school: school, eal: eal || '', support: support || '', settings: Object.assign({ autoTotal: true, spTotal: 20, daTotal: 10 }, (DB && DB.settings) || {}), currentSemesterId: null, semesters: [], pending: [], audit: [] };
    CS.logAudit(wb, { by: myUser().username, action: 'class.create', note: 'created for ' + school });
    localStorage.setItem(classBlobKey(cid), JSON.stringify(await CS.sealClass(wb, key)));
    const ix = classIndex();
    ix.push({ id: cid, name: name, school: school, eal: eal || '', support: support || '', createdAt: Date.now(), updatedAt: Date.now(), pendingCount: 0 });
    setClassIndex(ix);
    try { localStorage.setItem(MODE_KEY, 'class'); } catch (e0) {}   /* first class => class mode; the legacy blob stays untouched as an archive */
    await issueClassKeys(cid, key, [myUser().username].concat(eal ? [eal] : []).concat(support ? [support] : []));
    SESSION.keys[cid] = key; classKeysToSession();
    toast('Class ' + name + ' created');
    renderClasses();
    return cid;
  }
  /* wrap a class key for the given accounts; accounts without a known password
     get a fresh generated one (returned + shown once). The admin uses SESSION.pw. */
  async function issueClassKeys(cid, key, usernames) {
    const fresh = {};
    for (const un of usernames) {
      /* work on a FRESH auth snapshot each iteration: rotateUserPassword saves
         its own copy, and saving a stale snapshot afterwards would clobber it */
      let auth = getAuth();
      let u = auth.users.find((x) => x.username === un);
      if (!u) continue;
      if (u.keyring && u.keyring[cid]) continue;   /* already holds this class */
      let pw = un === SESSION.user ? SESSION.pw : null;
      if (!pw) {
        pw = CS.genPassword();   /* 100 bits from crypto.getRandomValues */
        const rErr = await rotateUserPassword(un, pw);   /* a REAL new password */
        if (rErr) continue;
        fresh[un] = pw;
        auth = getAuth();                                /* pick up the rotated hash */
        u = auth.users.find((x) => x.username === un);
      }
      u.keyring = u.keyring || {};
      u.keyring[cid] = await CS.wrapKey(key, pw);
      saveAuth(auth);
    }
    if (Object.keys(fresh).length) passwordsOnceDialog(fresh, 'Class key issued: new passwords (shown once)');
    return fresh;
  }
  function passwordsOnceDialog(fresh, title, onDone) {
    const rows = Object.keys(fresh).map((un) => '<tr><td>' + U.esc(un) + '</td><td><code>' + U.esc(fresh[un]) + '</code></td></tr>').join('');
    const csv = 'username,new_password\n' + Object.keys(fresh).map((un) => un + ',' + fresh[un]).join('\n');
    openDlg(
      '<h3>' + U.esc(title) + '</h3>' +
      '<p class="small">These passwords open the class key for each account. Share them privately (DingTalk / WeChat direct message): SPR cannot show them again.</p>' +
      '<div class="sheet"><table class="tbl"><thead><tr><th>Username</th><th>New password</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="dlg-actions"><button class="btn" data-dl="1">Download as CSV</button><button class="btn primary" data-x="1">Done: I saved them</button></div>',
      (d) => {
        d.onclick = (e) => {
          const dl = e.target.closest('[data-dl]');
          if (dl) {
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'SPR-new-passwords.csv';
            document.body.appendChild(a); a.click(); a.remove();
            return;
          }
          if (e.target.closest('[data-x]')) { closeDlg(); if (onDone) onDone(); }
        };
      });
  }

  /* ---- admin: pairing editor (also issues keys for newly paired teachers) ---- */
  function pairClassDialog(id) {
    const ix = classIndex(); const c = ix.find((x) => x.id === id);
    if (!c) return;
    const users = getAuth().users;
    const sel = (role, cur) => '<select class="inp" id="pair-' + role + '"><option value="">(none yet)</option>' +
      users.filter((u) => classRole(u.role) === role).map((u) => '<option value="' + U.esc(u.username) + '"' + (u.username === cur ? ' selected' : '') + '>' + U.esc(u.username) + (u.keyring && u.keyring[id] ? ' ✓key' : '') + '</option>').join('') + '</select>';
    openDlg(
      '<h3>Pair teachers: ' + U.esc(c.name) + '</h3>' +
      '<p class="small">The EAL teacher edits the class and approves observation changes; the support teacher edits spelling, daily assignments and tests. Newly paired teachers receive the class key with a fresh password (shown once).</p>' +
      '<div class="flex" style="gap:12px;flex-wrap:wrap"><label class="small">EAL ' + sel('eal', c.eal) + '</label><label class="small">Support ' + sel('support', c.support) + '</label></div>' +
      '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1">Save pairing</button></div>',
      (d) => {
        d.onclick = async (e) => {
          const b = e.target.closest('[data-x]');
          if (!b) return;
          if (b.dataset.x === '0') { closeDlg(); return; }
          const eal = $('#pair-eal').value, sup = $('#pair-support').value;
          const ix2 = classIndex(); const c2 = ix2.find((x) => x.id === id);
          const newly = [];
          if (eal && eal !== c2.eal) newly.push(eal);
          if (sup && sup !== c2.support) newly.push(sup);
          c2.eal = eal; c2.support = sup; setClassIndex(ix2);
          const key = (SESSION.keys || {})[id];
          if (key) {
            try {
              const wb = await CS.openClass(JSON.parse(localStorage.getItem(classBlobKey(id))), key);
              wb.eal = eal; wb.support = sup;
              localStorage.setItem(classBlobKey(id), JSON.stringify(await CS.sealClass(wb, key)));
            } catch (e2) {}
          }
          closeDlg();
          if (newly.length && key) await issueClassKeys(id, key, newly);
          toast('Pairing saved' + (newly.length ? ': key issued' : ''));
          renderClasses();
        };
      });
  }

  /* ---- admin: key + share link for a class (reuses the QR / DingTalk sheet) ---- */
  function classShareDialog(id) {
    const c = classIndex().find((x) => x.id === id);
    const key = (SESSION.keys || {})[id];
    if (!c || !key) { toast('No key for this class on this device', true); return; }
    const link = CS.classLink(location.origin, location.pathname, id, b64uFromBytes(key));
    openDlg(
      '<h3>Class key &amp; link: ' + U.esc(c.name) + '</h3>' +
      '<p class="small">Send this to the class&rsquo;s own teachers only. <b>Anyone holding it can open and change this class</b>: that is the agreed rule, not a technical lock. The data itself travels via Device sync or a class file; this link delivers the key.</p>' +
      '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
      '<div id="qrbox" style="background:#fff;padding:10px;border-radius:8px;border:1px solid #d8e2d8"></div>' +
      '<div style="flex:1;min-width:220px"><input class="inp" id="shareLink" readonly style="font-size:12px" value="' + U.esc(link) + '">' +
      '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn primary" data-action="share-chatmsg">Copy for DingTalk / WeChat</button>' +
      (navigator.share ? '<button class="btn" data-action="share-native">Share…</button>' : '') +
      '<button class="btn" data-action="share-copy">Copy link</button>' +
      '<button class="btn" data-action="class-export-file" data-id="' + U.esc(id) + '">Download class file</button>' +
      '<button class="btn" data-x="close">Close</button></div></div></div>',
      (d) => {
        try {
          const q = qrcode(0, 'M'); q.addData(link); q.make();
          const box = $('#qrbox'); if (box) box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2 });
        } catch (e) { const box = $('#qrbox'); if (box) box.textContent = 'QR unavailable: use the link'; }
        d.onclick = (e) => { if (e.target.closest('[data-x="close"]')) closeDlg(); };
      });
  }

  /* ---- class file export / import ---- */
  async function exportClassFile(id) {
    const c = classIndex().find((x) => x.id === id);
    const raw = localStorage.getItem(classBlobKey(id));
    if (!c || !raw) return;
    const file = CS.classFile(c, JSON.parse(raw));
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = sanitizeFn('SPR-class-' + c.name) + '.sprclass.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Class file exported: it is encrypted; the key travels via the share link');
  }
  function importClassFileGo(file) {
    const fr = new FileReader();
    fr.onload = () => {
      let f = null;
      try { f = CS.parseClassFile(JSON.parse(fr.result)); } catch (e) { toast('Not a valid SPR class file: ' + e.message, true); return; }
      const existing = classIndex().find((c) => c.id === f.id);
      openDlg(
        '<h3>Import class: ' + U.esc(f.name) + '</h3>' +
        '<p class="small">' + (existing ? 'A class with this id already exists here; importing replaces its data (a safety copy is kept first).' : 'New class on this device.') + ' The file is encrypted: paste the class share link (or its key) to open it.</p>' +
        '<input class="inp" id="cf-link" style="width:100%" placeholder="https://…#class=…&k=… or just the key">' +
        '<div class="login-err" id="cf-err"></div>' +
        '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1">Import</button></div>',
        (d) => {
          d.onclick = async (e) => {
            const b = e.target.closest('[data-x]');
            if (!b) return;
            if (b.dataset.x === '0') { closeDlg(); return; }
            const v = ($('#cf-link').value || '').trim();
            const lp = CS.parseClassHash(v) || {};
            const keyB64 = lp.k || (/^[A-Za-z0-9\-_]{40,}$/.test(v) ? v : null);
            if (!keyB64) { $('#cf-err').textContent = 'Paste the share link (or the key part after &k=).'; return; }
            let wb = null;
            try { wb = await CS.openClass(f.blob, bytesFromB64u(keyB64)); }
            catch (e2) { $('#cf-err').textContent = 'That key does not open this class file.'; return; }
            stashSafetyBackup('before importing class ' + f.name);
            const key = bytesFromB64u(keyB64);
            localStorage.setItem(classBlobKey(f.id), JSON.stringify(await CS.sealClass(wb, key)));
            const ix = classIndex().filter((c) => c.id !== f.id);
            ix.push({ id: f.id, name: f.name, school: f.school, eal: f.eal, support: f.support, createdAt: Date.now(), updatedAt: Date.now(), pendingCount: (wb.pending || []).length });
            setClassIndex(ix);
            try { localStorage.setItem(MODE_KEY, 'class'); } catch (e0) {}
            closeDlg();
            await issueClassKeys(f.id, key, [SESSION.user]);
            SESSION.keys[f.id] = key; classKeysToSession();
            toast('Class ' + f.name + ' imported'); renderClasses();
          };
        });
    };
    fr.readAsText(file);
  }

  /* ---- roster CSV import (accounts) ---- */
  function rosterImportGo(file) {
    const fr = new FileReader();
    fr.onload = () => {
      const r = CS.parseRosterCsv(fr.result);
      const preview = r.users.map((u) => '<tr><td>' + U.esc(u.username) + '</td><td>' + U.esc(u.display_name) + '</td><td>' + U.esc(CS.roleLabel(u.role)) + '</td><td>' + U.esc(u.paired_with) + '</td></tr>').join('');
      openDlg(
        '<h3>Import roster: ' + r.users.length + ' account(s)</h3>' +
        (r.errors.length ? '<div class="login-err">' + r.errors.map(U.esc).join('<br>') + '</div>' : '') +
        (r.warnings.length ? '<p class="small" style="color:#b45309">' + r.warnings.map(U.esc).join('<br>') + '</p>' : '') +
        (r.users.length ? '<div class="sheet" style="max-height:220px;overflow:auto"><table class="tbl"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Paired with</th></tr></thead><tbody>' + preview + '</tbody></table></div>' +
        '<p class="small muted">Each account gets a fresh generated password (shown once, downloadable). Class keys are issued later via Pair.</p>' : '') +
        '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1" ' + (r.users.length ? '' : 'disabled') + '>Create accounts</button></div>',
        (d) => {
          d.onclick = async (e) => {
            const b = e.target.closest('[data-x]');
            if (!b || b.dataset.x !== '1') { if (b) closeDlg(); return; }
            const fresh = {};
            for (const u of r.users) {
              const pw = CS.genPassword();   /* 100 bits from crypto.getRandomValues */
              const err = await provisionUser(u.username, pw, u.display_name || u.username, u.role);
              if (!err) fresh[u.username] = pw;
            }
            closeDlg();
            if (Object.keys(fresh).length) passwordsOnceDialog(fresh, 'Accounts created: passwords (shown once)');
            renderClasses();
          };
        });
    };
    fr.readAsText(file);
  }

  /* ---- export / restore EVERYTHING (admin) ---- */
  /* nuke this device's app state and reload to the sign-in screen. The cloud
     copy and other devices are untouched; a full backup downloads first so
     nothing can be lost even if the cloud copy were stale. */
  async function startFreshDevice() {
    const yes = await confirmDlg('Start fresh on this device',
      'This erases the app&rsquo;s data on <b>THIS DEVICE ONLY</b> &mdash; the cloud copy and your other computers are not touched. Signing in again afterwards re-downloads everything from the cloud. A backup file downloads first, just in case.',
      'Erase &amp; restart');
    if (!yes) return;
    try { exportEverything(); } catch (e) {}
    setTimeout(function () {
      try {
        const kill = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('spr-') === 0) kill.push(k); }
        kill.forEach(function (k) { localStorage.removeItem(k); });
        const kills = [];
        for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.indexOf('spr-') === 0) kills.push(k); }
        kills.forEach(function (k) { sessionStorage.removeItem(k); });
      } catch (e) {}
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { try { r.unregister(); } catch (e2) {} }); }).catch(function () {});
      }
      if (window.caches && caches.keys) {
        caches.keys().then(function (ks) { ks.forEach(function (k) { try { caches.delete(k); } catch (e2) {} }); }).catch(function () {});
      }
      setTimeout(function () { location.href = location.pathname; location.reload(); }, 400);
    }, 700);   /* give the backup download a moment to start */
  }
  async function exportEverything() {
    if (!myUser() || myUser().role !== 'admin') return;
    const ix = classIndex();
    const classes = [];
    for (const c of ix) {
      const key = (SESSION.keys || {})[c.id];
      const raw = localStorage.getItem(classBlobKey(c.id));
      if (!key || !raw) { classes.push({ id: c.id, name: c.name, error: 'key not on this device' }); continue; }
      classes.push({ meta: c, workbook: await CS.openClass(JSON.parse(raw), key) });
    }
    const out = { spr: 1, type: 'spr-export-all', at: Date.now(), by: SESSION.user, index: ix, classes: classes, credit: 'Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)' };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = sanitizeFn('SPR-everything-' + new Date().toISOString().slice(0, 10)) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Exported: the file is UNENCRYPTED; store it only in approved storage', true);
  }
  function restoreEverythingGo(file) {
    const fr = new FileReader();
    fr.onload = async () => {
      let data = null;
      try { data = JSON.parse(fr.result); } catch (e) { toast('Not a valid export file', true); return; }
      /* the pre-migration backup is the raw legacy markbook (what the migration
         wizard downloads): accept it and put the device back the way it was
         BEFORE the split, so migration can simply be run again */
      if (data && data.spr !== 1 && Array.isArray(data.semesters)) {
        try { validateDB(data); } catch (e) { toast('Not a restorable backup: ' + e.message, true); return; }
        const okGo = await confirmDlg('Restore this backup?',
          'This puts back the single markbook from before the class split (' + data.semesters.length + ' semester(s)). Class workbooks already on this device are kept untouched. After the restore you can run <b>Review migration</b> again.', 'Restore');
        if (!okGo) return;
        stashSafetyBackup('before restoring the pre-migration backup');
        try {
          DB = normalizeDB(data);
          CLS = null; CLS_KEY = null; ui.classOpen = false;
          try { localStorage.removeItem(MODE_KEY); } catch (e2) {}
          try { localStorage.removeItem('spr-last-class'); } catch (e2) {}
          const v2 = readV2() || { fmt: 2, wraps: {}, ts: Date.now() };
          v2.fmt = 2; v2.data = await sealDB(DB, SESSION.dk); v2.ts = Date.now();
          writeV2(v2);
          toast('Backup restored: your markbook is back. Review migration to split it again.');
          location.hash = '#/manage'; location.reload();
        } catch (e) { toast('Restore failed: ' + e.message + ': nothing was changed', true); }
        return;
      }
      if (!data || data.spr !== 1 || data.type !== 'spr-export-all' || !Array.isArray(data.classes)) { toast('This is not an "Export everything" file', true); return; }
      const okGo = await confirmDlg('Restore everything',
        'This replaces all class workbooks on this device with the ' + data.classes.length + ' class(es) from the file. A safety copy of the current state is kept first. Class keys are re-issued: you (admin) get keys now; teachers are re-paired afterwards.', 'Restore');
      if (!okGo) return;
      stashSafetyBackup('before restoring everything');
      for (const cls of data.classes) {
        if (!cls.workbook) continue;
        const key = CS.genKey();
        localStorage.setItem(classBlobKey(cls.workbook.id), JSON.stringify(await CS.sealClass(cls.workbook, key)));
        SESSION.keys[cls.workbook.id] = key;
        if (SESSION.pw) { const auth = getAuth(); const u = auth.users.find((x) => x.username === SESSION.user); if (u) { u.keyring = u.keyring || {}; u.keyring[cls.workbook.id] = await CS.wrapKey(key, SESSION.pw); saveAuth(auth); } }
      }
      setClassIndex(data.index.map((c) => ({ id: c.id, name: c.name, school: c.school, eal: c.eal, support: c.support, createdAt: c.createdAt || Date.now(), updatedAt: Date.now(), pendingCount: (c.pendingCount || 0) })));
      try { localStorage.setItem(MODE_KEY, 'class'); } catch (e) {}
      classKeysToSession();
      toast('Restored: re-pair teachers to issue their new keys');
      location.hash = '#/classes'; location.reload();
    };
    fr.readAsText(file);
  }

  /* ---- migration wizard (single markbook -> per-class workbooks) ---- */
  async function migrateOpen() {
    if (!myUser() || myUser().role !== 'admin') return;
    let src = DB;
    if (sprMode() === 'class') {
      const v2 = readV2();
      if (!v2 || !v2.data) { toast('No single markbook found to migrate', true); return; }
      try { src = normalizeDB(await unsealDB(v2.data, SESSION.dk)); }
      catch (e) { toast('Could not open the legacy markbook with this session', true); return; }
      if (!src.semesters || !src.semesters.length) { toast('The legacy markbook is empty', true); return; }
    } else if (!DB.semesters.length) { toast('Nothing to migrate', true); return; }
    const plan = CS.planMigration(src);
    const users = getAuth().users;
    const sel = (cid, role) => '<select class="inp" data-mig="' + U.esc(cid) + ':' + role + '"><option value="">(none yet)</option>' +
      users.filter((u) => classRole(u.role) === role).map((u) => '<option value="' + U.esc(u.username) + '">' + U.esc(u.username) + '</option>').join('') + '</select>';
    const rows = plan.classes.map((c) =>
      '<tr><td><b>' + U.esc(c.name) + '</b><div class="small muted">' + U.esc(c.school) + '</div></td>' +
      '<td>' + c.semCount + '</td><td>' + c.studentCount + '</td><td>' + c.cellCount + '</td>' +
      '<td>' + sel(c.id, 'eal') + ' ' + sel(c.id, 'support') + '</td></tr>').join('');
    openDlg(
      '<h3>Split into per-class workbooks: dry run</h3>' +
      '<p class="small">' + plan.classes.length + ' class(es) will each get their own encrypted workbook and key. Nothing changes until you press Apply: and a backup is downloaded first.</p>' +
      (plan.warnings.length ? '<p class="small" style="color:#b45309">' + plan.warnings.map(U.esc).join('<br>') + '</p>' : '') +
      '<div class="sheet" style="max-height:240px;overflow:auto"><table class="tbl"><thead><tr><th>Class</th><th>Semesters</th><th>Students</th><th>Score cells</th><th>EAL / Support</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="small muted">Teachers paired here receive their class key with a fresh password (shown once). Unpaired teachers can be paired later.</p>' +
      '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn danger" data-x="1">Download backup, then apply</button></div>',
      (d) => {
        d.onclick = async (e) => {
          const b = e.target.closest('[data-x]');
          if (!b) return;
          if (b.dataset.x === '0') { closeDlg(); return; }
          const pairings = {};
          d.querySelectorAll('[data-mig]').forEach((selEl) => {
            const parts = selEl.dataset.mig.split(':');
            if (selEl.value) { pairings[parts[0]] = pairings[parts[0]] || {}; pairings[parts[0]][parts[1]] = selEl.value; }
          });
          closeDlg();
          downloadBackup();
          await migrateApply(src, plan, pairings);
        };
      });
  }
  async function migrateApply(src, plan, pairings) {
    if (!SESSION.pw) {
      /* SESSION.pw is memory-only and dies with a reload; without it the admin's
         class-key wrap would be sealed under a RANDOM password (shown once and
         effectively unknowable). Refuse instead: one clean sign-in fixes it. */
      toast('One more sign-in is needed before migrating: sign in and start the migration again.', true);
      return;
    }
    try {
      const auth = getAuth();
      const users = auth.users.map((u) => ({ username: u.username, role: classRole(u.role) }));
      const pwMap = {};
      if (SESSION.user && SESSION.pw) pwMap[SESSION.user] = SESSION.pw;
      const res = await CS.applyMigration(src, { plan: plan, users: users, pairings: pairings, passwords: pwMap, adminUser: SESSION.user });
      for (const cid of Object.keys(res.blobs)) localStorage.setItem(classBlobKey(cid), JSON.stringify(res.blobs[cid]));
      setClassIndex(res.index);
      for (const un of Object.keys(res.keyrings)) {
        const u = auth.users.find((x) => x.username === un);
        if (u) u.keyring = Object.assign({}, u.keyring, res.keyrings[un]);
      }
      for (const u of auth.users) { const nr = classRole(u.role); if (nr !== u.role && (nr === 'manager' || nr === 'eal')) u.role = nr; }
      saveAuth(auth);
      try { localStorage.setItem(MODE_KEY, 'class'); } catch (e) {}
      SESSION.keys = Object.assign({}, SESSION.keys, await unwrapKeyring(res.keyrings[SESSION.user], SESSION.pw));
      classKeysToSession();
      toast('Migration done: every class now has its own key');
      const finish = function () { location.hash = '#/classes'; location.reload(); };
      if (Object.keys(res.newPasswords).length) passwordsOnceDialog(res.newPasswords, 'Migration issued new passwords (shown once)', finish);
      else finish();
    } catch (e) { toast('Migration failed: ' + e.message + ': nothing was changed', true); }
  }
  async function unwrapKeyring(ring, pw) {
    const out = {};
    if (!pw) return out;
    for (const cid of Object.keys(ring || {})) { try { out[cid] = await CS.unwrapKey(ring[cid], pw); } catch (e) {} }
    return out;
  }

  /* ================================ welcome ================================ */
  function renderWelcome() {
    $('#app').innerHTML =
      '<div class="app"><main class="page" style="max-width:860px;margin:0 auto;width:100%">' +
        pageHead('Student\'s Performance Report', 'Track classroom observations, spelling, daily assignments, tests and grades: with live charts, cross-semester analysis and auto-generated RAG / SWOT remarks for every student.') +
        '<div class="empty" style="padding:56px 30px">' +
          '<div class="big" style="font-family:var(--font-display);font-size:24px">Set up your first class</div>' +
          '<p>School and class details, students, then weekly scores: the app does all the averaging and grading.</p>' +
          '<div class="flex" style="justify-content:center;margin-top:18px">' +
            '<button class="btn primary" data-action="wiz-open">New class (guided setup)</button>' +
            '<button class="btn" data-action="import-xlsx">Import SPR Excel file</button>' +
            '<button class="btn" data-action="load-sample">Load sample data</button>' +
          '</div>' +
          '<p class="small muted" style="margin-top:22px">Everything stays in this browser: nothing is sent to any server unless you use Share &amp; Sync or turn on Device sync (both encrypt before upload). Offline-ready: after your first successful visit, SPR can reopen without an internet connection. Move data between computers with “Download backup”, or: as admin: let Device sync keep every system current automatically.</p>' +
          '<div class="quote-inline">Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)</div>' +
          '<div class="rail-privacy" style="margin-top:14px;text-align:center"><a href="#" data-action="privacy-open">Privacy &amp; data notice</a></div>' +
        '</div>' +
        '<input type="file" id="file-xlsx" accept=".xlsx,.xls" multiple hidden>' +
        '<input type="file" id="file-json" accept=".json" hidden>' +
      '</main></div>';
  }

  /* =============================== dashboard =============================== */
  function kpi(num, label, warn) {
    return '<div class="kpi' + (warn ? ' warn' : '') + '"><div class="k-num">' + num + '</div><div class="k-label">' + label + '</div></div>';
  }
  function compKpi(label, frac) {
    const p = Math.round(frac * 100);
    const col = frac >= 0.85 ? '#1d7a4a' : frac >= 0.5 ? '#c9973b' : '#c4453c';
    return '<div class="kpi"><div class="k-num">' + p + '<small>%</small></div><div class="k-label">' + label + ' recorded</div>' +
      '<div class="comp-bar"><i style="width:' + Math.min(p, 100) + '%;background:' + col + '"></i></div></div>';
  }
  /* ========================= dashboard (Brief-2 redesign) ========================= */
  const ACT_TXT = {
    'Listening': 'Practise two-step instructions with short listening games.',
    'Speaking': 'Use daily talking prompts and partner practice.',
    'Writing': 'Run a small guided-writing group with one punctuation target each week.',
    'Reading': 'Guided re-reading of short texts in a small group.',
    'Spelling': 'Reteach common vowel patterns in a small group with short weekly checks.',
    'Daily Assignments': 'Set a short daily checklist and review it together each week.',
    'Mid-Term': 'Guided revision of this term\u2019s topics.',
    'Oral': 'Regular paired speaking practice with sentence starters.',
    'Written': 'Model short planning before written tasks.',
  };
  function worstEvidence(sem, sid) {
    const g = C.gradeStudent(sem, sid);
    let worst = null;
    for (const k of A.COMPONENTS) {
      const v = g.parts[k];
      const ev = A.componentEvents(sem, sid, k);
      if (v !== null && v < 55 && ev >= 1 && (!worst || v < worst.v)) worst = { k: k, v: v, ev: ev };
    }
    return worst;
  }
  function dashFilterStudents(sem) {
    const f = ui.dash;
    return sem.students.filter((s) => {
      const g = C.gradeStudent(sem, s.id);
      const n = nOf9(g);
      if (f.ev === 'complete' && n < 9) return false;
      if (f.ev === 'provisional' && (n < C.FINAL_MIN_ASSESSED || n >= 9)) return false;
      if (f.ev === 'notyet' && n >= C.FINAL_MIN_ASSESSED) return false;
      if (f.skill !== 'all' && g.parts[f.skill] === null) return false;
      if (f.rag !== 'all') {
        if (!gateOk(g)) return false;
        if (A.rag(g.final) !== f.rag) return false;
      }
      if (f.q) {
        const q = f.q.trim().toLowerCase();
        if (!((s.nameEn + ' ' + s.nameCn + ' ' + s.id).toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }
  function priorityRow(sem, sid) {
    const g = C.gradeStudent(sem, sid);
    const fs = A.finalStatus(sem, sid);
    const stu = sem.students.find((x) => x.id === sid);
    const w = worstEvidence(sem, sid);
    const status = fs.ragStatus === 'R' ? 'Priority support' : fs.ragStatus === 'A' ? 'Developing' : 'Review evidence';
    const src = w ? A.SHORT[w.k] + ': ' + fmt(w.v, 0) + '% across ' + w.ev + ' recorded ' + (w.ev === 1 ? 'task' : 'tasks') : 'final ' + fmt(g.final, 1) + '%';
    const act = w ? ACT_TXT[w.k] : 'Review this record with fresh assessment data.';
    return '<tr><td><a class="stu-link" href="#/student/' + U.esc(sid) + '">' + U.esc((stu && (stu.nameEn || stu.nameCn)) || sid) + '</a></td>' +
      '<td><span class="rag-chip ' + (fs.ragStatus || 'R') + '"><span class="dotrag ' + (fs.ragStatus || 'R') + '"></span>' + status + '</span></td>' +
      '<td class="small">' + U.esc(src) + '</td>' +
      '<td class="small">' + U.esc(act) + '</td></tr>';
  }
  function dashEvidenceRows(sem) {
    const list = dashFilterStudents(sem);
    if (!list.length) return '<tr><td colspan="4" class="muted">No students match the current filters.</td></tr>';
    return list.map((s) => {
      const g = C.gradeStudent(sem, s.id);
      const c = C.getAssessmentCompleteness(sem, s.id);
      const status = c.gate === 'final' ? '<span class="g g-A*">Complete</span>'
        : c.gate === 'provisional' ? '<span class="g prov">' + c.assessedComponentCount + '/9 · provisional</span>'
        : '<span class="g g-none">Not yet assessed</span>';
      return '<tr><td><a class="stu-link" href="#/student/' + U.esc(s.id) + '">' + U.esc(s.nameEn || s.nameCn) + '</a> <span class="muted small">' + U.esc(s.nameCn || '') + '</span></td>' +
        '<td>' + status + '</td>' +
        '<td class="small">' + (c.missingComponentNames.length ? U.esc(c.missingComponentNames.map((k) => A.SHORT[k]).join(', ')) : '<span class="muted">—</span>') + '</td>' +
        '<td class="small muted">' + c.assessedComponentCount + '/9</td></tr>';
    }).join('');
  }
  function moverLabel(d) { return d > 3 ? 'Improving' : d < -3 ? 'Review' : 'Stable'; }

  /* ---- quarantined invalid scores (P1.1: never deleted, moved to review) ---- */
  function reviewItems() {
    const out = [];
    for (const sem of DB.semesters || []) {
      for (const r of sem.review || []) out.push({ semId: sem.id, semName: sem.name, item: r });
    }
    return out;
  }
  function reviewPanelHtml() {
    const items = reviewItems();
    if (!items.length) return '';
    const AREA = { obs: 'Observation', spelling: 'Spelling', daily: 'Daily', test: 'Test' };
    const rows = items.map((x, i) =>
      '<tr><td>' + U.esc(x.semName) + '</td><td>' + U.esc(AREA[x.item.area] || x.item.area) + '</td>' +
      '<td>' + U.esc(x.item.sid) + (x.item.month ? ' · ' + U.esc(x.item.month) : '') + '</td>' +
      '<td>' + U.esc(x.item.key) + '</td><td><b>' + U.esc(String(x.item.value)) + '</b></td>' +
      '<td class="small muted">' + U.esc(x.item.reason) + '</td>' +
      '<td><button class="btn sm" data-action="review-goto" data-sem="' + U.esc(x.semId) + '">Go</button> ' +
      '<button class="btn sm danger" data-action="review-discard" data-sem="' + U.esc(x.semId) + '" data-i="' + items.indexOf(x) + '">Discard</button></td></tr>').join('');
    return '<div class="panel" style="margin-top:10px;border-color:#c9973b"><b>' + items.length + ' quarantined score' + (items.length > 1 ? 's' : '') + '</b>' +
      '<p class="small" style="margin:6px 0 8px">These values were out of range (negative, above the total, or an observation over 10), so they are <b>not counted in any grade</b>. They were moved here: not deleted: when the data was loaded. Fix the cell on its entry screen, or discard the value once you have checked it.</p>' +
      '<div class="sheet" style="max-height:240px;overflow:auto"><table class="tbl"><thead><tr><th>Semester</th><th>Area</th><th>Student · month</th><th>Cell</th><th>Value</th><th>Why</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function renderDashboard() {
    const sem = cur();
    if (!DB.semesters.length) { renderWelcome(); return; }
    const gAll = C.gradeAll(sem);
    const rvN = reviewItems().length;
    const dist = C.gradeDistribution(sem);
    const risk = C.atRisk(sem);
    const tp = A.classTeachingPriorities(sem);
    const mv = A.movers(DB);
    const nComplete = gAll.filter(gateFinal).length;
    const nProv = gAll.filter((g) => gateOk(g) && !gateFinal(g)).length;
    const nNotYet = gAll.filter((g) => !gateOk(g)).length;
    const f = ui.dash || (ui.dash = { view: 'overview', ev: 'all', skill: 'all', rag: 'all', q: '' });
    const now = new Date();
    const monthName = U.MONTHS[now.getMonth()];
    const inTerm = sem.months.includes(monthName);

    const tabs = ['Overview', 'overview', 'Assessment evidence', 'evidence', 'Teaching priorities', 'teaching', 'Advanced analysis', 'advanced'];
    let tabHtml = '<div class="tabs no-print">';
    for (let i = 0; i < tabs.length; i += 2) {
      tabHtml += '<a class="tab' + (f.view === tabs[i + 1] ? ' on' : '') + '" href="#" data-action="dash-view" data-view="' + tabs[i + 1] + '">' + tabs[i] + '</a>';
    }
    tabHtml += '</div>';
    const filterBar = '<div class="sheet-toolbar no-print"><div class="flex" style="flex-wrap:wrap;gap:10px;align-items:center">' +
      '<label>Evidence <select class="inp" id="dashEv"><option value="all">All pupils</option><option value="complete"' + (f.ev === 'complete' ? ' selected' : '') + '>Complete evidence</option><option value="provisional"' + (f.ev === 'provisional' ? ' selected' : '') + '>Provisional evidence</option><option value="notyet"' + (f.ev === 'notyet' ? ' selected' : '') + '>Not yet assessed</option></select></label>' +
      '<label>Skill <select class="inp" id="dashSkill"><option value="all">All skills</option>' + A.COMPONENTS.map((k) => '<option value="' + U.esc(k) + '"' + (f.skill === k ? ' selected' : '') + '>' + U.esc(A.SHORT[k]) + '</option>').join('') + '</select></label>' +
      '<label>Status (teachers) <select class="inp" id="dashRag"><option value="all">All statuses</option><option value="G"' + (f.rag === 'G' ? ' selected' : '') + '>Secure / on track</option><option value="A"' + (f.rag === 'A' ? ' selected' : '') + '>Developing</option><option value="R"' + (f.rag === 'R' ? ' selected' : '') + '>Priority support</option></select></label>' +
      '<label>Search <input class="inp" id="dashSearch" placeholder="Name or ID\u2026" value="' + U.esc(f.q) + '"></label>' +
      '</div></div>';

    let body = '';
    if (f.view === 'overview') {
      body =
        '<div class="grid-2">' +
          '<div class="panel"><h3>Assessment evidence</h3><div class="panel-sub">how complete are the records behind every grade?</div>' +
            '<table class="tbl"><tbody>' +
              '<tr><td>Fully assessed students</td><td class="num"><b>' + nComplete + '</b></td></tr>' +
              '<tr><td>Provisional students</td><td class="num"><b>' + nProv + '</b></td></tr>' +
              '<tr><td>Not yet assessed students</td><td class="num"><b>' + nNotYet + '</b></td></tr>' +
            '</tbody></table>' +
            '<div class="mt"><button class="btn" data-action="dash-view" data-view="evidence">View incomplete records</button></div>' +
            '<p class="small muted" style="margin-top:8px">Missing data is never treated as low achievement: grades appear at 6 of 9 assessed components.</p>' +
          '</div>' +
          '<div class="panel"><h3>Class skill overview</h3><div class="panel-sub">valid class averages · number of assessed pupils</div>' +
            '<div class="chart-box" style="height:' + Math.max(200, A.COMPONENTS.length * 28) + 'px"><canvas id="ch-skills" role="img" aria-label="Horizontal bar chart of class averages per skill with assessed pupil counts"></canvas></div>' +
            '<table class="tbl mt" aria-label="Class skill overview data"><thead><tr><th scope="col">Skill</th><th scope="col" class="num">Average</th><th scope="col" class="num">Assessed</th></tr></thead><tbody id="skillTbl"></tbody></table>' +
          '</div>' +
        '</div>' +
        '<div class="panel mt"><h3>Priority support</h3><div class="panel-sub">only students with sufficient evidence · specific source · suggested action</div>' +
          '<table class="tbl"><thead><tr><th scope="col">Student</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Suggested action</th></tr></thead><tbody>' +
          (risk.length ? risk.slice(0, 6).map((r) => priorityRow(sem, r.sid)).join('')
            : '<tr><td colspan="4" class="muted">No one needs focused support right now.</td></tr>') +
          '</tbody></table></div>' +
        '<div class="panel mt"><h3>Recent progress / review</h3><div class="panel-sub">' +
          (mv && mv.list.length ? 'comparable weighted finals: ' + U.esc(mv.from) + ' \u2192 ' + U.esc(mv.to) : 'progress appears when two semesters have comparable records') + '</div>' +
          (mv && mv.list.length
            ? '<table class="tbl"><thead><tr><th scope="col">Student</th><th scope="col">Trend</th><th scope="col">Evidence</th></tr></thead><tbody>' +
              mv.list.slice(0, 8).map((m) => '<tr><td>' + U.esc(m.name) + '</td><td>' + moverLabel(m.delta) + '</td><td class="small">' +
                (m.delta >= 0 ? '+' : '') + A.f1(m.delta) + ' points across weighted finals</td></tr>').join('') + '</tbody></table>' +
              '<p class="small muted" style="margin-top:6px">Scores are from different assessment types; review with caution.</p>'
            : '<p class="muted small" style="padding:10px 2px">Not enough comparable evidence yet for progress conclusions.</p>') +
        '</div>';
    } else if (f.view === 'evidence') {
      body = '<div class="panel"><h3>Assessment evidence</h3><div class="panel-sub">how complete each record is, with filters</div>' +
        '<table class="tbl"><thead><tr><th scope="col">Student</th><th scope="col">Status</th><th scope="col">Missing components</th><th scope="col" class="num">Assessed</th></tr></thead>' +
        '<tbody id="dashEvBody">' + dashEvidenceRows(sem) + '</tbody></table></div>';
    } else if (f.view === 'teaching') {
      body = '<div class="panel"><h3>Whole-class teaching priorities</h3>' +
        '<div class="panel-sub">lowest valid averages first · needs ' + A.MIN_CLASS_N + '+ assessed pupils per component</div>' +
        '<div class="remark-box">' + U.esc(tp.text) + '</div>' +
        '<table class="tbl mt" aria-label="Class component averages"><thead><tr><th scope="col">Skill</th><th scope="col" class="num">Average</th><th scope="col" class="num">Assessed pupils</th><th scope="col">Evidence</th></tr></thead><tbody>' +
        tp.list.map((r) => '<tr><td>' + U.esc(r.k) + '</td><td class="num">' + (r.avg === null ? '—' : A.f1(r.avg) + '%') + '</td><td class="num">' + r.n + '</td>' +
          '<td class="small">' + (r.n >= A.MIN_CLASS_N ? 'sufficient for a class conclusion' : 'Insufficient evidence') + '</td></tr>').join('') +
        '</tbody></table></div>' +
        '<div class="panel mt"><h3>Students needing focused support</h3><div class="panel-sub">evidence + suggested action for every entry</div>' +
        '<table class="tbl"><thead><tr><th scope="col">Student</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Suggested action</th></tr></thead><tbody>' +
        (risk.length ? risk.map((r) => priorityRow(sem, r.sid)).join('') : '<tr><td colspan="4" class="muted">No one needs focused support right now.</td></tr>') +
        '</tbody></table></div>';
    } else { /* advanced */
      const scat = ui.scat || (ui.scat = 'delta');
      body = '<div class="panel"><h3>Advanced analysis</h3><div class="panel-sub">This view helps identify patterns for teacher review. It does not measure ability and should not be used alone to make decisions about a pupil.</div>' +
        '<div class="flex mt" style="align-items:center;gap:10px"><label>Scatter view <select class="inp" id="scatMode">' +
          '<option value="delta"' + (scat === 'delta' ? ' selected' : '') + '>Current score vs progress change</option>' +
          '<option value="comp"' + (scat === 'comp' ? ' selected' : '') + '>Score vs assessment completeness</option>' +
          '<option value="spwr"' + (scat === 'spwr' ? ' selected' : '') + '>Spelling vs writing</option>' +
        '</select></label></div>' +
        '<div class="chart-box mt" style="height:320px"><canvas id="ch-scatter" role="img" aria-label="Scatter plot for teacher review"></canvas></div>' +
        '<table class="tbl mt" id="scatTbl" aria-label="Scatter data table"></table>' +
        '<p class="small muted" style="margin-top:6px">Patterns here are for investigation, not judgement: no causal claims.</p></div>' +
        '<div class="grid-2 mt">' +
          '<div class="panel"><h3>Class average by month</h3><div class="panel-sub">observations (monthly) \u00b7 spelling \u00b7 daily assignments (weekly)</div>' +
            '<div class="chart-box" style="height:250px"><canvas id="ch-trend" role="img" aria-label="Class average by month line chart"></canvas></div></div>' +
          '<div class="panel"><h3>Final grade distribution</h3><div class="panel-sub">weighted final score per student</div>' +
            '<div class="chart-box" style="height:250px"><canvas id="ch-dist" role="img" aria-label="Final grade distribution bar chart"></canvas></div></div>' +
        '</div>' +
        '<div class="panel mt"><h3>Final score by student</h3><div class="panel-sub">sorted high to low \u2014 only students with sufficient evidence</div>' +
          '<div class="chart-box" style="height:' + Math.max(220, Math.min(gAll.filter(gateOk).length, 30) * 20) + 'px"><canvas id="ch-byStu" role="img" aria-label="Final score by student bar chart"></canvas></div></div>';
    }

    let upd = '';
    try {
      const at = Number(localStorage.getItem('spr-last-save-at') || 0);
      if (at) {
        const d = new Date(at), mins = Math.round((Date.now() - at) / 60000);
        upd = ' \u00b7 Updated ' + (mins < 1 ? 'just now' : ('at ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')));
      }
    } catch (e0) {}
    $('#content').innerHTML = pageHead('Class dashboard', U.esc(sem.name) + ' \u00b7 ' + sem.students.length + ' students' + upd,
      '<a class="btn primary no-print" href="#/entry/sp">Enter scores</a>' +
      '<a class="btn no-print" href="#/grading">Grading</a>' +
      '<a class="btn no-print" href="#/analysis/class">Analysis</a>' +
      '<button class="btn no-print" data-action="export-xlsx">Export SPR Excel</button>') +

      '<section class="cover">' +
        '<div class="cover-main">' +
          '<div class="cover-school">' + U.esc(sem.school) + '</div>' +
          '<div class="cover-line"><b>' + U.esc(sem.className || 'Class') + '</b> \u00b7 ' + U.esc(sem.name) +
            (sem.months.length ? ' \u00b7 ' + U.esc(U.MONTH_ABBR[sem.months[0]] || sem.months[0]) + '\u2013' + U.esc(U.MONTH_ABBR[sem.months[sem.months.length - 1]] || sem.months[sem.months.length - 1]) : '') + '</div>' +
          '<div class="cover-teachers">Teachers: <b>' + (sem.teachers.length ? U.esc(sem.teachers.join(' \u00b7 ')) : '\u2013') + '</b>' +
            ' \u00b7 complete <b>' + nComplete + '</b> \u00b7 provisional <b>' + nProv + '</b> \u00b7 not yet assessed <b>' + nNotYet + '</b></div>' +
        '</div>' +
        '<div class="cover-date">' +
          '<div class="cover-month">' + monthName + ' ' + now.getFullYear() + '</div>' +
          '<div class="cover-ym">today</div>' +
          (inTerm ? '<span class="in-term">current month of the term</span>' : '') +
        '</div>' +
      '</section>' +
      (rvN ? '<div class="panel no-print" style="margin:0 0 14px;border-color:#c9973b"><b>' + rvN + ' quarantined score' + (rvN > 1 ? 's' : '') + '</b>: not counted in any grade. <button class="btn sm" data-action="dash-review-goto">Review them</button></div>' : '') +
      tabHtml + filterBar + body;

    /* ---- charts & data tables ---- */
    if (f.view === 'overview' || f.view === 'teaching') {
      const stats = A.COMPONENTS.map((k) => ({ k: k, st: A.classComponentStats(sem, k) }));
      const tbl = $('#skillTbl');
      if (tbl) tbl.innerHTML = stats.map((r) => '<tr><td>' + U.esc(r.k) + '</td><td class="num">' +
        (r.st.avg === null ? '—' : A.f1(r.st.avg) + '%') + '</td><td class="num">' + r.st.n + '</td></tr>').join('');
      if (f.view === 'overview' && document.getElementById('ch-skills')) {
        const ok = stats.filter((r) => r.st.n >= A.MIN_CLASS_N && r.st.avg !== null);
        mkChart('ch-skills', { type: 'bar',
          data: { labels: ok.map((r) => A.SHORT[r.k] + ' \u00b7 ' + r.st.n + ' assessed'),
            datasets: [{ data: ok.map((r) => r1x(r.st.avg)), backgroundColor: '#4a7c6b', borderRadius: 3 }] },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.x + '% \u00b7 ' + ok[c.dataIndex].st.n + ' assessed' } } } } });
        if (!ok.length) { const box = document.getElementById('ch-skills').closest('.chart-box'); if (box) box.innerHTML = '<p class="muted small" style="padding:18px 8px">Not enough evidence for a class conclusion (needs ' + A.MIN_CLASS_N + '+ assessed pupils per component).</p>'; }
      }
    }
    if (f.view === 'advanced') {
      const labels = sem.months.map((m) => U.MONTH_ABBR[m] || m);
      mkChart('ch-trend', { type: 'line',
        data: { labels: labels, datasets: [
          ds('Observations', sem.months.map((m) => r1x(C.classMonthPct(sem, 'obs', m))), COLORS.obs),
          ds('Spelling', sem.months.map((m) => r1x(C.classMonthPct(sem, 'spelling', m))), COLORS.sp),
          ds('Daily assignments', sem.months.map((m) => r1x(C.classMonthPct(sem, 'daily', m))), COLORS.da),
        ] }, options: lineOpts(0, 100) });
      const gl = ['A*', 'A', 'B', 'C', 'D', 'U'];
      mkChart('ch-dist', { type: 'bar',
        data: { labels: gl, datasets: [{ data: gl.map((l) => dist[l]), backgroundColor: gl.map((l) => GRADE_HEX[l]), borderRadius: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { display: false } } } });
      const sorted = gAll.filter(gateOk).sort((a, b) => a.final - b.final);
      const sids = sorted.map((g) => g.sid);
      if (!sorted.length && document.getElementById('ch-byStu')) {
        const box = document.getElementById('ch-byStu').closest('.chart-box');
        if (box) box.innerHTML = '<p class="muted small" style="padding:18px 8px">Not enough assessed work yet: finals appear when students have 6 of 9 components assessed.</p>';
      }
      mkChart('ch-byStu', { type: 'bar',
        data: { labels: sorted.map((g) => { const st = sem.students.find((x) => x.id === g.sid); return (st && st.nameEn) || (st && st.nameCn) || g.sid; }),
          datasets: [{ data: sorted.map((g) => r1x(g.final)),
            backgroundColor: sorted.map((g) => GRADE_HEX[g.letter] || '#9aa0a0'), borderRadius: 3 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.x + '%' } } },
          onClick: (e, els) => { if (els.length) location.hash = '#/student/' + sids[els[0].index]; },
          onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } } });
      /* scatter (teacher-only) */
      const mode = ui.scat || 'delta';
      let pts = [], xT = 'Current weighted final (%)', yT = '';
      if (mode === 'delta') {
        yT = 'Change since previous comparable semester (points)';
        if (mv) pts = mv.list.map((m) => ({ x: m.final, y: r1x(m.delta), n: m.name }));
      } else if (mode === 'comp') {
        xT = 'Components assessed (of 9)'; yT = 'Current weighted final (%)';
        pts = gAll.filter(gateOk).map((g) => { const st = sem.students.find((x) => x.id === g.sid); return { x: nOf9(g), y: r1x(g.final), n: (st && (st.nameEn || st.nameCn)) || g.sid }; });
      } else {
        xT = 'Spelling (%)'; yT = 'Writing (%)';
        pts = gAll.map((g) => { const st = sem.students.find((x) => x.id === g.sid); return { x: r1x(g.parts.Spelling), y: r1x(g.parts.Writing), n: (st && (st.nameEn || st.nameCn)) || g.sid }; })
          .filter((q) => q.x !== null && q.y !== null);
      }
      mkChart('ch-scatter', { type: 'scatter',
        data: { datasets: [{ data: pts.map((q) => ({ x: q.x, y: q.y })), backgroundColor: '#2d5fa8', pointRadius: 5, pointHoverRadius: 7 }] },
        options: { responsive: true, maintainAspectRatio: false,
          scales: { x: { title: { display: true, text: xT } }, y: { title: { display: true, text: yT } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => pts[c.dataIndex].n + ': ' + c.parsed.x + ' / ' + c.parsed.y } } } } });
      const stbl = $('#scatTbl');
      if (stbl) stbl.innerHTML = '<thead><tr><th scope="col">Student</th><th scope="col" class="num">' + U.esc(xT) + '</th><th scope="col" class="num">' + U.esc(yT) + '</th></tr></thead><tbody>' +
        (pts.length ? pts.map((q) => '<tr><td>' + U.esc(q.n) + '</td><td class="num">' + q.x + '</td><td class="num">' + q.y + '</td></tr>').join('') : '<tr><td colspan="3" class="muted">Not enough paired evidence yet.</td></tr>') + '</tbody>';
    }
  }

  /* ================================ students ================================ */

  function avatarChar(s) { const n = (s.nameCn || s.nameEn || '?').trim(); return n.charAt(0).toUpperCase(); }
  function weeklyCombined(sem, sid) {
    const out = [];
    for (const m of sem.months) for (let w = 1; w <= 5; w++) {
      const vals = [];
      for (const met of ['spelling', 'daily']) {
        const e = sem[met][sid] && sem[met][sid][m] && sem[met][sid][m][w];
        if (e && e.s !== null && e.t > 0) vals.push((e.s / e.t) * 100);
      }
      if (vals.length) out.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    return out;
  }
  function spark(sem, sid) {
    const pts = weeklyCombined(sem, sid);
    if (pts.length < 2) return '';
    const w = 64, h = 20, pad = 2;
    const xy = pts.map((v, i) => [pad + (w - 2 * pad) * (i / (pts.length - 1)), h - pad - (h - 2 * pad) * Math.max(0, Math.min(100, v)) / 100]);
    return '<svg class="s-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline fill="none" stroke="#2d5fa8" stroke-width="1.5" points="' +
      xy.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/></svg>';
  }
  function stuCards(sem) {
    const q = ui.q.trim().toLowerCase();
    const list = sem.students.filter((s) => !q || (s.nameEn + ' ' + s.nameCn + ' ' + s.id).toLowerCase().includes(q));
    if (!list.length) return '<div class="empty" style="grid-column:1/-1"><div class="big">' +
      (sem.students.length ? 'No students match your search.' : 'No students yet: add them below.') + '</div></div>';
    return list.map((s) => {
      const g = C.gradeStudent(sem, s.id);
      return '<a class="stu-card" href="#/student/' + U.esc(s.id) + '">' +
        '<div class="avatar">' + U.esc(avatarChar(s)) + '</div>' +
        '<div style="min-width:0;padding-right:56px"><div class="s-name">' + U.esc(s.nameEn || s.nameCn) + '</div>' +
        '<div class="s-meta">' + U.esc(s.nameCn || '') + (s.nameCn ? ' · ' : '') + U.esc(s.id) + '</div></div>' +
        gradeCell(g) + spark(sem, s.id) + '</a>';
    }).join('');
  }
  function renderStudents() {
    const sem = cur();
    const canEdit = canDo('edit.roster');
    $('#content').innerHTML = pageHead('Students', 'click a student for the full performance profile',
      '<input class="inp" id="stuSearch" placeholder="Search name or ID…" value="' + U.esc(ui.q) + '">') +
      '<div class="stu-grid" id="stuList">' + stuCards(sem) + '</div>' +
      /* roster editing lives HERE since 2026-10-25 (owner request) — teachers
         manage their class list on the Students tab, not in Manage & setup.
         Who may edit follows the class permission matrix (edit.roster:
         admin + this class's EAL teacher); support sees the read-only note. */
      (canEdit ?
        '<h3 style="font-family:var(--font-display);margin:26px 0 12px">Add or edit students</h3>' +
        '<div class="sheet" style="max-height:420px;overflow:auto"><table class="tbl"><tbody>' +
        sem.students.map((s, i) => '<tr><td>' + (i + 1) + '</td>' +
          '<td><input class="inp" style="width:120px" data-stufield="id" data-sid="' + U.esc(s.id) + '" value="' + U.esc(s.id) + '"></td>' +
          '<td><input class="inp" style="width:100px" data-stufield="nameCn" data-sid="' + U.esc(s.id) + '" value="' + U.esc(s.nameCn) + '"></td>' +
          '<td><input class="inp" style="width:120px" data-stufield="nameEn" data-sid="' + U.esc(s.id) + '" value="' + U.esc(s.nameEn) + '"></td>' +
          '<td><select class="inp" data-stufield="gender" data-sid="' + U.esc(s.id) + '">' +
            ['M', 'F', ''].map((g) => '<option value="' + g + '"' + (s.gender === g ? ' selected' : '') + '>' + (g || '–') + '</option>').join('') + '</select></td>' +
          '<td><button class="btn sm danger" data-action="stu-del" data-sid="' + U.esc(s.id) + '">Remove</button></td></tr>').join('') +
        '</tbody></table></div>' +
        '<div class="flex mt">' +
          '<input class="inp" id="ro-id" placeholder="ID (auto)" style="width:120px">' +
          '<input class="inp" id="ro-cn" placeholder="Chinese name" style="width:110px">' +
          '<input class="inp" id="ro-en" placeholder="English name" style="width:130px">' +
          '<select class="inp" id="ro-g"><option>M</option><option>F</option></select>' +
          '<button class="btn primary" data-action="roster-add">Add student</button>' +
        '</div>' +
        '<details class="mt"><summary class="small" style="cursor:pointer;color:#2d5fa8">Paste many students</summary>' +
          '<textarea id="ro-paste" class="inp" rows="4" style="width:100%;max-width:640px;margin-top:8px" placeholder="One per line: ID, Chinese name, English name, Gender&#10;STU-001, 王小明, Demo, F"></textarea>' +
          '<div class="mt"><button class="btn" data-action="roster-paste">Add list</button></div></details>'
      : '<p class="small muted" style="margin-top:20px">Read-only: students of this class are managed by its EAL teacher.</p>');
  }

  /* ============================= student profile ============================= */
  function weekLabelList(sem) {
    const out = [];
    for (const m of sem.months) for (let w = 1; w <= 5; w++) {
      let has = false;
      for (const met of ['spelling', 'daily']) for (const s of sem.students) {
        const e = sem[met][s.id] && sem[met][s.id][m] && sem[met][s.id][m][w];
        if (e && (e.s !== null || e.t !== null)) has = true;
      }
      if (has) out.push({ m: m, w: w, label: (U.MONTH_ABBR[m] || m) + ' W' + w });
    }
    return out;
  }
  function studentWeekPct(sem, sid, met, m, w) {
    const e = sem[met][sid] && sem[met][sid][m] && sem[met][sid][m][w];
    return e && e.s !== null && e.t > 0 ? (e.s / e.t) * 100 : null;
  }
  function classWeekPct(sem, met, m, w) {
    let s = 0, t = 0;
    for (const stu of sem.students) {
      const e = sem[met][stu.id] && sem[met][stu.id][m] && sem[met][stu.id][m][w];
      if (e && e.s !== null && e.t > 0) { s += e.s; t += e.t; }
    }
    return t > 0 ? (s / t) * 100 : null;
  }
  function semChips(sid, sem) {
    const chips = DB.semesters.filter((s) => s.students.some((x) => x.id === sid)).map((s) => {
      const gg = C.gradeStudent(s, sid);
      return '<button class="month-pill' + (s.id === sem.id ? ' on' : '') + '" data-action="jump-sem" data-semid="' + U.esc(s.id) + '">' +
        U.esc(s.name) + ' · ' + (gateOk(gg) ? fmt(gg.final, 1) : nOf9(gg) + '/9') + '</button>';
    }).join('');
    return chips ? '<div class="month-pills" style="margin-top:8px">' + chips + '</div>' : '';
  }
  function contribTable(g) {
    const rows = Object.keys(g.parts).map((k) => {
      const p = g.parts[k], w = k === 'Written' ? 20 : 10;
      return '<tr><td>' + k + '</td><td class="num">' + fmt(p, 1) + '%</td><td class="c">' + gBadge(p === null ? null : C.letter(p)) + '</td>' +
        '<td class="num">' + w + '%</td><td class="num">' + (p === null ? '–' : fmt((p * w) / 100, 2)) + '</td></tr>';
    }).join('');
    const ok = gateOk(g), full = gateFinal(g);
    return '<table class="tbl"><thead><tr><th>Component</th><th class="num">Score</th><th class="c">Grade</th><th class="num">Weight</th><th class="num">Contribution</th></tr></thead><tbody>' + rows +
      (ok
        ? '<tr><td><b>Final' + (full ? '' : ' <span class="small muted">(provisional, ' + nOf9(g) + '/9)</span>') + '</b></td><td class="num"><b>' + fmt(g.final, 1) + '%</b></td><td class="c">' + gBadge(g.letter) + '</td><td class="num">100%</td><td></td></tr>'
        : '<tr><td><b>Final</b></td><td colspan="4" class="muted">Not yet assessed · ' + nOf9(g) + ' of 9 components: grades appear at 6 or more</td></tr>') +
      '</tbody></table>';
  }
  function renderStudent(sid) {
    const sem = cur();
    const i = sem.students.findIndex((s) => s.id === sid);
    if (i < 0) { location.hash = '#/students'; return; }
    const s = sem.students[i];
    const g = C.gradeStudent(sem, sid);
    const skillAvg = C.classSkillAvgs(sem);
    const prevStu = sem.students[i - 1], nextStu = sem.students[i + 1];

    $('#content').innerHTML = pageHead(U.esc(s.nameEn || s.nameCn),
      U.esc(sem.name),
      (prevStu ? '<a class="btn sm" href="#/student/' + U.esc(prevStu.id) + '">← ' + U.esc(prevStu.nameEn || prevStu.nameCn) + '</a>' : '') +
      (nextStu ? '<a class="btn sm" href="#/student/' + U.esc(nextStu.id) + '">' + U.esc(nextStu.nameEn || nextStu.nameCn) + ' →</a>' : '') +
      '<button class="btn sm" data-action="print">Print report</button>' +
      '<a class="btn sm primary" href="#/report/' + U.esc(sid) + '">Report Card</a>') +

      '<section class="profile-head">' +
        '<div class="stu-id-block"><div class="avatar">' + U.esc(avatarChar(s)) + '</div>' +
          '<div><div class="stu-name">' + U.esc(s.nameEn || s.nameCn) + '</div>' +
          '<div class="stu-meta">' + U.esc(s.nameCn || '') + (s.nameCn && s.gender ? ' · ' : '') + U.esc(s.gender || '') + (s.gender ? ' · ' : '') + 'ID ' + U.esc(s.id) + '</div>' +
          semChips(sid, sem) + '</div></div>' +
        '<div class="flex" style="align-items:center;gap:28px">' +
          '<div class="right"><div class="final-num">' + (gateOk(g) ? fmt(g.final, 1) : '–') + '</div><div class="small muted">' +
            (gateFinal(g) ? 'weighted final · 9 assessments in'
              : gateOk(g) ? 'Provisional grade based on ' + nOf9(g) + ' of 9 components'
              : 'Not yet assessed · ' + nOf9(g) + ' of 9 components') + '</div></div>' +
          (gateOk(g)
            ? '<div class="stamp' + (gateFinal(g) ? '' : ' prov') + '" style="color:' + (GRADE_HEX[g.letter] || '#9aa0a0') + '"><small>' + (gateFinal(g) ? 'FINAL GRADE' : 'PROVISIONAL · ' + nOf9(g) + '/9') + '</small>' + U.esc(g.letter || '–') + '</div>'
            : '<div class="stamp prov"><small>ASSESSMENT</small>In progress</div>') +
        '</div>' +
      '</section>' +

      '<div class="panel mb"><h3>Weekly performance</h3><div class="panel-sub">spelling & daily assignment percentages, with class averages (dashed)</div>' +
        '<div class="chart-box" style="height:280px"><canvas id="ch-week"></canvas></div></div>' +
      '<div class="grid-2 mb">' +
        '<div class="panel"><h3>Four skills</h3><div class="panel-sub">classroom observations, semester %</div><div class="chart-box" style="height:260px"><canvas id="ch-radar"></canvas></div></div>' +
        '<div class="panel"><h3>Tests</h3><div class="panel-sub">percentage vs class average</div><div class="chart-box" style="height:260px"><canvas id="ch-tests"></canvas></div></div>' +
      '</div>' +
      '<div class="panel mb"><h3>Observations by month</h3><div class="panel-sub">each line is one skill (month %)</div><div class="chart-box" style="height:240px"><canvas id="ch-obs"></canvas></div></div>' +
      anFindingsPanel(sid) +
      '<div class="panel"><h3>How the final grade adds up</h3><div class="panel-sub">component % × weight: same formula as the SPR Excel</div>' + contribTable(g) + '</div>' +
      '<div class="panel mt"><h3>Skill profile</h3><div class="panel-sub">' + U.esc(s.nameEn || s.nameCn) + '\u2019s skill profile \u2014 score vs class average (shown only with 5+ assessed pupils)</div>' +
        '<div class="chart-box" style="height:300px"><canvas id="ch-profile" role="img" aria-label="Grouped bar chart comparing this student to the class average per skill"></canvas></div>' +
        '<table class="tbl mt" id="profTbl" aria-label="Skill profile data"></table></div>' +
      '<div class="panel mt"><h3>Progress over time</h3><div class="panel-sub">comparable scores only \u2014 gaps mean no recorded assessment</div>' +
        '<div class="flex" style="gap:6px;flex-wrap:wrap;margin:8px 0" id="progSel">' +
          A.COMPONENTS.map((k) => '<button class="btn sm' + ((ui.progSkill || 'Spelling') === k ? ' primary' : '') + '" data-action="prog-skill" data-skill="' + U.esc(k) + '">' + U.esc(A.SHORT[k]) + '</button>').join('') + '</div>' +
        '<div class="chart-box" style="height:240px"><canvas id="ch-prog" role="img" aria-label="Progress over time line chart"></canvas></div>' +
        '<p class="small" id="progVerdict" style="margin-top:8px"></p></div>';

    const weeks = weekLabelList(sem);
    mkChart('ch-week', { type: 'line',
      data: { labels: weeks.map((w) => w.label), datasets: [
        ds('Spelling', weeks.map((w) => r1x(studentWeekPct(sem, sid, 'spelling', w.m, w.w))), COLORS.sp),
        ds('Daily', weeks.map((w) => r1x(studentWeekPct(sem, sid, 'daily', w.m, w.w))), COLORS.da),
        ds('Class spelling', weeks.map((w) => r1x(classWeekPct(sem, 'spelling', w.m, w.w))), COLORS.sp, { borderDash: [5, 4], borderWidth: 1, pointRadius: 0, backgroundColor: 'transparent' }),
        ds('Class daily', weeks.map((w) => r1x(classWeekPct(sem, 'daily', w.m, w.w))), COLORS.da, { borderDash: [5, 4], borderWidth: 1, pointRadius: 0, backgroundColor: 'transparent' }),
      ] }, options: lineOpts(0, 100) });

    mkChart('ch-radar', { type: 'radar',
      data: { labels: SKILLS, datasets: [
        { label: 'Student', data: SKILLS.map((sk) => r1x(g.skills[sk])), borderColor: COLORS.obs, backgroundColor: 'rgba(62,124,104,0.15)', pointRadius: 3 },
        { label: 'Class average', data: SKILLS.map((sk) => r1x(skillAvg[sk])), borderColor: '#9aa79f', backgroundColor: 'rgba(154,167,159,0.10)', borderDash: [5, 4], pointRadius: 2 },
      ] },
      options: { responsive: true, maintainAspectRatio: false,
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, backdropColor: 'transparent' } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } } } });

    mkChart('ch-tests', { type: 'bar',
      data: { labels: ['Mid-Term', 'Oral', 'Written'],
        datasets: [
          { label: 'Student', data: ['midterm', 'oral', 'written'].map((k) => r1x(C.testPct(sem, sid, k))), backgroundColor: '#2d5fa8', borderRadius: 3 },
          { label: 'Class average', data: ['midterm', 'oral', 'written'].map((k) => r1x(C.classTestAvg(sem, k))), backgroundColor: '#c9c5b2', borderRadius: 3 },
        ] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } } } });

    mkChart('ch-obs', { type: 'line',
      data: { labels: sem.months.map((m) => U.MONTH_ABBR[m] || m), datasets: SKILLS.map((sk) =>
        ds(sk, sem.months.map((m) => r1x(C.obsMonthPct(sem, sid, m, sk))), COLORS[sk])) },
      options: lineOpts(0, 100) });

    /* skill profile: student vs class (class shown only with >=5 assessed) */
    if (document.getElementById('ch-profile')) {
      const rowsP = A.COMPONENTS.map((k) => { const st = A.classComponentStats(sem, k); return { k: k, v: g.parts[k], cls: st.n >= A.MIN_CLASS_N ? st.avg : null, n: st.n }; });
      const sets = [{ label: 'Student', data: rowsP.map((r) => r1x(r.v)), backgroundColor: '#2d5fa8', borderRadius: 3 }];
      if (rowsP.some((r) => r.cls !== null)) sets.push({ label: 'Class average', data: rowsP.map((r) => r1x(r.cls)), backgroundColor: '#c9c5b2', borderRadius: 3 });
      mkChart('ch-profile', { type: 'bar',
        data: { labels: rowsP.map((r) => A.SHORT[r.k]), datasets: sets },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } } } });
      const pt = $('#profTbl');
      if (pt) pt.innerHTML = '<thead><tr><th scope="col">Skill</th><th scope="col" class="num">Student</th><th scope="col" class="num">Class average</th><th scope="col" class="num">Class assessed</th></tr></thead><tbody>' +
        rowsP.map((r) => '<tr><td>' + U.esc(r.k) + '</td><td class="num">' + (r.v === null ? 'Not yet assessed' : A.f1(r.v) + '%') + '</td>' +
          '<td class="num">' + (r.cls === null ? '\u2014' : A.f1(r.cls) + '%') + '</td><td class="num">' + r.n + '</td></tr>').join('') + '</tbody>';
    }
    /* progress over time: selected component, comparable points, gaps preserved */
    if (document.getElementById('ch-prog')) {
      const kSel = ui.progSkill || 'Spelling';
      const pts = A.componentPointList(sem, sid, kSel);
      const verdict = A.trendVerdict(pts);
      mkChart('ch-prog', { type: 'line',
        data: { labels: pts.map((q) => q.label), datasets: [ds(kSel, pts.map((q) => r1x(q.pct)), '#2d5fa8', { borderWidth: 3, spanGaps: false })] },
        options: lineOpts(0, 100) });
      const vEl = $('#progVerdict');
      if (vEl) vEl.innerHTML = pts.length === 0
        ? '<span class="muted">No recorded ' + U.esc(kSel.toLowerCase()) + ' assessments yet \u2014 nothing to conclude.</span>'
        : (verdict ? (verdict.label ? '<b>' + verdict.label + ':</b> ' : '') + U.esc(verdict.calc) + (pts.length > 2 ? '' : ' <span class="muted">Two points only \u2014 treat as an early indication.</span>') : '<span class="muted">One recorded task \u2014 a single point is not a trend.</span>');
    }
  }

  /* ============================== enter scores ============================== */
  const ENTRY_TABS = [['obs', 'Observations'], ['sp', 'Spelling'], ['da', 'Daily assignment'], ['te', 'Tests']];
  function emptyStudents() {
    return '<div class="empty"><div class="big">No students in this semester yet</div><p><a class="stu-link" href="#/manage">Add or paste your roster in Manage & setup</a></p></div>';
  }
  function renderEntry(metric) {
    const sem = cur();
    const tabs = '<div class="tabs">' + ENTRY_TABS.map((t) =>
      '<a class="tab' + (t[0] === metric ? ' on' : '') + '" data-accent="' + t[0] + '" href="#/entry/' + t[0] + '">' + t[1] + '</a>').join('') + '</div>';
    let body = '';
    if (!sem.students.length) body = emptyStudents();
    else if (metric === 'obs') body = entryObs(sem);
    else if (metric === 'te') body = entryTests(sem);
    else body = entryWeekly(sem, metric);
    $('#content').innerHTML = pageHead('Enter scores', 'saved automatically as you type',
      '<button class="btn" data-action="export-xlsx">Export SPR Excel</button>') + tabs + body;
  }
  function monthDot(sem, metric, m) {
    let filled = 0, total = 0;
    const metKey = metric === 'sp' ? 'spelling' : metric === 'da' ? 'daily' : null;
    for (const s of sem.students) {
      if (!metKey) {
        for (const sk of SKILLS) for (const lo of [1, 2]) { total++; if (C.obsValue(sem, s.id, m, sk, lo) !== null) filled++; }
      } else {
        for (let w = 1; w <= 5; w++) { total++; const e = sem[metKey][s.id] && sem[metKey][s.id][m] && sem[metKey][s.id][m][w]; if (e && e.s !== null) filled++; }
      }
    }
    return filled === total ? 'full' : filled ? 'part' : '';
  }
  function monthPills(sem, metric) {
    const sel = ui.entryMonth[metric] || sem.months[sem.months.length - 1];
    ui.entryMonth[metric] = sel;
    const dotTxt = { full: 'all recorded', part: 'partly recorded', '': 'nothing recorded yet' };
    return '<div class="sheet-toolbar"><div class="month-pills" role="group" aria-label="Months">' +
      sem.months.map((m) => {
        const d = monthDot(sem, metric, m);
        return '<button class="month-pill' + (m === sel ? ' on' : '') + '" data-action="entry-month" data-metric="' + metric + '" data-month="' + U.esc(m) + '" title="' + m + ': ' + dotTxt[d] + '" aria-label="' + m + ': ' + dotTxt[d] + '">' +
          '<span class="dot ' + d + '" aria-hidden="true"></span>' + (U.MONTH_ABBR[m] || m) + '</button>';
      }).join('') +
      '</div></div>';
  }
  function tdAvg(id, v, cls) {
    return '<td class="avg' + (cls ? ' ' + cls : '') + (v !== null && v < 50 ? ' low' : '') + '" id="' + U.esc(id) + '"><strong>' + fmt(v, 1) + '</strong></td>';
  }
  function setAvgCell(id, v) {
    const td = document.getElementById(id);
    if (!td) return;
    td.innerHTML = '<strong>' + fmt(v, 1) + '</strong>';
    td.classList.toggle('low', v !== null && v < 50);
  }

  /* ---- observations grid ---- */
  const SKILL_ABBR = { Listening: 'List', Speaking: 'Spk', Writing: 'Wrt', Reading: 'Rdg' };
  function entryObs(sem) {
    const month = ui.entryMonth.obs || sem.months[sem.months.length - 1];
    ui.entryMonth.obs = month;
    let h1 = '<tr><th rowspan="2" class="stu">Student</th>';
    for (const sk of SKILLS) h1 += '<th colspan="2" style="color:' + COLORS[sk] + '">' + sk + '</th>';
    h1 += '<th colspan="5" class="sep">Averages (%)</th></tr>';
    let h2 = '<tr>';
    for (const sk of SKILLS) h2 += '<th>LO1</th><th>LO2</th>';
    for (const sk of SKILLS) h2 += '<th>' + SKILL_ABBR[sk] + '</th>';
    h2 += '<th>Month</th><th>Sem.</th></tr>';

    const rows = sem.students.map((s, ri) => {
      let tds = '<td class="stu"><div class="nm"><span class="idx">' + (ri + 1) + '</span><b>' + U.esc(s.nameEn || s.nameCn) + '</b><span>' + U.esc(s.nameCn || '') + '</span></div></td>';
      let ci = 0;
      for (const sk of SKILLS) for (const lo of [1, 2]) {
        const v = C.obsValue(sem, s.id, month, sk, lo);
        const obsLock = canDo('edit.obs') ? '' : (canDo('request.obs') ? ' readonly data-propose="1" title="Click to propose a change (EAL approves)"' : ' readonly title="Read-only"');
        tds += '<td><input class="cell" data-kind="obs" data-sid="' + U.esc(s.id) + '" data-month="' + U.esc(month) + '" data-key="' + sk + '-LO' + lo + '" data-ri="' + ri + '" data-ci="' + ci + '" inputmode="decimal"' + obsLock + ' value="' + U.esc(v === null ? '' : String(v)) + '"></td>';
        ci++;
      }
      const g = C.gradeStudent(sem, s.id);
      for (const sk of SKILLS) tds += tdAvg('sk-' + sk + '-' + s.id, C.obsMonthPct(sem, s.id, month, sk));
      const semOverall = mean(SKILLS.map((sk) => g.skills[sk]).filter((v) => v !== null));
      tds += tdAvg('ovm-' + s.id, C.obsMonthPctOverall(sem, s.id, month), 'sep');
      tds += tdAvg('osem-' + s.id, semOverall);
      return '<tr>' + tds + '</tr>';
    }).join('');

    let foot = '<tr><td class="stu">Class average</td>';
    for (const sk of SKILLS) for (const lo of [1, 2]) foot += '<td id="f-' + sk + '-LO' + lo + '"></td>';
    for (const sk of SKILLS) foot += '<td id="f-sk-' + sk + '"></td>';
    foot += '<td id="f-ovm" class="sep"></td><td id="f-osem"></td></tr>';

    return monthPills(sem, 'obs') +
      '<div class="sheet"><table class="grid"><thead>' + h1 + h2 + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      '<div class="legend"><details><summary>What do LO1 / LO2 mean?</summary><table>' +
      SKILLS.map((sk) => '<tr><th style="color:' + COLORS[sk] + '">' + sk + '</th><td>LO1: ' + U.esc(U.LOS[sk + '-LO1']) + '<br>LO2: ' + U.esc(U.LOS[sk + '-LO2']) + '</td></tr>').join('') +
      '</table></details><span class="small muted">Scores out of 10 · recorded monthly · the “Sem.” column is the semester average of every LO score ×10</span></div>';
  }
  function updateObsRow(sem, sid) {
    const month = ui.entryMonth.obs;
    for (const sk of SKILLS) setAvgCell('sk-' + sk + '-' + sid, C.obsMonthPct(sem, sid, month, sk));
    setAvgCell('ovm-' + sid, C.obsMonthPctOverall(sem, sid, month));
    const g = C.gradeStudent(sem, sid);
    setAvgCell('osem-' + sid, mean(SKILLS.map((sk) => g.skills[sk]).filter((v) => v !== null)));
  }
  function updateObsFooters(sem) {
    const month = ui.entryMonth.obs;
    for (const sk of SKILLS) for (const lo of [1, 2]) {
      const el = document.getElementById('f-' + sk + '-LO' + lo);
      if (el) el.textContent = fmt(mean(sem.students.map((s) => C.obsValue(sem, s.id, month, sk, lo)).filter((v) => v !== null)), 1);
    }
    for (const sk of SKILLS) {
      const el = document.getElementById('f-sk-' + sk);
      if (el) el.textContent = fmt(mean(sem.students.map((s) => C.obsMonthPct(sem, s.id, month, sk)).filter((v) => v !== null)), 1);
    }
    const ov = document.getElementById('f-ovm');
    if (ov) ov.textContent = fmt(mean(sem.students.map((s) => C.obsMonthPctOverall(sem, s.id, month)).filter((v) => v !== null)), 1);
    const se = document.getElementById('f-osem');
    if (se) se.textContent = fmt(mean(sem.students.map((s) => {
      const g = C.gradeStudent(sem, s.id);
      return mean(SKILLS.map((sk) => g.skills[sk]).filter((v) => v !== null));
    }).filter((v) => v !== null)), 1);
  }

  /* ---- weekly (spelling / daily) grid ---- */
  function entryWeekly(sem, metric) {
    const metKey = metric === 'sp' ? 'spelling' : 'daily';
    const month = ui.entryMonth[metric] || sem.months[sem.months.length - 1];
    ui.entryMonth[metric] = month;
    let h1 = '<tr><th rowspan="2" class="stu">Student</th>';
    for (let w = 1; w <= 5; w++) h1 += '<th colspan="2">Week ' + w + '</th>';
    h1 += '<th rowspan="2" class="sep">Month avg (%)</th><th rowspan="2">Semester (%)</th></tr>';
    let h2 = '<tr>';
    for (let w = 1; w <= 5; w++) h2 += '<th>Score</th><th>Total</th>';
    h2 += '</tr>';

    const rows = sem.students.map((s, ri) => {
      let tds = '<td class="stu"><div class="nm"><span class="idx">' + (ri + 1) + '</span><b>' + U.esc(s.nameEn || s.nameCn) + '</b><span>' + U.esc(s.nameCn || '') + '</span></div></td>';
      let ci = 0;
      for (let w = 1; w <= 5; w++) for (const f of ['s', 't']) {
        const e = sem[metKey][s.id] && sem[metKey][s.id][month] && sem[metKey][s.id][month][w];
        const v = e ? e[f] : null;
        tds += '<td><input class="cell" data-kind="week" data-sid="' + U.esc(s.id) + '" data-met="' + metKey + '" data-w="' + w + '" data-f="' + f + '" data-ri="' + ri + '" data-ci="' + ci + '" inputmode="decimal"' + (canDo('edit.scores') ? '' : ' readonly title="Read-only"') + ' value="' + U.esc(v === null || v === undefined ? '' : String(v)) + '"></td>';
        ci++;
      }
      tds += tdAvg('mavg-' + s.id, C.weeklyMonthPct(sem, s.id, metKey, month), 'sep');
      tds += tdAvg('savg-' + s.id, C.weeklySemesterPct(sem, s.id, metKey));
      return '<tr>' + tds + '</tr>';
    }).join('');

    let foot = '<tr><td class="stu">Class average</td>';
    for (let w = 1; w <= 5; w++) foot += '<td colspan="2" id="f-w' + w + '"></td>';
    foot += '<td id="f-mavg" class="sep"></td><td id="f-savg"></td></tr>';

    const defTot = metKey === 'spelling' ? DB.settings.spTotal : DB.settings.daTotal;
    return monthPills(sem, metric) +
      '<div class="sheet"><table class="grid"><thead>' + h1 + h2 + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      '<div class="legend"><span class="small muted">Enter score and total (usually out of ' + defTot + '): month and semester averages compute automatically. Paste a block copied from Excel straight into the grid.</span></div>';
  }
  function updateWeekRow(sem, sid, metKey) {
    const metric = metKey === 'spelling' ? 'sp' : 'da';
    const month = ui.entryMonth[metric];
    setAvgCell('mavg-' + sid, C.weeklyMonthPct(sem, sid, metKey, month));
    setAvgCell('savg-' + sid, C.weeklySemesterPct(sem, sid, metKey));
  }
  function updateWeekFooters(sem, metKey) {
    const metric = metKey === 'spelling' ? 'sp' : 'da';
    const month = ui.entryMonth[metric];
    for (let w = 1; w <= 5; w++) {
      const el = document.getElementById('f-w' + w);
      if (el) el.textContent = fmt(classWeekPct(sem, metKey, month, w), 1);
    }
    const ma = document.getElementById('f-mavg');
    if (ma) ma.textContent = fmt(mean(sem.students.map((s) => C.weeklyMonthPct(sem, s.id, metKey, month)).filter((v) => v !== null)), 1);
    const sa = document.getElementById('f-savg');
    if (sa) sa.textContent = fmt(mean(sem.students.map((s) => C.weeklySemesterPct(sem, s.id, metKey)).filter((v) => v !== null)), 1);
  }

  /* ---- tests grid ---- */
  const TEST_BLOCKS = [['midterm', 'Mid-Term'], ['oral', 'Oral'], ['written', 'Written']];
  function entryTests(sem) {
    let h1 = '<tr><th rowspan="2" class="stu">Student</th>';
    for (const b of TEST_BLOCKS) h1 += '<th colspan="3">' + b[1] + '</th>';
    h1 += '<th colspan="2" class="sep">Weighted final</th></tr>';
    let h2 = '<tr>';
    for (const b of TEST_BLOCKS) h2 += '<th>Score</th><th>Total</th><th>%</th>';
    h2 += '<th>Score</th><th>Grade</th></tr>';

    const rows = sem.students.map((s, ri) => {
      let tds = '<td class="stu"><div class="nm"><span class="idx">' + (ri + 1) + '</span><b>' + U.esc(s.nameEn || s.nameCn) + '</b><span>' + U.esc(s.nameCn || '') + '</span></div></td>';
      let ci = 0;
      for (const b of TEST_BLOCKS) for (const f of ['s', 't']) {
        const t = sem.tests[s.id] && sem.tests[s.id][b[0]];
        const v = t ? t[f] : null;
        tds += '<td><input class="cell" data-kind="test" data-sid="' + U.esc(s.id) + '" data-tp="' + b[0] + '" data-f="' + f + '" data-ri="' + ri + '" data-ci="' + ci + '" inputmode="decimal"' + (canDo('edit.scores') ? '' : ' readonly title="Read-only"') + ' value="' + U.esc(v === null || v === undefined ? '' : String(v)) + '"></td>';
        ci++;
      }
      const g = C.gradeStudent(sem, s.id);
      for (const b of TEST_BLOCKS) tds += tdAvg('tp-' + b[0] + '-' + s.id, C.testPct(sem, s.id, b[0]));
      tds += '<td class="avg sep" id="tfin-' + U.esc(s.id) + '">' + (gateOk(g) ? '<strong>' + fmt(g.final, 1) + (gateFinal(g) ? '' : ' <span class="small muted">P' + nOf9(g) + '/9</span>') + '</strong>' : '<span class="muted small">' + nOf9(g) + '/9</span>') + '</td>';
      tds += '<td class="avg" id="tgl-' + U.esc(s.id) + '">' + gradeCell(g) + '</td>';
      return '<tr>' + tds + '</tr>';
    }).join('');

    let foot = '<tr><td class="stu">Class average</td>';
    for (const b of TEST_BLOCKS) foot += '<td colspan="2"></td><td id="f-tp-' + b[0] + '"></td>';
    foot += '<td id="f-fin" class="sep"></td><td></td></tr>';

    return '<div class="sheet" style="margin-top:14px"><table class="grid" style="min-width:900px"><thead>' + h1 + h2 + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      '<div class="legend"><span class="small muted">The final grade here already includes observations, spelling and daily assignments: Written counts 20%, every other part 10%.</span></div>';
  }
  function updateTestRow(sem, sid) {
    for (const b of TEST_BLOCKS) setAvgCell('tp-' + b[0] + '-' + sid, C.testPct(sem, sid, b[0]));
    const g = C.gradeStudent(sem, sid);
    const fin = document.getElementById('tfin-' + sid);
    if (fin) fin.innerHTML = gateOk(g) ? '<strong>' + fmt(g.final, 1) + (gateFinal(g) ? '' : ' <span class="small muted">P' + nOf9(g) + '/9</span>') + '</strong>' : '<span class="muted small">' + nOf9(g) + '/9</span>';
    const gl = document.getElementById('tgl-' + sid);
    if (gl) gl.innerHTML = gradeCell(g);
  }
  function updateTestFooters(sem) {
    for (const b of TEST_BLOCKS) {
      const el = document.getElementById('f-tp-' + b[0]);
      if (el) el.textContent = fmt(C.classTestAvg(sem, b[0]), 1);
    }
    const fin = document.getElementById('f-fin');
    if (fin) fin.textContent = fmt(C.classFinalAvg(sem), 1);
  }

  /* ---- cell mutations & input handling ---- */
  function setObsCell(sem, sid, month, key, v) {
    sem.observations[sid] = sem.observations[sid] || {};
    sem.observations[sid][month] = sem.observations[sid][month] || {};
    const cell = sem.observations[sid][month];
    if (v === null) {
      delete cell[key];
      if (!Object.keys(cell).length) delete sem.observations[sid][month];
    } else cell[key] = v;
  }
  function setWeekCell(sem, sid, met, month, w, f, v) {
    sem[met][sid] = sem[met][sid] || {};
    sem[met][sid][month] = sem[met][sid][month] || {};
    const rec = sem[met][sid][month];
    rec[w] = rec[w] || { s: null, t: null };
    rec[w][f] = v;
    if (rec[w].s === null && rec[w].t === null) delete rec[w];
    if (!Object.keys(rec).length) delete sem[met][sid][month];
  }
  function setTestCell(sem, sid, tp, f, v) {
    sem.tests[sid] = sem.tests[sid] || {};
    sem.tests[sid][tp] = sem.tests[sid][tp] || { s: null, t: null };
    sem.tests[sid][tp][f] = v;
    if (sem.tests[sid][tp].s === null && sem.tests[sid][tp].t === null) delete sem.tests[sid][tp];
    if (!Object.keys(sem.tests[sid]).length) delete sem.tests[sid];
  }
  function getWeek(sem, sid, met, month, w) {
    return sem[met][sid] && sem[met][sid][month] && sem[met][sid][month][w];
  }
  function weekInputs(sid, met, w) {
    return $$('input[data-kind="week"]').filter((x) => x.dataset.sid === sid && x.dataset.met === met && x.dataset.w === String(w));
  }
  function onGridInput(el) {
    const sem = cur();
    if (!sem) return;
    const raw = el.value.trim().replace(/，/g, '.');
    let v = raw === '' ? null : Number(raw);
    if (v !== null && isNaN(v)) { el.classList.add('invalid'); return; }
    el.classList.remove('invalid');
    const kind = el.dataset.kind;

    /* class mode: the role matrix decides what typing is even possible */
    if (kind === 'obs' && !canDo('edit.obs')) { try { el.value = el.getAttribute('value') || ''; } catch (er) {} return; }
    if ((kind === 'week' || kind === 'test') && !canDo('edit.scores')) { try { el.value = el.getAttribute('value') || ''; } catch (er) {} return; }
    if (kind === 'obs') {
      const sid = el.dataset.sid, month = el.dataset.month, key = el.dataset.key;
      /* out-of-range scores are refused, not stored (D5/D6): the cell stays
         flagged red with the teacher's text in it until they fix it */
      if (v !== null && !C.validObs(v)) { el.classList.add('invalid'); v = null; }
      else el.classList.remove('invalid');
      setObsCell(sem, sid, month, key, v);
      updateObsRow(sem, sid);
      updateObsFooters(sem);
    } else if (kind === 'week') {
      const sid = el.dataset.sid, met = el.dataset.met, w = el.dataset.w, f = el.dataset.f;
      const metric = met === 'spelling' ? 'sp' : 'da';
      const month = ui.entryMonth[metric];
      const rec0 = getWeek(sem, sid, met, month, w);
      const def = met === 'spelling' ? Number(DB.settings.spTotal) : Number(DB.settings.daTotal);
      /* refuse the edit that breaks validity (D5/D6): negative/non-finite score,
         unusable total, score above the total it will be measured against
         (incl. the auto-filled default): the stored value stays as it was */
      const effT = (rec0 && rec0.t !== null && rec0.t !== undefined) ? rec0.t
        : (DB.settings.autoTotal && C.validTotal(def) ? def : null);
      const refused = v !== null && (
        (f === 's' && (!C.validScore(v) || (effT !== null && v > effT))) ||
        (f === 't' && (!C.validTotal(v) || (rec0 && rec0.s !== null && v < rec0.s))));
      if (refused) {
        el.classList.add('invalid');
      } else {
        weekInputs(sid, met, w).forEach((x) => x.classList.remove('invalid'));
        setWeekCell(sem, sid, met, month, w, f, v);
        if (f === 's' && v !== null && DB.settings.autoTotal && C.validTotal(def)) {
          const rec = getWeek(sem, sid, met, month, w);
          if (!rec || rec.t === null) {
            setWeekCell(sem, sid, met, month, w, 't', def);
            const ti = weekInputs(sid, met, w).find((x) => x.dataset.f === 't');
            if (ti) ti.value = def;
          }
        }
      }
      updateWeekRow(sem, sid, met);
      updateWeekFooters(sem, met);
    } else if (kind === 'test') {
      const sid = el.dataset.sid, tp = el.dataset.tp, f = el.dataset.f;
      const rec0 = sem.tests[sid] && sem.tests[sid][tp];
      const refused = v !== null && (
        (f === 's' && (!C.validScore(v) || (rec0 && rec0.t !== null && rec0.t !== undefined && v > rec0.t))) ||
        (f === 't' && (!C.validTotal(v) || (rec0 && rec0.s !== null && rec0.s !== undefined && v < rec0.s))));
      const tps = $$('input[data-kind="test"]').filter((x) => x.dataset.sid === sid && x.dataset.tp === tp);
      if (refused) el.classList.add('invalid');
      else { tps.forEach((x) => x.classList.remove('invalid')); setTestCell(sem, sid, tp, f, v); }
      updateTestRow(sem, sid);
      updateTestFooters(sem);
    }
    saveDB();
  }
  function onGridKey(e) {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const el = e.target;
    if (!el.classList || !el.classList.contains('cell')) return;
    e.preventDefault();
    let dir = e.key === 'Enter' && e.shiftKey ? -1 : 1;
    if (e.key === 'ArrowUp') dir = -1;
    if (e.key === 'ArrowDown') dir = 1;
    const ri = Number(el.dataset.ri), ci = Number(el.dataset.ci);
    const target = $$('.grid input.cell').find((x) => Number(x.dataset.ci) === ci && Number(x.dataset.ri) === ri + dir);
    if (target) { target.focus(); target.select(); }
  }
  function onGridPaste(e) {
    const el = e.target;
    if (!el.classList || !el.classList.contains('cell')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/\t|\n/.test(text)) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length);
    const grid = $$('.grid input.cell');
    const ri0 = Number(el.dataset.ri), ci0 = Number(el.dataset.ci);
    lines.forEach((line, di) => {
      line.split('\t').forEach((val, dj) => {
        const t = grid.find((x) => Number(x.dataset.ri) === ri0 + di && Number(x.dataset.ci) === ci0 + dj);
        if (!t) return;
        t.value = val.trim().replace(/^"|"$/g, '');
        onGridInput(t);
      });
    });
    saveDB();
  }

  /* ================================ grading ================================ */
  function prevFinal(sem, sid) {
    const idx = DB.semesters.findIndex((x) => x.id === sem.id);
    for (let i = idx - 1; i >= 0; i--) {
      const s2 = DB.semesters[i];
      if (s2.students.some((x) => x.id === sid)) {
        const pg = C.gradeStudent(s2, sid);
        /* trend comparisons need sufficient evidence on the earlier side too */
        return C.assessedCount(pg) >= C.FINAL_MIN_ASSESSED ? pg.final : null;
      }
    }
    return null;
  }
  function grRows(sem) {
    const q = ui.grQ.trim().toLowerCase();
    let rows = C.gradeAll(sem).map((g, i) => ({ g: g, s: sem.students[i] }));
    if (q) rows = rows.filter((r) => (r.s.nameEn + ' ' + r.s.nameCn + ' ' + r.s.id).toLowerCase().includes(q));
    const k = ui.gsort.k, d = ui.gsort.d;
    rows.sort((a, b) => {
      if (k === 'name') return d * String(a.s.nameEn || '').localeCompare(String(b.s.nameEn || ''));
      const av = gateOk(a.g) ? a.g.final : -1, bv = gateOk(b.g) ? b.g.final : -1; /* below-gate rows sink */
      return d * (av - bv);
    });
    return rows.map((r) => {
      const g = r.g, s = r.s;
      const L = (p) => '<td class="c">' + gBadge(p === null ? null : C.letter(p)) + '</td>';
      const pf = prevFinal(sem, s.id);
      let trend = '<span class="muted">–</span>';
      if (pf !== null && gateOk(g)) {
        const dd = g.final - pf;
        if (dd > 0.5) trend = '<span style="color:#1d7a4a">↑ ' + fmt(dd, 1) + '</span>';
        else if (dd < -0.5) trend = '<span style="color:#c4453c">↓ ' + fmt(-dd, 1) + '</span>';
        else trend = '<span class="muted">·</span>';
      }
      return '<tr><td><a class="stu-link" href="#/student/' + U.esc(s.id) + '">' + U.esc(s.nameEn || s.nameCn) +
        '</a> <span class="muted small">' + U.esc(s.nameCn || '') + '</span></td>' +
        L(g.parts.Listening) + L(g.parts.Speaking) + L(g.parts.Writing) + L(g.parts.Reading) +
        L(g.parts.Spelling) + L(g.parts['Daily Assignments']) + L(g.parts['Mid-Term']) + L(g.parts.Oral) + L(g.parts.Written) +
        '<td class="num">' + finalCell(g) + '</td><td class="c">' + gradeCell(g) + '</td>' +
        '<td class="num small">' + trend + '</td></tr>';
    }).join('');
  }
  function renderGrading() {
    const sem = cur();
    const arrow = (k) => ui.gsort.k === k ? (ui.gsort.d < 0 ? ' ↓' : ' ↑') : '';
    $('#content').innerHTML = pageHead('Grading', 'computed live from every score: the same formula as the SPR Excel',
      '<input class="inp" id="grSearch" placeholder="Search student…" value="' + U.esc(ui.grQ) + '">' +
      '<button class="btn" data-action="export-xlsx">Export SPR Excel</button>' +
      '<button class="btn" data-action="print">Print</button>') +
      '<div class="sheet"><table class="tbl"><thead><tr>' +
      '<th data-action="gsort" data-k="name" style="cursor:pointer">Student' + arrow('name') + '</th>' +
      '<th class="c">Listen</th><th class="c">Speak</th><th class="c">Write</th><th class="c">Read</th>' +
      '<th class="c">Spell</th><th class="c">Daily</th><th class="c">Mid</th><th class="c">Oral</th><th class="c">Written</th>' +
      '<th class="num" data-action="gsort" data-k="final" style="cursor:pointer">Final' + arrow('final') + '</th>' +
      '<th class="c">Grade</th><th class="num">vs last term</th></tr></thead>' +
      '<tbody id="grBody">' + grRows(sem) + '</tbody></table></div>' +
      '<div class="legend"><span class="small muted">Final = Listening 10% + Speaking 10% + Writing 10% + Reading 10% + Spelling 10% + Daily 10% + Mid-Term 10% + Oral 10% + Written 20%. Grades: A* &gt; 84, A &gt; 74, B &gt; 64, C &gt; 54, D &gt; 49, otherwise U.</span><br><span class="small muted">P n/9 = provisional grade based on n of 9 components (finals appear at 6 or more); fewer than 6 assessed components show Not yet assessed.</span></div>';
  }

  /* ================================= manage ================================= */
  function parseRosterPaste(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const f = line.split(/\t|,|;|，|；/).map((x) => x.trim());
      let id = '', cn = '', en = '', g = '';
      if (f.length >= 4) { id = f[0]; cn = f[1]; en = f[2]; g = f[3]; }
      else if (f.length === 3) { id = f[0]; cn = f[1]; en = f[2]; }
      else if (f.length === 2) { cn = f[0]; en = f[1]; }
      else { en = f[0]; }
      if (!id) id = 'STU-' + String(out.length + 1).padStart(3, '0');
      id = id.replace(/[^A-Za-z0-9_\-]/g, '-').slice(0, 40) || 'STU';   // same id rule as Excel import
      g = U.normGender(g);
      if (en || cn) out.push({ id: id, nameCn: cn, nameEn: en, gender: g });
    });
    return out;
  }
  function semCard(s) {
    const on = s.id === DB.currentSemesterId;
    return '<div class="panel mb"><div class="spread">' +
      '<b style="font-family:var(--font-display);font-size:16px">' + U.esc(s.name) + (on ? ' <span class="in-term">current</span>' : '') + '</b>' +
      '<div class="flex">' +
        '<button class="btn sm" data-action="months-edit" data-semid="' + U.esc(s.id) + '">Months (' + s.months.length + ')</button>' +
        (on ? '' : '<button class="btn sm primary" data-action="sem-current" data-semid="' + U.esc(s.id) + '">Make current</button>') +
        '<button class="btn sm danger" data-action="sem-del" data-semid="' + U.esc(s.id) + '">Delete</button>' +
      '</div></div>' +
      '<div class="flex mt">' +
        '<label>Name <input class="inp" data-semf="name" data-semid="' + U.esc(s.id) + '" value="' + U.esc(s.name) + '"></label>' +
        '<label>School <input class="inp" data-semf="school" data-semid="' + U.esc(s.id) + '" value="' + U.esc(s.school) + '"></label>' +
        '<label>Class <input class="inp" data-semf="className" data-semid="' + U.esc(s.id) + '" value="' + U.esc(s.className) + '"></label>' +
        '<label>Teachers <input class="inp" data-semf="teachersInput" data-semid="' + U.esc(s.id) + '" value="' + U.esc(s.teachers.join(', ')) + '" placeholder="Mo, Lisa"></label>' +
      '</div>' +
      '<div class="small muted mt">' + s.students.length + ' students · months: ' + U.esc(s.months.join(', ')) + '</div></div>';
  }
  /* ================= ranking — multi-workbook comparison (Admin + Management) ================= */
  /* One row per imported workbook. Class average follows the same rule as the
     rest of the app: only pupils meeting the >=6-components gate count, so an
     incomplete workbook is never punished with a fake low average. */
  function rkRows() {
    const prevAvg = {}; /* 'school · class' -> previous average, in workbook order */
    return DB.semesters.map((sem) => {
      const gAll = C.gradeAll(sem);
      const ok = gAll.filter((g) => C.assessedCount(g) >= C.FINAL_MIN_ASSESSED);
      const avg = ok.length ? ok.reduce((t, g) => t + g.final, 0) / ok.length : null;
      const key = (sem.school || 'School') + ' · ' + (sem.className || sem.name);
      const prev = (prevAvg[key] === undefined) ? null : prevAvg[key];
      if (avg !== null) prevAvg[key] = avg;
      const dist = C.gradeDistribution(sem);
      const comp = C.completeness(sem);
      const compAvg = (comp.obs + comp.spelling + comp.daily + comp.tests) / 4;
      return {
        sem: sem, key: key, avg: avg, n: sem.students.length, nOk: ok.length,
        distTop: dist['A*'] + dist.A, prev: prev,
        delta: (avg !== null && prev !== null) ? avg - prev : null,
        comp: compAvg, compParts: comp,
      };
    });
  }
  function rkSortCmp(k) {
    const dir = (ui.rk || {}).dir || -1;
    return function (a, b) {
      const va = a[k], vb = b[k];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;            /* no evidence always sinks, whatever the direction */
      if (vb === null) return -1;
      if (typeof va === 'string' || typeof vb === 'string')
        return dir * String(va).localeCompare(String(vb));
      return dir * (va - vb);
    };
  }
  function renderRanking() {
    if (!DB.semesters.length) { renderWelcome(); return; }
    if (!ui.rk) ui.rk = { school: '', teacher: '', k: 'avg', dir: -1 };
    const f = ui.rk;
    const all = rkRows();
    const schools = [...new Set(all.map((r) => r.sem.school || 'School'))].sort();
    const teachers = [...new Set(DB.semesters.reduce((t, s) => t.concat(s.teachers || []), []))].sort((a, b) => a.localeCompare(b));
    const rows = all.filter((r) =>
      (!f.school || (r.sem.school || 'School') === f.school) &&
      (!f.teacher || (r.sem.teachers || []).some((t) => t.toLowerCase() === f.teacher.toLowerCase()))
    ).sort(rkSortCmp(f.k));
    const ranked = rows.slice().sort(rkSortCmp('avg'));
    const rankOf = {}; ranked.forEach((r, i) => { if (r.avg !== null && rankOf[r.sem.id] === undefined) rankOf[r.sem.id] = i + 1; });
    const classes = new Set(all.map((r) => r.key)).size;
    const avgVals = all.map((r) => r.avg).filter((v) => v !== null);
    const overall = avgVals.length ? avgVals.reduce((x, y) => x + y, 0) / avgVals.length : null;

    const arrow = (k) => (f.k === k ? (f.dir === -1 ? ' ↓' : ' ↑') : '');
    const th = (k, label, extra) => '<th scope="col"' + (extra || '') + '><a href="#" data-action="rk-sort" data-k="' + k + '" class="th-sort">' + label + arrow(k) + '</a></th>';
    $('#content').innerHTML =
      pageHead('Ranking', all.length + (all.length === 1 ? ' workbook' : ' workbooks') + ' · ' + schools.length + (schools.length === 1 ? ' school' : ' schools') + ' · ' + classes + ' classes: comparative view for Admin &amp; Management') +
      '<div class="flex mb">' +
        '<label>School <select class="inp" id="rkSchool"><option value="">All schools</option>' + schools.map((s) => '<option value="' + U.esc(s) + '"' + (f.school === s ? ' selected' : '') + '>' + U.esc(s) + '</option>').join('') + '</select></label>' +
        '<label>Teacher <select class="inp" id="rkTeacher"><option value="">All teachers</option>' + teachers.map((t) => '<option value="' + U.esc(t) + '"' + (f.teacher === t ? ' selected' : '') + '>' + U.esc(t) + '</option>').join('') + '</select></label>' +
        '<span class="small muted" style="align-self:center">Average = weighted final, pupils with at least 6 assessed components only.</span>' +
      '</div>' +
      '<div class="kpi-strip">' +
        kpi(all.length, all.length === 1 ? 'workbook' : 'workbooks') +
        kpi(classes, classes === 1 ? 'class' : 'classes') +
        kpi(DB.semesters.reduce((t, s) => t + s.students.length, 0), 'students total') +
        kpi(overall === null ? '–' : fmt(overall, 1) + '%', 'overall average') +
      '</div>' +
      '<div class="sheet"><table class="tbl"><thead><tr>' +
        th('rank', '#') + th('school', 'School') + th('class', 'Class') + th('teacher', 'Teacher(s)') +
        th('avg', 'Class average') + th('distTop', 'A*/A') + th('delta', 'vs previous') +
        th('n', 'Students') + th('comp', 'Data recorded') + '<th scope="col"></th>' +
      '</tr></thead><tbody>' +
      (rows.length ? rows.map((r) => {
        const s = r.sem;
        const provisional = (r.comp < 0.6 || r.nOk < A.MIN_CLASS_N);
        const dTxt = r.delta === null ? '<span class="muted">–</span>'
          : r.delta > 0.5 ? '<span style="color:var(--green,#1d7a4a)">▲ +' + fmt(r.delta, 1) + '</span>'
          : r.delta < -0.5 ? '<span style="color:var(--red,#c4453c)">▼ ' + fmt(r.delta, 1) + '</span>'
          : '<span class="muted">· stable</span>';
        return '<tr>' +
          '<td class="num">' + (rankOf[s.id] ? '#' + rankOf[s.id] : '<span class="muted">–</span>') + '</td>' +
          '<td>' + U.esc(s.school || 'School') + '</td>' +
          '<td>' + U.esc(s.className || '–') + '</td>' +
          '<td>' + U.esc((s.teachers || []).join(', ') || '–') + '</td>' +
          '<td class="num"><b>' + (r.avg === null ? '<span class="muted">not enough data</span>' : fmt(r.avg, 1) + '%') + '</b>' +
            (provisional && r.avg !== null ? ' <span class="g g-none" title="Provisional: ' + (r.nOk < A.MIN_CLASS_N ? 'fewer than ' + A.MIN_CLASS_N + ' pupils with enough assessed components' : 'less than 60% of expected scores recorded') + '">provisional</span>' : '') + '</td>' +
          '<td class="num">' + (r.nOk ? r.distTop + '/' + r.nOk : '–') + '</td>' +
          '<td class="num">' + dTxt + '</td>' +
          '<td class="num">' + r.n + '</td>' +
          '<td class="num" title="Observations ' + Math.round(r.compParts.obs * 100) + '% · Spelling ' + Math.round(r.compParts.spelling * 100) + '% · Daily ' + Math.round(r.compParts.daily * 100) + '% · Tests ' + Math.round(r.compParts.tests * 100) + '%">' + Math.round(r.comp * 100) + '%</td>' +
          '<td><button class="btn sm" data-action="rk-open" data-sem="' + U.esc(s.id) + '">Open</button></td></tr>';
      }).join('') : '<tr><td colspan="10" class="muted">No workbooks match these filters.</td></tr>') +
      '</tbody></table></div>' +
      '<div class="panel"><h3>Class averages: every workbook</h3><div class="panel-sub">weighted final · ranked high to low</div>' +
        '<div class="chart-box" style="height:' + Math.max(200, Math.min(ranked.length, 30) * 26) + 'px"><canvas id="ch-rank" role="img" aria-label="Horizontal bar chart of class averages per workbook"></canvas></div></div>';

    chartTheme();
    const top = ranked.filter((r) => r.avg !== null).slice(0, 30);
    if (top.length) mkChart('ch-rank', {
      type: 'bar',
      data: {
        labels: top.map((r) => (r.sem.school || 'School') + ' · ' + (r.sem.className || r.sem.name) + ': ' + r.sem.name),
        datasets: [ds('Class average', top.map((r) => r1x(r.avg)), '#2f7d5c', { borderWidth: 1 })],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.x.toFixed(1) + '% average weighted final' } } },
      },
    });
  }

  /* simple-ui admin Users tab: every account this device knows, plain words,
     no secrets (never render hashes, keyrings or wraps) */
  function usersClassInfo(un, role) {
    const r = classRole(role);
    if (r === 'admin' || r === 'manager') return { classes: 'All classes', partner: '' };
    const ix = classIndex();
    const mine = ix.filter((c) => c.eal === un || c.support === un);
    if (!mine.length) return { classes: 'Not paired yet', partner: '' };
    const partner = mine.map((c) => (c.eal === un ? c.support : c.eal) || '').filter(Boolean).join(', ');
    return { classes: mine.map((c) => c.name).join(', '), partner: partner };
  }
  function renderUsers() {
    const f = ui.usersView || (ui.usersView = { q: '', role: 'all' });
    const all = getAuth().users;
    const q = f.q.trim().toLowerCase();
    const rows = all.filter((u) => (f.role === 'all' || classRole(u.role) === f.role) &&
      (!q || (u.username + ' ' + (u.name || '')).toLowerCase().includes(q)));
    const cell = (v) => U.esc(v || '\u2014');
    /* self-contained: reachable both from the shell (class open) and straight
       from the chooser screen (no class open): so draw the whole page */
    $('#app').innerHTML = '<div class="app"><main class="page" style="max-width:1080px;margin:0 auto;width:100%">' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        '<a class="btn" href="' + (CLS || sprMode() !== 'class' ? '#/dashboard' : '#/classes') + '" style="font-size:11.5px;padding:5px 12px">&larr; Back to the app</a>' +
        '<button class="uc-out" data-action="logout" style="font-size:11.5px;padding:5px 12px">Sign out</button></div>' +
      pageHead('Users', all.length + ' account' + (all.length === 1 ? '' : 's') + ' on this device') +
      '<p class="small muted" style="margin:-4px 0 14px">Shows accounts known on this device. When the school database is added, this list will show everyone automatically.</p>' +
      '<div class="sheet-toolbar no-print"><div class="flex" style="flex-wrap:wrap;gap:10px;align-items:center">' +
        '<label>Search <input class="inp" id="usersQ" placeholder="Name or username\u2026" value="' + U.esc(f.q) + '"></label>' +
        '<label>Role <select class="inp" id="usersRole">' + [['all', 'All roles'], ['admin', 'Admin'], ['manager', 'Manager'], ['eal', 'EAL teacher'], ['support', 'Supporting teacher']].map((o) => '<option value="' + o[0] + '"' + (f.role === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
        '<button class="btn" data-action="users-csv">Download list (CSV)</button>' +
        '<button class="btn" data-action="acct-add-open">Add account</button>' +
        '<button class="btn" data-action="class-roster-btn">Import roster CSV</button>' +
      '</div></div>' +
      (rows.length ? '<table class="tbl"><thead><tr><th scope="col">Display name</th><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Class</th><th scope="col">Paired with</th><th scope="col">Status</th><th scope="col"></th></tr></thead><tbody>' +
        rows.map((u) => {
          const ci = usersClassInfo(u.username, u.role);
          const selfNow = u.username === SESSION.user;
          return '<tr><td>' + U.esc(u.name || u.username) + '</td>' +
            '<td>' + U.esc(u.username) + (selfNow ? ' <span class="muted small">(you)</span>' : '') + '</td>' +
            '<td>' + roleLabel(u.role) + '</td>' +
            '<td>' + cell(ci.classes) + '</td>' +
            '<td>' + cell(ci.partner) + '</td>' +
            '<td>' + (u.disabled ? '<span class="g g-none">Disabled</span>' : '<span class="g g-ok">Active</span>') + '</td>' +
            '<td>' + (selfNow ? '' :
              '<button class="btn sm" data-action="acct-reset-open" data-user="' + U.esc(u.username) + '">Reset password</button> ' +
              '<button class="btn sm" data-action="user-toggle" data-user="' + U.esc(u.username) + '">' + (u.disabled ? 'Enable' : 'Disable') + '</button>') + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<div class="empty" style="padding:28px 24px"><div class="big">No matching accounts</div></div>') +
      '<input type="file" id="file-roster" accept=".csv,text/csv" hidden>' +
      '</main></div>';
  }

  /* ============================== help & training ==============================
     One page for every role: training modules, the manual + video, and a
     request line to the owner (2026-10-27, owner request 3: replaces the
     small Help & support panel inside Manage & setup). The request form has
     no server: it composes a message the teacher sends by email or pastes
     into WeChat/DingTalk: nothing is uploaded by itself. */
  const OWNER_EMAIL = 'mdshezkhn@aol.com';   /* site owner (Teacher Mo): change here if the mailbox changes */

  function reqText() {
    const type = ($('#reqType') && $('#reqType').value) || 'Other';
    const subj = ($('#reqSubj') && $('#reqSubj').value.trim()) || '';
    const body = ($('#reqBody') && $('#reqBody').value.trim()) || '';
    const me = currentUser() || {};
    return '[SPR] ' + (subj || type) + '\n\nType: ' + type +
      '\n\n' + (body || '(no details given)') +
      '\n\n---\nFrom: ' + (me.name || me.username || 'unknown') + ' (' + roleLabel(me.role) + ')' +
      '\nScreen: ' + (location.hash || '#/') +
      '\nBuild: ' + (window.SPR_BUILD || 'unknown') +
      '\nSent: ' + new Date().toLocaleString();
  }
  function reqMailto() {
    const subj = ($('#reqSubj') && $('#reqSubj').value.trim()) || (($('#reqType') && $('#reqType').value) || 'SPR request');
    return 'mailto:' + OWNER_EMAIL + '?subject=' + encodeURIComponent('[SPR] ' + subj) + '&body=' + encodeURIComponent(reqText());
  }
  function helpContentHtml() {
    const MANUAL = '/media/manual/SPR-with-Mo_Teachers-Operation-Manual.pdf';
    const VIDEO = '/media/manual/SPR-with-Mo_Teacher-Video-Guide.mp4';
    const mod = (t, steps) => '<details class="help-mod"><summary>' + t + '</summary><ol class="small" style="margin:8px 0 2px;padding-left:20px;line-height:1.7">' +
      steps.map((x) => '<li>' + x + '</li>').join('') + '</ol></details>';
    return '<div class="panel"><b>Training modules</b> <span class="small muted">Tap a topic to open it. The illustrated 30-page manual and the 4-minute video guide cover every screen step by step.</span>' +
      '<div class="flex" style="margin-top:8px">' +
        '<a class="btn sm" href="' + MANUAL + '" target="_blank" rel="noopener">Open the manual (PDF)</a>' +
        '<a class="btn sm" href="' + VIDEO + '" target="_blank" rel="noopener">Watch the video guide</a>' +
      '</div>' +
      '<video controls preload="none" src="' + VIDEO + '" style="width:100%;max-width:640px;margin-top:10px;border-radius:8px;background:#000;display:block"></video>' +
      mod('1. Set up a class', [
        'Manage &amp; setup &rarr; <b>New class / semester</b>: pick the year, term months, school and class name.',
        'Add students on the <b>Students</b> tab: type them one by one, or expand <b>Paste many students</b> and paste a whole roster (one per line: ID, Chinese name, English name, Gender).',
        'Already keep a paper or Excel SPR workbook? <b>Import SPR Excel</b> reads it straight in: one file per class.',
      ]) +
      mod('2. Day to day: observations, spelling and daily scores', [
        '<b>Enter scores</b> is the everyday screen: observations, spelling and daily marks for the chosen month.',
        'With <b>auto-fill totals</b> on (Manage &amp; setup &rarr; Settings), typing a score fills in its total automatically.',
        'Everything saves to this browser as you type: the small dot in the sidebar confirms each save.',
      ]) +
      mod('3. Grading and report cards', [
        '<b>Grading</b> turns the raw marks into grades with a class overview.',
        '<b>Report Cards</b> builds each pupil&rsquo;s card and prints on one A4 page; add your own wording or start from the suggested comments.',
        'A grade stays provisional until enough work is assessed: the 6-of-9 rule decides when a final grade appears.',
      ]) +
      mod('4. Share a class with a co-teacher', [
        'Manage &amp; setup &rarr; <b>Share &amp; sync</b>: pick the class, press <b>Save &amp; Share</b>, send the link or QR code to your co-teacher.',
        'Data is encrypted before upload: the cloud never sees names or scores in the clear.',
        'Discipline: <b>pull before you start, push when you finish</b>. Last save wins; the app warns if a newer copy exists.',
      ]) +
      mod('5. Backups and moving to another computer', [
        'Manage &amp; setup &rarr; <b>Download full backup (all semesters)</b>: one file with everything. Keep it in approved storage only (it is unencrypted).',
        'On the new computer: sign in, then <b>Restore backup</b> and pick the file.',
        'The app also keeps automatic <b>safety copies</b> before data gets replaced: restore them from Manage &amp; setup.',
      ]) +
      mod('6. Sign-ins and passwords', [
        'Change your own password: Manage &amp; setup &rarr; <b>Change my password</b>.',
        'Forgot it? The administrator resets it for you: <b>Users</b> (or Manage &amp; setup &rarr; Sign-ins on this device) &rarr; <b>Reset password</b>.',
        'Admins: set a <b>master password</b> once: from the sign-in screen it can recover the admin account if that password is ever forgotten.',
      ]) +
      '</div>' +
      '<div class="panel" style="margin-top:12px"><b>Raise a request to the administrator</b> <span class="small muted">Something broken, a feature idea, or an account or password problem. The request goes straight to Teacher Mo (the site owner); fixes usually ship within a day.</span>' +
      '<div class="req-box" style="max-width:640px">' +
        '<label style="display:block;margin-top:10px;font-size:13px">What is it about? <select class="inp" id="reqType" style="width:100%;margin-top:4px">' +
          ['Something is broken', 'I need help using a screen', 'Feature idea', 'Password or account help', 'Other'].map((t) => '<option>' + t + '</option>').join('') + '</select></label>' +
        '<label style="display:block;margin-top:10px;font-size:13px">Short summary <input class="inp" id="reqSubj" style="width:100%;margin-top:4px" placeholder="e.g. Spelling total does not auto-fill in March" maxlength="120"></label>' +
        '<label style="display:block;margin-top:10px;font-size:13px">Details: what did you do, what happened, what did you expect? <textarea class="inp" id="reqBody" rows="5" style="width:100%;margin-top:4px" placeholder="Write in English or Chinese. Your name, screen and app version are added automatically."></textarea></label>' +
        '<div class="flex" style="margin-top:12px">' +
          '<button class="btn primary" data-action="req-email">Send by email</button>' +
          '<button class="btn" data-action="req-copy">Copy request text</button>' +
          '<span class="small muted" style="align-self:center">&ldquo;Copy request text&rdquo; is for WeChat / DingTalk: paste it into your chat with Teacher Mo.</span>' +
        '</div>' +
        '<p class="small muted" style="margin:8px 0 0">Before experimenting with data: download a full backup first (Manage &amp; setup). Your request text stays on this screen until you send it: nothing is uploaded by itself.</p>' +
      '</div></div>';
  }
  function renderHelp() {
    if ($('#content')) {
      $('#content').innerHTML = pageHead('Help & training', 'guides, manuals and a direct line to the administrator') + helpContentHtml();
      window.scrollTo(0, 0);
      return;
    }
    /* self-contained: the chooser screen has no shell — draw the whole page */
    $('#app').innerHTML = '<div class="app"><main class="page" style="max-width:980px;margin:0 auto;width:100%">' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        '<a class="btn" href="' + (sprMode() !== 'class' ? '#/dashboard' : '#/classes') + '" style="font-size:11.5px;padding:5px 12px">&larr; Back to the app</a>' +
        '<button class="uc-out" data-action="logout" style="font-size:11.5px;padding:5px 12px">Sign out</button></div>' +
      pageHead('Help & training', 'guides, manuals and a direct line to the administrator') +
      helpContentHtml() +
      '</main></div>';
    window.scrollTo(0, 0);
  }

  function renderManage() {
    const sem = cur();
    const st = DB.settings;
    if (sprMode() === 'class' && !CLS) {
      /* no class open on this device: no shell exists yet, so draw the whole
         page (like renderUsers) with just the admin Advanced panel: a stuck
         admin still reaches Start fresh / restore / pull tools here */
      $('#app').innerHTML = '<div class="app"><main class="page" style="max-width:980px;margin:0 auto;width:100%">' +
        '<div class="flex" style="justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
          (dsOn() ? '<button class="uc-out" data-action="ds-now" style="font-size:11.5px;padding:5px 12px">Check for newer copy</button>' : '') +
          '<button class="uc-out" data-action="privacy-open" style="font-size:11.5px;padding:5px 12px">Privacy &amp; data notice</button>' +
          '<button class="uc-out" data-action="logout" style="font-size:11.5px;padding:5px 12px">Sign out</button>' +
        '</div>' +
        pageHead('Manage & setup', 'setup, pairing and recovery tools') +
        renderClassesAdvanced(classIndex(), false) +
        '<input type="file" id="file-roster" accept=".csv,text/csv" hidden>' +
        '</main></div>';
      window.scrollTo(0, 0);
      return;
    }
    /* non-admin (both modes): Manage holds ONE thing — the password card
       (2026-10-25; extended to legacy mode 2026-10-27). Setup/pairing/admin
       tools: wizard, Excel import/export, backups, data reset: stay out of
       teachers' reach; students live on the Students tab. */
    if (classRole((currentUser() || {}).role) !== 'admin') {
      $('#content').innerHTML = pageHead('Manage & setup', 'your account') +
        '<div class="panel" style="max-width:620px">' +
        '<h3 style="font-family:var(--font-display);margin:0 0 8px">Your account</h3>' +
        '<p class="small muted" style="margin:0 0 12px">Change your own sign-in password. Everything else here is for the admin; students are managed on the Students tab.</p>' +
        '<button class="btn primary" data-action="change-pass-open">Change my password</button>' +
        '<p class="small muted" style="margin:10px 0 0">Forgot your password? Ask your administrator (Teacher Mo) to reset it: <b>Users &rarr; Reset password</b>. Step-by-step: <a href="#/help">Help &amp; training</a>, module 6.</p></div>';
      window.scrollTo(0, 0);
      return;
    }
    $('#content').innerHTML = pageHead('Manage & setup', 'classes, students and data') +
      '<div class="flex mb">' +
        '<button class="btn primary" data-action="wiz-open">New class / semester</button>' +
        '<button class="btn" data-action="import-xlsx">Import SPR Excel</button>' +
        '<button class="btn" data-action="export-xlsx">Export current semester to Excel</button>' +
        '<button class="btn" data-action="backup">Download full backup (all semesters)</button>' +
        '<span class="small muted" style="align-self:center">' + (function () {
          const DAY = 86400000, last = DB.settings.lastBackupAt || 0;
          if (!last) return 'No backup downloaded yet.';
          const d = Math.round((Date.now() - last) / DAY);
          return 'Last backup: ' + (d === 0 ? 'today' : d + ' day' + (d === 1 ? '' : 's') + ' ago');
        })() + '</span>' +
        '<button class="btn" data-action="restore">Restore backup</button>' +
      '</div>' +
      '<p class="small muted" style="margin:-6px 0 18px">Excel export = one semester, for reports &amp; printing. Full backup = every semester + settings, to move to another computer or keep safe (the file is <b>unencrypted</b>: store it only in approved storage). &ldquo;Restore backup&rdquo; loads a backup file back in.</p>' +
      (safetyBackups().length ? '<div class="p" style="margin:-6px 0 18px;border:1px solid #d8e2d8;border-radius:8px;padding:10px 14px;background:#f6faf6">' +
        '<b>Safety copies</b> <span class="small muted">Kept automatically in this browser before data gets replaced (join links, cloud copies, restores). The newest three stay listed here.</span>' +
        safetyBackups().map((b, i) => '<div class="flex" style="margin-top:6px;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<span class="small">' + new Date(b.t).toLocaleString() + ' · ' + U.esc(b.label || '') + ' · ' + ((b.db || {}).semesters || []).length + ' class(es)</span>' +
          '<button class="btn sm" data-action="sb-restore" data-i="' + i + '">Restore</button>' +
          '<button class="btn sm danger" data-action="sb-del" data-i="' + i + '">Delete</button></div>').join('') +
        '</div>' : '') +
      '<h3 style="font-family:var(--font-display);margin:6px 0 12px">Semesters</h3>' +
      DB.semesters.map(semCard).join('') +
      /* students moved to the Students tab (2026-10-25, owner request) */
      '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Settings</h3>' +
      '<div class="panel"><div class="flex">' +
        '<label><input type="checkbox" data-setf="autoTotal"' + (st.autoTotal ? ' checked' : '') + (canDo('edit.roster') ? '' : ' disabled') + '> auto-fill totals when entering a score</label>' +
        '<label>spelling total <input class="inp" type="number" data-setf="spTotal" value="' + st.spTotal + '"' + (canDo('edit.roster') ? '' : ' disabled') + ' style="width:64px"></label>' +
        '<label>daily total <input class="inp" type="number" data-setf="daTotal" value="' + st.daTotal + '"' + (canDo('edit.roster') ? '' : ' disabled') + ' style="width:64px"></label>' +
      '</div></div>' +
      '<div class="panel" style="margin-top:10px"><p class="small" style="margin-bottom:8px"><b>Help &amp; training</b>: step-by-step modules for every screen, the illustrated 30-page manual (PDF), the 4-minute video guide, and a direct request line to the administrator.</p>' +
      '<div class="flex">' +
      '<a class="btn primary" href="#/help">Open Help &amp; training</a>' +
      '<button class="btn" data-action="change-pass-open">Change my password</button></div>' +
      '<p class="small muted" style="margin-top:8px">Forgot your password? The administrator resets it: Users &rarr; <b>Reset password</b> (Help &amp; training, module 6). Before any experiment with data, use “Download full backup” below.</p></div>' +
      (reviewPanelHtml() || '') +

      ((currentUser() || {}).role === 'admin' && sprMode() === 'legacy' && DB.semesters.length ?
        '<div class="panel" style="margin-top:10px;border-color:#c9973b"><b>Per-class workbooks available</b>' +
        '<p class="small">Split this single markbook so every class gets its own key, its own teachers and its own audit log. Dry run and backup first: nothing changes until you apply.</p>' +
        '<button class="btn primary" data-action="class-migrate-open">Review migration…</button></div>' : '') +
      /* admin: dormant accounts from the default-password era are a side door until
         rotated or removed: this panel makes that visible and fixable */
      ((currentUser() || {}).role === 'admin' ?
        '<div class="panel" style="margin-top:10px"><p class="small" style="margin-bottom:8px"><b>Sign-ins on this device</b>: the accounts that can open this browser\u2019s data. <b>Admin</b> sees and controls everything; <b>Management</b> also sees the Ranking view; <b>Teachers</b> get the everyday markbook tools. Add a sign-in to give someone their own password here.</p>' +
        (getAuth().users.length ?
        '<table class="tbl"><thead><tr><th scope="col">Username</th><th scope="col">Role</th><th scope="col">Password</th><th scope="col">Any system</th><th scope="col"></th></tr></thead><tbody>' +
        getAuth().users.map((u) => {
          const legacy = u.hash === LEGACY_DEFAULT_HASH;
          const selfNow = u.username === SESSION.user;
          const dsc = dsCfg();
          const ptrOk = u.role === 'admin' ? dsOn() : !!(dsc && dsc.pointers && dsc.pointers[u.username]);
          return '<tr><td>' + U.esc(u.username) + (selfNow ? ' <span class="muted small">(you)</span>' : '') + '</td>' +
            '<td>' + roleLabel(u.role) + '</td>' +
            '<td>' + (legacy ? '<span class="g g-none">Shared default password</span>' : '<span class="g g-none">Personal password</span>') + '</td>' +
            '<td>' + (ptrOk ? '<span class="g g-ok">✓ signs in anywhere</span>' : '<span class="muted small">this device only' + (u.role === 'admin' ? '' : ': reset password to enable') + '</span>') + '</td>' +
            '<td>' + (selfNow ? '' :
              '<button class="btn sm" data-action="acct-reset-open" data-user="' + U.esc(u.username) + '">Reset password</button> ' +
              '<button class="btn sm danger" data-action="acct-del" data-user="' + U.esc(u.username) + '">Remove</button>') + '</td></tr>';
        }).join('') +
        '</tbody></table>' : '') +
        '<div class="flex" style="margin-top:10px"><button class="btn" data-action="acct-add-open">Add sign-in</button>' +
        '<span class="small muted" style="align-self:center">New sign-ins get their own password and open this same markbook: no data copying needed.</span></div>' +
        '<p class="small" style="margin:14px 0 0"><b>Persistent storage:</b> ' + (SPR_PERSIST === true ? 'granted: the browser will try not to clear SPR data when storage runs low.' : SPR_PERSIST === false ? 'not granted: the browser did not promise to keep this data, so it may remove it when space runs low: download backups regularly.' : 'checking…') + '</p>' +
      '<p class="small" style="margin:14px 0 0;border-top:1px solid rgba(127,127,127,.25);padding-top:12px">' + (masterWrap()
          ? '<b>Master password is set.</b> From the sign-in screen it can reset the admin password if that is ever forgotten. Keep it on paper: SPR cannot show it again.'
          : '<b>No master password yet.</b> Set one as a recovery key: if the admin password is ever forgotten, the master password resets it from the sign-in screen. Keep it on paper: SPR cannot show it again.') + '</p>' +
        '<div class="flex" style="margin-top:8px">' + (masterWrap()
          ? '<button class="btn sm" data-action="master-set-open">Replace master password</button> <button class="btn sm danger" data-action="master-del">Remove master password</button>'
          : '<button class="btn sm" data-action="master-set-open">Set master password</button>') + '</div></div>'
        : '') +
      ((currentUser() || {}).role === 'admin' && cryptoOK() ? dsManageCard() : '') +
      (cryptoOK() && (currentUser() || {}).role !== 'admin' && dsOn()
        ? '<div class="panel" style="margin-top:10px"><p class="small"><b>Device sync is on for this browser</b>: your changes are saved to the school&rsquo;s encrypted cloud copy automatically, and each sign-in opens the newest version. The administrator manages this channel.</p></div>'
        : '') +
      (isAdmin() ? (function () {
        const a = (DB.settings && DB.settings.schoolApproval) || {};
        return '<div class="panel" style="margin-top:10px"><p class="small" style="margin:0 0 8px"><b>School approval</b>: records that the school has approved using SPR. It appears at the bottom of the notice and travels with the full backup.</p>' +
          '<div class="flex" style="gap:8px;flex-wrap:wrap">' +
          '<input class="inp" id="ap-by" placeholder="Approved by (name and title)" style="max-width:250px" value="' + U.esc(a.by || '') + '">' +
          '<input class="inp" id="ap-date" placeholder="Date (e.g. 2026-10-28)" style="max-width:150px" value="' + U.esc(a.date || '') + '">' +
          '<input class="inp" id="ap-ref" placeholder="Reference (email subject / doc no.)" style="max-width:230px" value="' + U.esc(a.ref || '') + '">' +
          '<button class="btn sm" data-action="approval-save">Save</button></div>' +
          (a.by ? '' : '<p class="small muted" style="margin:8px 0 0">No school approval recorded yet.</p>') + '</div>';
      })() : '') +
      (sprMode() === 'class' && CLS ? auditPanelHtml(DB) : '') +
      (sprMode() === 'class' ? '' :
      '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Share &amp; sync: two teachers, one dataset</h3>' +
      (function () {
        var c = getShare();
        var canCrypto = !!subtle();
        var status = [];
        if (c.bin) status.push('bin <code>' + U.esc(c.bin) + '</code>');
        if (c.lastPush) status.push('pushed by ' + U.esc(c.lastPushBy || '?') + ' · ' + new Date(c.lastPush).toLocaleString());
        if (c.lastPull) status.push('pulled ' + new Date(c.lastPull).toLocaleString());
        var link = shareLink();
        var sb = SB();
        if (sb.url && sb.key && (c.provider === 'sb' || c.channel)) {
          var whenTxt = c.lastPush ? new Date(c.lastPush).toLocaleString() : 'never';
          return '<div class="panel">' +
            '<p class="small" style="margin-bottom:10px">Sharing <b>' + U.esc(c.shareName || 'one class') + '</b>: last saved ' + U.esc(whenTxt) + (c.lastPushBy ? ' by ' + U.esc(c.lastPushBy) : '') + '. After editing press <b>Save &amp; Share</b>; to get your co-teacher&rsquo;s newest version press <b>Open shared copy</b>. If they saved after your last sync, the app will offer it automatically. Only this one class is shared: your other classes never leave this browser.</p>' +
            '<div class="flex">' +
              '<button class="btn primary" data-action="share-push"' + (canCrypto ? '' : ' disabled title="Needs the online (https) version"') + '>Save &amp; Share</button>' +
              '<button class="btn" data-action="share-pull"' + (canCrypto ? '' : ' disabled title="Needs the online (https) version"') + '>Open shared copy</button>' +
              '<button class="btn" data-action="share-qr">Show link &amp; QR</button>' +
            '</div>' +
            (!canCrypto ? '<p class="small" style="margin-top:8px;color:#b45309">Save &amp; Share needs the online version (https). Open the website in a browser to use it.</p>' : '') +
            '</div>';
        }
        if (sb.url && sb.key) {
          var sem = cur();
          return '<div class="panel">' +
            '<p class="small" style="margin-bottom:10px">Share <b>one class</b> with a co-teacher: pick the class, press the button, then send the link or QR code it gives you. The other teacher opens it and gets that class: everything is <b>encrypted</b> before upload, so the cloud never sees your data. After every editing session, press <b>Save &amp; Share</b> again to send them the latest version.</p>' +
            '<div class="flex" style="align-items:center">' +
              '<select class="inp" id="shareSem" style="width:auto">' + DB.semesters.map((s) => '<option value="' + U.esc(s.id) + '"' + (s.id === (sem && sem.id) ? ' selected' : '') + '>' + U.esc((s.className ? s.className + ' · ' : '') + s.name) + '</option>').join('') + '</select>' +
              '<input class="inp" id="shareName" placeholder="Name shown to your co-teacher" style="width:250px" value="' + U.esc((sem && ((sem.className ? sem.className + ' · ' : '') + sem.name)) || 'My class') + '">' +
              '<button class="btn primary" data-action="share-create"' + (canCrypto ? '' : ' disabled title="Needs the online (https) version"') + '>Save &amp; Share</button>' +
            '</div>' +
            (status.length ? '<p class="small" style="margin-top:8px">' + status.join(' · ') + '</p>' : '') +
            (!canCrypto ? '<p class="small" style="margin-top:8px;color:#b45309">Save &amp; Share needs the online version (https).</p>' : '') +
            '</div>';
        }
        return '<div class="panel">' +
          '<p class="small" style="margin-bottom:10px"><b>Save &amp; Share is being set up</b> (one-time, by the administrator: see the note in Manage &amp; setup once configured): pick the class, Push after editing; your co-teacher presses Pull (or re-opens their link). Last save wins: pull before you start, push when you finish.</p>' +
          '' + U.esc(c.bin || '') + '">' +
            '<button class="btn" data-action="share-save">Save bin ID</button>' +
            '<button class="btn primary" data-action="share-push"' + (canCrypto ? '' : ' disabled title="Needs the online (https) version"') + '>Push to cloud</button>' +
            '<button class="btn" data-action="share-pull"' + (canCrypto ? '' : ' disabled title="Needs the online (https) version"') + '>Pull from cloud</button>' +
          '</div>' +
          (link ? '<div class="flex mt" style="align-items:center"><input class="inp" id="shareLink" readonly style="flex:1;min-width:260px;font-size:12px" value="' + U.esc(link) + '"><button class="btn" data-action="share-copy">Copy share link</button></div>' +
            '<p class="small" style="margin-top:6px">Anyone with this link can read and edit the class data: send it only to your co-teacher.</p>' : '') +
          (status.length ? '<p class="small" style="margin-top:8px">' + status.join(' · ') + '</p>' : '') +
          (!canCrypto ? '<p class="small" style="margin-top:8px;color:#b45309">Share &amp; sync needs the online version (https). Open the website in a browser to use it.</p>' : '') +
          '</div>';
      })()) +
      (isAdmin() ?
      (sprMode() !== 'class' ? '<div class="panel" style="margin-top:10px;border-color:#d8b0a6"><p class="small" style="margin:0"><b>Shared-markbook mode.</b> Every sign-in created here opens this same markbook: all students, all classes. If teachers should each get their own class with only their students, set their device up in class mode instead (one class device per classroom).</p></div>' : '') +
      '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Data: administrator only</h3>' +
      '<div class="flex">' +
        '<button class="btn danger-solid" data-action="load-sample">Reset to sample data</button>' +
        (window.__SPR_CORRUPT ? '<button class="btn" data-action="dl-corrupt">Download damaged data file</button>' : '') +
      '</div>' +
      '<p class="small muted" style="margin-top:8px;max-width:640px">Replaces every class, student and score in this browser with the demo semester. Real data is gone from this device (a cloud copy for sharing, if any, is <b>not</b> removed: overwrite it by pushing fresh data). A safety copy is kept automatically and can be restored from “Backups” below.</p>'
      : '') +
      '<input type="file" id="file-xlsx" accept=".xlsx,.xls" multiple hidden>' +
      '<input type="file" id="file-json" accept=".json" hidden>' +
      ((classRole((currentUser() || {}).role) === 'admin')
        ? renderClassesAdvanced(classIndex(), sprMode() === 'legacy' && DB && DB.semesters && DB.semesters.length) +
          '<input type="file" id="file-roster" accept=".csv,text/csv" hidden>' +
          '<input type="file" id="file-restore-all" accept=".json,application/json" hidden>'
        : '');
  }
  function rosterAdd() {
    const sem = cur();
    const id = ($('#ro-id').value.trim() || ('STU-' + String(sem.students.length + 1).padStart(3, '0')))
      .replace(/[^A-Za-z0-9_\-]/g, '-').slice(0, 40);
    const cn = $('#ro-cn').value.trim(), en = $('#ro-en').value.trim();
    if (!cn && !en) { toast('Enter at least one name', true); return; }
    if (sem.students.some((s) => s.id === id)) { toast('ID already used: ' + id, true); return; }
    sem.students.push({ id: id, nameCn: cn, nameEn: en, gender: U.normGender($('#ro-g').value) });
    saveDB(); renderManage(); toast((en || cn) + ' added');
  }
  function rosterBulk() {
    const sem = cur();
    const list = parseRosterPaste($('#ro-paste').value);
    if (!list.length) { toast('Nothing to add', true); return; }
    let added = 0;
    for (const s of list) if (!sem.students.some((x) => x.id === s.id)) { sem.students.push(s); added++; }
    saveDB(); renderManage(); toast(added + ' students added');
  }

  /* ============================ comparative analysis ============================ */
  const RAG_HEX = { G: '#1d7a4a', A: '#c9973b', R: '#c4453c' };
  function ragChip(code, label) {
    if (!code) return '<span class="g g-none">–</span>';
    return '<span class="rag-chip ' + code + '"><span class="dotrag ' + code + '"></span>' + (label || A.RAG_NAME[code]) + '</span>';
  }
  function dSpan(d) {
    if (d === null || d === undefined) return '<span class="muted">–</span>';
    if (d > 1) return '<span class="delta-up">+' + A.f1(d) + '</span>';
    if (d < -1) return '<span class="delta-down">' + A.f1(d) + '</span>';
    return '<span class="muted">·</span>';
  }
  function anFindingsPanel(sid) {
    const sw = A.swot(DB, sid);
    if (!sw) return '';
    if (sw.provisionalStub) {
      /* below the evidence gate: no RAG, no SWOT, no conclusions — just the fact */
      return '<div class="panel mb"><h3>Findings</h3>' +
        '<div class="panel-sub">' + U.esc(sw.last.semName) + ' · assessment in progress</div>' +
        '<div class="remark-box mt" style="border-left-color:#9aa0a0">' + U.esc(sw.remark) + '</div></div>';
    }
    return '<div class="panel mb"><h3>Findings: RAG &amp; SWOT (auto-generated)</h3>' +
      '<div class="panel-sub">' + U.esc(sw.last.semName) + (sw.provisional ? ' · provisional (' + sw.last.assessed + '/9)' : '') + ' · overall ' + ragChip(sw.overallRag) +
      ' <button class="btn sm" data-action="rag-why" data-sid="' + U.esc(sid) + '">Why?</button>' +
      ' · trend vs ' + U.esc(sw.prev ? sw.prev.semName : '—') + ' ' + dSpan(sw.delta) + '</div>' +
      '<div class="swot-grid" style="margin-top:10px">' +
        '<div class="swot-cell s"><h4>Strengths</h4><ul>' + sw.strengths.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
        '<div class="swot-cell w"><h4>Weaknesses</h4><ul>' + sw.weaknesses.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
        '<div class="swot-cell o"><h4>Opportunities</h4><ul>' + (sw.opportunities.length ? sw.opportunities.map((x) => '<li>' + U.esc(x) + '</li>').join('') : '<li>Close to the next band in several parts: keep pushing.</li>') + '</ul></div>' +
        '<div class="swot-cell t"><h4>Threats / concerns</h4><ul>' + sw.threats.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
      '</div>' +
      '<div class="remark-box mt">' + U.esc(sw.remark) + '</div></div>';
  }
  function renderAnalysis() {
    const n = DB.semesters.length;
    const mode = ui.anMode || 'class';
    const tabs = '<div class="tabs">' +
      '<a class="tab' + (mode === 'class' ? ' on' : '') + '" data-accent="gr" href="#/analysis/class">Class progress</a>' +
      '<a class="tab' + (mode === 'student' ? ' on' : '') + '" data-accent="obs" href="#/analysis/student">Student deep-dive</a></div>';
    let body = '';
    if (n === 0) body = '<div class="empty"><div class="big">No semesters yet</div><p>Import an SPR file or set up a class first.</p></div>';
    else if (mode === 'student') body = anStudentView();
    else body = anClassView();
    $('#content').innerHTML = pageHead('Comparative analysis', n + (n === 1 ? ' semester' : ' semesters') +
      (n > 1 ? ': comparing ' + U.esc(DB.semesters[0].name) + ' → ' + U.esc(DB.semesters[n - 1].name) : ': import a second SPR to compare progress'),
      '<button class="btn" data-action="print">Print</button>') + tabs + body;
    anCharts();
  }
  function anClassView() {
    const rows = A.classSemesterRows(DB);
    const mv = A.movers(DB);
    const sum = A.classSummary(DB);
    const single = DB.semesters.length < 2;
    let moversHtml = '<p class="muted small">Import at least two semesters to see who improved and who slipped.</p>';
    if (mv && mv.list.length) {
      const up = mv.list.filter((m) => m.delta > 1).length, down = mv.list.filter((m) => m.delta < -1).length;
      moversHtml =
        '<div class="kpi-strip">' +
        kpi(up, 'students improved', false) + kpi(down, 'students slipped', down > up) +
        kpi(A.f1(mean(mv.list.map((m) => m.delta))), 'average change (pts)') +
        '</div><div class="chart-box" style="height:' + Math.max(200, mv.list.length * 19) + 'px;margin-top:12px"><canvas id="ch-movers"></canvas></div>';
    }
    const matrix = '<div class="sheet"><table class="tbl matrix"><thead><tr><th>Semester</th>' +
      A.COMPONENTS.map((k) => '<th class="c">' + A.SHORT[k] + '</th>').join('') +
      '<th class="num">Final</th><th class="c">RAG</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + U.esc(r.semName) + '</td>' +
        A.COMPONENTS.map((k) => '<td class="c"><span class="dotrag ' + A.rag(r.parts[k]) + '"></span>' + A.f1(r.parts[k]) + '</td>').join('') +
        '<td class="num"><b>' + A.f1(r.final) + '</b></td><td class="c">' + ragChip(A.rag(r.final)) + '</td></tr>').join('') +
      '</tbody></table></div>';
    return '<div class="grid-2">' +
        '<div class="panel"><h3>Class average across semesters</h3><div class="panel-sub">final · observations · spelling · daily · written</div>' +
          '<div class="chart-box" style="height:260px"><canvas id="ch-anTrend"></canvas></div></div>' +
        '<div class="panel"><h3>Grade distribution per semester</h3><div class="panel-sub">A* → U counts</div>' +
          '<div class="chart-box" style="height:260px"><canvas id="ch-anDist"></canvas></div></div>' +
      '</div>' +
      '<div class="panel mt"><h3>' + (single ? 'Component averages' : 'Progress by component (RAG)') + '</h3>' +
        '<div class="panel-sub">green ≥ 75 · amber 55–74.9 · red &lt; 55</div>' + matrix + '</div>' +
      '<div class="panel mt"><h3>Movers: ' + (mv ? U.esc(mv.from) + ' → ' + U.esc(mv.to) : '') + '</h3>' +
        '<div class="panel-sub">change in weighted final per student</div>' + moversHtml + '</div>' +
      (sum ? '<div class="panel mt"><h3>Class summary</h3><div class="remark-box">' + U.esc(A.classSwotText(DB)) + '</div></div>' : '');
  }
  function anStudentView() {
    const map = new Map();
    for (let i = DB.semesters.length - 1; i >= 0; i--) {
      for (const s of DB.semesters[i].students) {
        if (!map.has(s.id)) map.set(s.id, { id: s.id, name: (s.nameEn || s.nameCn) + (s.nameCn && s.nameEn ? ' ' + s.nameCn : ''), cnt: 0 });
      }
    }
    for (const x of DB.semesters) for (const s of x.students) if (map.has(s.id)) map.get(s.id).cnt++;
    const candidates = Array.from(map.values());
    if (!ui.anStu || !candidates.some((c) => c.id === ui.anStu)) ui.anStu = candidates.length ? candidates[0].id : null;
    if (!ui.anStu) return '<div class="empty"><div class="big">No students</div></div>';
    const sid = ui.anStu;
    const rows = A.studentSemesterRows(DB, sid);
    const last = rows[rows.length - 1];
    const sw = A.swot(DB, sid);
    const stu = DB.semesters.find((x) => x.id === last.semId).students.find((x) => x.id === sid);
    const labels = rows.map((r) => r.semName);
    const matrix = A.studentMatrix(DB, sid);
    const matrixHtml = '<div class="sheet"><table class="tbl matrix"><thead><tr><th>Component</th>' +
      labels.map((l) => '<th class="c">' + U.esc(l) + '</th>').join('') +
      (labels.length > 1 ? '<th class="c">Δ latest</th>' : '') + '<th class="c">RAG</th></tr></thead><tbody>' +
      matrix.map((row) => '<tr><td>' + row.key + '</td>' +
        row.values.map((v) => '<td class="c"><span class="dotrag ' + A.rag(v) + '"></span>' + A.f1(v) + '</td>').join('') +
        (labels.length > 1 ? '<td class="c">' + dSpan(row.delta) + '</td>' : '') +
        '<td class="c">' + ragChip(A.rag(row.values[row.values.length - 1])) + '</td></tr>').join('') +
      '</tbody></table></div>';
    const stuSel = '<div class="sheet-toolbar"><div class="flex" style="width:100%;justify-content:flex-end">' +
      '<label>Student <select class="inp" id="anStu">' + candidates.map((c) =>
        '<option value="' + U.esc(c.id) + '"' + (c.id === sid ? ' selected' : '') + '>' + U.esc(c.name) +
        (DB.semesters.length > 1 && c.cnt > 1 ? ': ' + c.cnt + ' semesters' : '') + '</option>').join('') + '</select></label></div></div>';
    return stuSel +
      '<div class="profile-head"><div class="stu-id-block"><div class="avatar">' + U.esc((stu.nameCn || stu.nameEn || '?').charAt(0)) + '</div>' +
      '<div><div class="stu-name">' + U.esc(stu.nameEn || stu.nameCn) + '</div>' +
      '<div class="stu-meta">' + U.esc(stu.nameCn || '') + ' · ID ' + U.esc(sid) + ' · ' + rows.length + ' ' + (rows.length === 1 ? 'semester' : 'semesters') + ' of data</div></div></div>' +
      '<div class="flex" style="align-items:center;gap:22px">' +
        '<div class="right"><div class="final-num">' + (last.assessed >= C.FINAL_MIN_ASSESSED ? A.f1(last.final) : '–') + '</div><div class="small muted">' + U.esc(last.semName) + (last.assessed >= C.FINAL_MIN_ASSESSED ? ' final' : ' · ' + last.assessed + '/9 assessed') + '</div></div>' +
        (rows.length > 1 ? '<div class="right"><div class="final-num" style="font-size:26px">' + dSpan(sw.delta) + '</div><div class="small muted">vs ' + U.esc(sw.prev.semName) + '</div></div>' : '') +
        (last.rank ? '<div class="right"><div class="final-num" style="font-size:26px">' + last.rank + '<span class="small muted">/' + last.total + (last.rankProvisional ? ' · prov.' : '') + '</span></div><div class="small muted">rank' + (last.rankProvisional ? ' (provisional)' : '') + '</div></div>' : '') +
        (sw.provisionalStub
          ? '<div class="stamp prov"><small>ASSESSMENT</small>In progress</div>'
          : '<div class="stamp' + (sw.provisional ? ' prov' : '') + '" style="color:' + (RAG_HEX[sw.overallRag] || '#9aa0a0') + '"><small>' + (sw.provisional ? 'PROVISIONAL' : (sw.ragName || 'RAG').toUpperCase()) + '</small>' + (sw.ragName || '–') + '</div>') +
      '</div></div>' +
      '<div class="grid-2">' +
        '<div class="panel"><h3>Final score trajectory</h3><div class="panel-sub">student vs class average</div><div class="chart-box" style="height:250px"><canvas id="ch-anStu"></canvas></div></div>' +
        '<div class="panel"><h3>' + (rows.length > 1 ? 'Latest vs previous semester' : 'Current semester') + '</h3><div class="panel-sub">all nine components (%)</div><div class="chart-box" style="height:250px"><canvas id="ch-anRadar"></canvas></div></div>' +
      '</div>' +
      '<div class="panel mt"><h3>Progress matrix</h3><div class="panel-sub">component × semester, RAG-coded, with semester-over-semester change</div>' + matrixHtml + '</div>' +
      anFindingsPanel(sid) +
      '<div class="print-only quote-inline">Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)</div>';
  }
  function anCharts() {
    const mode = ui.anMode || 'class';
    if (mode === 'class') {
      const rows = A.classSemesterRows(DB);
      const labels = rows.map((r) => r.semName);
      if (document.getElementById('ch-anTrend')) mkChart('ch-anTrend', { type: 'line',
        data: { labels: labels, datasets: [
          ds('Final', rows.map((r) => r1x(r.final)), '#22312c', { borderWidth: 3 }),
          ds('Observations', rows.map((r) => r1x(r.obsAvg)), COLORS.obs),
          ds('Spelling', rows.map((r) => r1x(r.parts.Spelling)), COLORS.sp),
          ds('Daily', rows.map((r) => r1x(r.parts['Daily Assignments'])), COLORS.da),
          ds('Written', rows.map((r) => r1x(r.parts.Written)), '#b2683f'),
        ] }, options: lineOpts(0, 100) });
      if (document.getElementById('ch-anDist')) {
        const gl = ['A*', 'A', 'B', 'C', 'D', 'U'];
        mkChart('ch-anDist', { type: 'bar',
          data: { labels: labels, datasets: gl.map((g) => ({ label: g, data: rows.map((r) => r.dist[g]), backgroundColor: GRADE_HEX[g] })) },
          options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } } } });
      }
      const mv = A.movers(DB);
      if (mv && mv.list.length && document.getElementById('ch-movers')) {
        const list = mv.list.slice().reverse();
        mkChart('ch-movers', { type: 'bar',
          data: { labels: list.map((m) => m.name), datasets: [{ data: list.map((m) => r1x(m.delta)),
            backgroundColor: list.map((m) => m.delta > 1 ? '#1d7a4a' : m.delta < -1 ? '#c4453c' : '#c9973b') }] },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            scales: { x: { ticks: { callback: (v) => (v > 0 ? '+' : '') + v } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.parsed.x > 0 ? '+' : '') + c.parsed.x + ' pts' } } } } });
      }
    } else {
      const sid = ui.anStu;
      if (!sid) return;
      const rows = A.studentSemesterRows(DB, sid);
      const clsRows = A.classSemesterRows(DB).filter((r) => rows.some((x) => x.semId === r.semId));
      if (document.getElementById('ch-anStu')) mkChart('ch-anStu', { type: 'line',
        data: { labels: rows.map((r) => r.semName), datasets: [
          ds('Student final', rows.map((r) => r1x(r.final)), '#2d5fa8', { borderWidth: 3 }),
          ds('Class average', clsRows.map((r) => r1x(r.final)), '#9aa79f', { borderDash: [5, 4], pointRadius: 0, backgroundColor: 'transparent' }),
        ] }, options: lineOpts(0, 100) });
      if (document.getElementById('ch-anRadar')) {
        const last = rows[rows.length - 1], prev = rows[rows.length - 2] || null;
        const sets = [{ label: last.semName, data: A.COMPONENTS.map((k) => r1x(last.parts[k])), borderColor: '#2d5fa8', backgroundColor: 'rgba(45,95,168,0.15)', pointRadius: 3 }];
        if (prev) sets.push({ label: prev.semName, data: A.COMPONENTS.map((k) => r1x(prev.parts[k])), borderColor: '#c9973b', backgroundColor: 'rgba(201,151,59,0.10)', pointRadius: 3 });
        mkChart('ch-anRadar', { type: 'radar', data: { labels: A.COMPONENTS.map((k) => A.SHORT[k]), datasets: sets },
          options: { responsive: true, maintainAspectRatio: false,
            scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, backdropColor: 'transparent' } } },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } } } } });
      }
    }
  }

  /* ============================ report cards ============================ */
  function renderReports() {
    const sem = cur();
    const n = DB.semesters.length;
    const mode = ui.rptMode || 'class';
    const tabs = '<div class="tabs">' +
      '<a class="tab' + (mode === 'class' ? ' on' : '') + '" data-accent="gr" href="#/reports/class">Class report</a>' +
      '<a class="tab' + (mode === 'student' ? ' on' : '') + '" data-accent="obs" href="#/reports/student">Student report cards</a></div>';
    let body = '';
    if (n === 0) body = '<div class="empty"><div class="big">No semesters yet</div><p>Import an SPR file first.</p></div>';
    else if (mode === 'student') body = rptStudentPicker(sem);
    else body = rptClassView(sem);
    $('#content').innerHTML = pageHead('Report Cards', 'download, print or share: every card carries your credit',
      '<button class="btn" data-action="print">Print</button>') + tabs + body;
  }

  function rptClassView(sem) {
    const dist = C.gradeDistribution(sem);
    const comp = C.completeness(sem);
    const risk = C.atRisk(sem);
    const gAll = C.gradeAll(sem);
    const top = gAll.filter(gateOk).sort((a, b) => b.final - a.final).slice(0, 5); /* evidence gate */
    return '<div class="kpi-strip">' +
        kpi(fmt(C.classFinalAvg(sem), 1), 'class average', false) +
        kpi(dist['A*'] + '/' + sem.students.length, 'grade A*') +
        kpi(risk.length, 'need attention', risk.length > 0) +
      '</div>' +
      '<div class="grid-2">' +
        '<div class="panel"><h3>Grade distribution</h3><div class="panel-sub">A* → U</div>' +
          '<div class="chart-box" style="height:220px"><canvas id="ch-rptDist"></canvas></div></div>' +
        '<div class="panel"><h3>Recording status</h3><div class="panel-sub">data completeness</div>' +
          '<table class="tbl"><tbody>' +
            ['Observations', 'Spelling', 'Daily', 'Tests'].map((l, i) => {
              const k = ['obs', 'spelling', 'daily', 'tests'][i];
              const p = Math.round(comp[k] * 100);
              return '<tr><td>' + l + '</td><td class="num">' + p + '%</td>' +
                '<td style="width:50%"><div class="comp-bar"><i style="width:' + p + '%;background:' + (p >= 85 ? '#10b981' : p >= 50 ? '#f59e0b' : '#ef4444') + '"></i></div></td></tr>';
            }).join('') +
          '</tbody></table></div>' +
      '</div>' +
      '<div class="panel mt"><h3>Top performers</h3>' +
        '<table class="tbl"><thead><tr><th>#</th><th>Student</th><th class="num">Final</th><th class="c">Grade</th></tr></thead><tbody>' +
        (top.length ? top.map((g, i) => { const s = sem.students.find((x) => x.id === g.sid);
          return '<tr><td>' + (i + 1) + '</td>' +
            '<td><a class="stu-link" href="#/report/' + U.esc(g.sid) + '">' + U.esc(s ? (s.nameEn || s.nameCn) : g.sid) + '</a></td>' +
            '<td class="num">' + fmt(g.final, 1) + '</td><td class="c">' + gBadge(g.letter) + '</td></tr>'; }).join('')
          : '<tr><td colspan="4" class="muted">Not enough assessed work yet (6 of 9 components needed for finals).</td></tr>') +
        '</tbody></table></div>' +
      '<div class="panel mt"><h3>All students</h3>' +
        '<table class="tbl"><thead><tr><th>Student</th><th class="c">Final</th><th class="c">Grade</th><th class="c">Report Card</th></tr></thead><tbody>' +
        sem.students.map((s) => { const g = C.gradeStudent(sem, s.id);
          return '<tr><td>' + U.esc(s.nameEn || s.nameCn) + ' <span class="muted small">' + U.esc(s.nameCn || '') + '</span></td>' +
            '<td class="num">' + (gateOk(g) ? fmt(g.final, 1) + (gateFinal(g) ? '' : ' <span class="small muted">P' + nOf9(g) + '/9</span>') : '<span class="small muted">' + nOf9(g) + '/9</span>') + '</td><td class="c">' + gradeCell(g) + '</td>' +
            '<td class="c"><a class="btn sm" href="#/report/' + U.esc(s.id) + '">View card</a></td></tr>'; }).join('') +
        '</tbody></table></div>' +
      '<div class="flex mt" style="justify-content:center;gap:16px">' +
        '<button class="btn primary" data-action="dl-class-report">Download Class Report (Excel)</button>' +
        '<button class="btn" data-action="dl-all-cards">Download All Report Cards (Excel)</button>' +
      '</div>';
  }

  function rptStudentPicker(sem) {
    return '<div class="sheet-toolbar"><div class="flex" style="width:100%">' +
      '<label>Student <select class="inp" id="rptStu">' +
      sem.students.map((s) => '<option value="' + U.esc(s.id) + '">' + U.esc(s.nameEn || s.nameCn) + ' ' + U.esc(s.nameCn || '') + '</option>').join('') +
      '</select></label>' +
      '<button class="btn primary" data-action="view-card">View Report Card</button>' +
      '<button class="btn" data-action="dl-one-card">Download (Excel)</button>' +
      '</div></div>' +
      '<div class="empty"><div class="big">Select a student above</div><p>Choose a student and click "View Report Card" to preview, print, or download their individual card.</p></div>';
  }

  function reportSectionsFinal(sem, sid, sections) {
    /* merge teacher edits (sem.reportNotes) over the generated sections */
    const notes = (sem.reportNotes || {})[sid] || {};
    const gen = sections;
    const val = (field, generated) => (notes[field] !== undefined && notes[field] !== '' ? notes[field] : generated);
    const genList = (field, items) => (notes[field] !== undefined && notes[field] !== '' ? [{ k: '', text: notes[field], evidence: '' }] : items);
    return {
      strengths: genList('strengths', gen.strengths),
      steps: genList('steps', gen.steps),
      support: val('support', gen.support),
      home: val('home', gen.home),
      overall: val('overall', gen.overall),
      inProgress: gen.inProgress,
      note: gen.note,
      edited: !!(notes.strengths || notes.steps || notes.support || notes.home || notes.overall),
    };
  }

  function renderReportCard(sid) {
    const sem = cur();
    const stu = sem.students.find((s) => s.id === sid);
    if (!stu) { location.hash = '#/reports/student'; return; }
    const g = C.gradeStudent(sem, sid);
    const ok = gateOk(g), full = gateFinal(g), n9 = nOf9(g);
    const c = C.getAssessmentCompleteness(sem, sid);
    const sections = reportSectionsFinal(sem, sid, A.reportSections(sem, sid));
    const notes = (sem.reportNotes || {})[sid] || {};
    const statusLine = ok
      ? (full ? 'Final assessment complete' : 'Provisional \u2014 ' + n9 + ' of 9 components assessed')
      : 'Not yet assessed \u2014 ' + n9 + ' of 9 components assessed';

    const componentRows = [
      ['Listening', g.skills.Listening], ['Speaking', g.skills.Speaking],
      ['Writing', g.skills.Writing], ['Reading', g.skills.Reading],
      ['Spelling', g.spelling], ['Daily Assignments', g.daily],
      ['Mid-Term', g.midterm], ['Oral', g.oral], ['Written', g.written],
    ].map(([name, val]) => {
      /* 2026-10-25 (owner request): grades only on the report card - no %,
         no per-component evidence column */
      return '<tr><td>' + name + '</td><td class="num"><b>' + (val === null ? '<span class="muted">Not yet assessed</span>' : U.esc(C.letter(val))) + '</b></td></tr>';
    }).join('');

    const secEditor = (field, label, placeholder) =>
      '<div class="panel no-print" style="padding:10px 14px"><label style="display:block;font-weight:700;font-size:12px;letter-spacing:.04em;color:var(--ink-60)">' + label + ' <span class="muted small">(editable \u2014 saved automatically)</span></label>' +
      '<textarea class="inp" rows="2" style="width:100%;margin-top:6px" data-rn="' + field + '" data-sid="' + U.esc(sid) + '" data-gen="' + U.esc(placeholder) + '" placeholder="' + U.esc(placeholder) + '">' + U.esc(notes[field] || '') + '</textarea>' +
      '<div class="mt" style="display:flex;gap:8px"><button class="btn sm" data-action="rn-reset" data-sid="' + U.esc(sid) + '" data-field="' + field + '">Reset to suggested wording</button></div></div>';

    const secList = (items) => (items.length ? '<ul>' + items.map((x) => '<li>' + U.esc(x.text) + (x.evidence ? ' <span class="muted small">(' + U.esc(x.evidence) + ')</span>' : '') + '</li>').join('') + '</ul>' : '<p class="muted small">Not enough assessed work yet to identify a reliable area.</p>');

    $('#content').innerHTML = pageHead('Report Card', U.esc(stu.nameEn || stu.nameCn || '') + ' \u00b7 ' + U.esc(sem.name),
      '<button class="btn primary" data-action="print">Print / Save PDF</button>' +
      '<button class="btn" data-action="dl-card" data-sid="' + U.esc(sid) + '">Download (Excel)</button>' +
      '<a class="btn" href="#/student/' + U.esc(sid) + '">Full profile</a>') +

      /* teacher editor (screen only, never printed) */
      '<div class="no-print" style="margin-bottom:6px">' +
        secEditor('strengths', 'STRENGTHS', sections.strengths.map((x) => x.text).join(' ')) +
        secEditor('steps', 'NEXT LEARNING STEPS', sections.steps.map((x) => x.text).join(' ')) +
        secEditor('support', 'TEACHER SUPPORT', sections.support) +
        secEditor('home', 'HOW HOME CAN HELP', sections.home) +
        secEditor('overall', 'OVERALL COMMENT', sections.overall) +
      '</div>' +

      '<div class="report-card">' +
        '<div class="rc-header">' +
          '<div class="rc-school">' + U.esc(sem.school) + '</div>' +
          '<div class="rc-title">STUDENT PERFORMANCE REPORT</div>' +
          '<div class="rc-meta">' + U.esc(sem.className) + ' \u00b7 ' + U.esc(sem.name) + '</div>' +
        '</div>' +
        '<div class="rc-stu">' +
          '<table class="tbl"><tbody>' +
            '<tr><th>Student Name</th><td>' + U.esc(stu.nameEn || '') + ' ' + U.esc(stu.nameCn || '') + '</td>' +
                '<th>Student ID</th><td>' + U.esc(stu.id) + '</td></tr>' +
            '<tr><th>Assessment status</th><td colspan="3">' + U.esc(statusLine) + '</td></tr>' +
          '</tbody></table>' +
        '</div>' +
        '<div class="rc-scores">' +
          '<h3 style="margin:8px 0 4px">Skill overview</h3>' +
          '<table class="tbl"><thead><tr><th scope="col">Component</th><th scope="col" class="num">Grade</th></tr></thead>' +
          '<tbody>' + componentRows +
          (ok
            ? '<tr class="rc-overall-row" style="border-top:2px solid var(--rule-strong)"><td><b>Overall' + (full ? '' : ' (provisional)') + '</b></td>' +
              '<td class="num"><b>' + U.esc(g.letter) + '</b></td></tr>'
            : '<tr class="rc-overall-row" style="border-top:2px solid var(--rule-strong)"><td><b>Overall</b></td><td colspan="2" class="muted">Not yet assessed \u2014 grades appear when at least 6 of 9 components are assessed</td></tr>') +
          '</tbody></table>' +
        '</div>' +
        '<div class="rc-swot">' +
          '<div class="rc-sec"><h3>Strengths</h3><div id="rc-sec-strengths">' + secList(sections.strengths) + '</div></div>' +
          '<div class="rc-sec"><h3>Next learning steps</h3><div id="rc-sec-steps">' + secList(sections.steps) + '</div></div>' +
          '<div class="rc-sec"><h3>Teacher support</h3><div id="rc-sec-support">' + (sections.support ? '<p>' + U.esc(sections.support) + '</p>' : '<p class="muted small">To be added once assessment is complete.</p>') + '</div></div>' +
          '<div class="rc-sec"><h3>How home can help</h3><div id="rc-sec-home">' + (sections.home ? '<p>' + U.esc(sections.home) + '</p>' : '<p class="muted small">Optional \u2014 added by the teacher.</p>') + '</div></div>' +
        '</div>' +
        '<div class="rc-remark"><h3>Overall comment</h3><div id="rc-sec-overall">' + (sections.overall ? '<div class="remark-box">' + U.esc(sections.overall) + '</div>' : (sections.inProgress ? '<div class="remark-box">' + U.esc(sections.note) + '</div>' : '')) + '</div></div>' +
        '<div class="rc-sign">' +
          '<div>Teacher Signature: ____________________</div>' +
          '<div>Date: ____________</div>' +
          '<div>Parent Signature: ____________________</div>' +
        '</div>' +
        '<div class="rc-credit">Designed for teachers, by a teacher \u2014 Mohammed Shehzad Khan (Teacher Mo) \u00b7 Notice v' + ((window.SPR_NOTICE || {}).version || '1') + ', ' + ((window.SPR_NOTICE || {}).date || '28 Oct 2026') + '</div>' +
      '</div>';
  }

  /* ============================ report download helpers ============================ */

  function dlClassReport() {
    const sem = cur(); if (!sem) return;
    const ws = EB.exportClassReport(sem);
    const wb = EB.stampProps(XLSX.utils.book_new(), {
      Title: [sem.className, "Student's Performance Report (SPR) class report", sem.name].filter(Boolean).join(' - '),
      Company: sem.school || 'SPR: by Teacher Mo'
    });
    XLSX.utils.book_append_sheet(wb, ws, 'Class Report');
    XLSX.writeFile(wb, sanitizeFn(sem.className + '-class-report-' + sem.name + '-by-Teacher-Mo') + '.xlsx');
    toast('Class report downloaded');
  }
  function dlAllCards() {
    const sem = cur(); if (!sem) return;
    const wb = EB.exportAllReportCards(sem, window.Analysis);
    XLSX.writeFile(wb, sanitizeFn(sem.className + '-all-report-cards-' + sem.name + '-by-Teacher-Mo') + '.xlsx');
    toast('All ' + sem.students.length + ' report cards downloaded');
  }
  function dlOneCard() {
    const sel = $('#rptStu');
    if (sel && sel.value) { dlCard(sel.value); return; }
    toast('Select a student first', true);
  }
  function dlCard(sid) {
    const sem = cur(); if (!sem || !sid) return;
    const stu = sem.students.find((s) => s.id === sid);
    if (!stu) return;
    const ws = EB.exportReportCard(sem, sid, window.Analysis);
    const wb = EB.stampProps(XLSX.utils.book_new(), {
      Title: ["Student's Performance Report (SPR) report card", (stu.nameEn || stu.nameCn), sem.name].filter(Boolean).join(' - '),
      Company: sem.school || 'SPR: by Teacher Mo'
    });
    XLSX.utils.book_append_sheet(wb, ws, 'Report Card');
    XLSX.writeFile(wb, sanitizeFn('report-card-' + (stu.nameEn || stu.nameCn) + '-' + sem.name + '-by-Teacher-Mo') + '.xlsx');
    toast('Report card downloaded for ' + (stu.nameEn || stu.nameCn));
  }

  function privacyHtml(gate) {
    return '<h3>Privacy &amp; data notice</h3>' +
      noticeSummaryHtml() +
      '<label class="small" style="display:flex;gap:8px;align-items:flex-start;margin:12px 0"><input type="checkbox" id="notice-read" style="margin-top:2px"> I have read the notice. / 我已阅读本说明。</label>' +
      '<div class="dlg-actions"><button class="btn" data-action="privacy-open-full">Read the full notice</button>' +
      '<button class="btn primary" data-action="' + (gate ? 'privacy-gate-ack' : 'dlg-close') + '" id="notice-ack-btn" disabled>' +
      (gate ? 'I understand' : 'Close') + '</button></div>';
  }
  function privacyHtmlLegacy() {
    return '<div style="display:none">' +
      '<h4>Where the data lives</h4><ul>' +
      '<li>Data lives in this browser: online, stored <b>encrypted</b> (your password opens it); the offline file version stores it unencrypted.</li>' +
      '<li><b>Nothing leaves this device unless you use Save &amp; Share</b>, which uploads an <b>encrypted</b> copy of one class to a private cloud channel (Supabase, a hosted database service). The key stays inside your share link: the cloud stores only encrypted bytes. Anyone with that full link can open the class: send it only to your co-teacher.</li>' +
      '<li>Exported files (Excel / JSON backups) are <b>not encrypted</b>. Store them only on school-approved storage, and delete them when no longer needed.</li>' +
      '<li>This website is a static page: no server of its own, no tracking. Offline-ready: after your first successful visit, SPR can reopen without an internet connection. Your student data remains stored in this browser unless you export a backup or use Share &amp; Sync / Device sync: both encrypt everything (AES-GCM) before anything leaves this browser, so the cloud only ever stores unreadable bytes.</li></ul>' +
      '<h4>Your responsibilities</h4><ul>' +
      '<li>This browser profile contains confidential student information: protect the device (screen lock, no shared accounts).</li>' +
      '<li>Backup files (JSON / Excel exports) contain full student data. Store them only on encrypted or school-approved storage, and delete them when no longer needed.</li>' +
      '<li>Avoid entering student data on shared or public computers. If unavoidable, sign out before leaving the device (the administrator can remove a sign-in via Users &rarr; Reset password).</li>' +
      '<li>Sharing student performance outside school (parents, other staff) should follow your school’s policy and applicable law (e.g. PIPL in China, GDPR elsewhere).</li></ul>' +
      '<h4>Removing data</h4><ul>' +
      '<li>The administrator can reset any password (Users &rarr; Reset password) and reset the dataset to the demo semester (Manage &amp; setup &rarr; Data): both keep automatic safety copies so nothing is lost by accident. A copy already pushed to the cloud is overwritten by pushing fresh data, or (Device sync) “Turn off &amp; delete cloud copy” in Manage.</li></ul>' +
      '<p class="small muted">Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)</p></div>' +
      '</div>';
  }
  const PRIVACY_GATE_KEY = 'spr-privacy-ack-v1';
  /* ---- the notice itself: one text, two languages, three places (2026-10-28).
     window.SPR_NOTICE is injected at build time from source/notice.en.html and
     source/notice.zh.html; the same files render the standalone notice.html. ---- */
  const NOTICE = window.SPR_NOTICE || { version: '1', date: '28 Oct 2026', en: '<p>Notice text missing from this build.</p>', zh: '<p>Notice text missing from this build.</p>' };
  let noticeLang = 'en';
  function noticeBodyHtml() {
    const en = noticeLang === 'en';
    return '<div class="flex" style="gap:8px;margin:0 0 10px">' +
        '<button class="btn sm' + (en ? ' primary' : '') + '" data-action="notice-lang" data-lang="en">English</button>' +
        '<button class="btn sm' + (!en ? ' primary' : '') + '" data-action="notice-lang" data-lang="zh">中文</button></div>' +
      '<div class="privacy-body">' + (en ? NOTICE.en : NOTICE.zh) +
      '<p class="small muted" style="margin-top:14px">' + schoolApprovalLine() + '</p>' +
      '<p class="small muted" style="margin-top:6px">Notice v' + NOTICE.version + ', ' + NOTICE.date + '.</p></div>';
  }
  function schoolApprovalLine() {
    const a = (DB.settings && DB.settings.schoolApproval) || null;
    if (a && a.by) return 'Use of SPR at this school was approved by ' + U.esc(a.by) +
      (a.date ? ' on ' + U.esc(a.date) : '') + (a.ref ? ' (ref: ' + U.esc(a.ref) + ')' : '') + '.';
    if (isAdmin()) return 'No school approval recorded yet. Admins can add it in Manage &amp; setup.';
    return 'The school approval record is kept by the administrator.';
  }
  function noticeSummaryHtml() {
    return '<h3>About SPR and your student data</h3>' +
      '<div class="privacy-body"><ul>' +
      '<li>Student data stays <b>in this browser</b> on this device, encrypted with your password.</li>' +
      '<li><b>Nothing is sent anywhere</b> unless an admin turns on Device sync or someone uses Save &amp; Share. Then an encrypted copy goes to Supabase.</li>' +
      '<li>Exported Excel and backup files are <b>not encrypted</b>. Keep them on school-approved storage.</li>' +
      '<li>SPR is provided as is. Grades and comments must be checked by a teacher before use.</li></ul>' +
      '<p class="small muted">Notice v' + NOTICE.version + ', ' + NOTICE.date + '. The full text is available in English and 中文.</p></div>';
  }
  function openPrivacy() {   /* viewer mode (footer link): the full notice */
    openDlg('<h3>Notice / 使用说明</h3>' + noticeBodyHtml() +
      '<div class="dlg-actions"><button class="btn primary" data-action="dlg-close">Close</button></div>');
  }
  function readNoticeAck() {
    try {
      const raw = localStorage.getItem(PRIVACY_GATE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return (v && v.v) ? v : { v: 0, date: Number(raw) || 0 };   /* pre-2026-10-28 stores a bare timestamp */
    } catch (e) { return null; }
  }
  function privacyGateNeeded() {
    const a = readNoticeAck();
    return !a || String(a.v) !== String(NOTICE.version);   /* re-ask when the notice version changes */
  }
  function recordNoticeAcceptance() {
    const acc = { v: NOTICE.version, date: new Date().toISOString().slice(0, 10) };
    try { localStorage.setItem(PRIVACY_GATE_KEY, JSON.stringify(acc)); } catch (e) {}
    try { if (!DB.settings) DB.settings = {}; DB.settings.noticeAccept = acc; saveDB(true); } catch (e2) {}
  }
  function openPrivacyGate(onAck) {
    /* must be agreed before the sign-in / setup card can be used */
    openDlg(privacyHtml(true), function (d) {
      d.addEventListener('cancel', function (e) { e.preventDefault(); }); /* no Esc-close */
      const box = d.querySelector('#notice-read');
      const go = d.querySelector('#notice-ack-btn');
      if (box && go) box.addEventListener('change', function () { go.disabled = !box.checked; });
    });
    const btn = document.querySelector('[data-action="privacy-gate-ack"]');
    if (btn) btn.addEventListener('click', function () {
      recordNoticeAcceptance();
      /* one notice per first-run, not two: the gate IS the privacy dialog */
      try { if (!DB.settings) DB.settings = {}; if (!DB.settings.privacyAck) { DB.settings.privacyAck = Date.now(); } saveDB(true); } catch (e2) {}
      closeDlg();
      if (onAck) onAck();
    });
  }


  function openWizard() {
    const years = [];
    for (let y = 2024; y <= 2035; y++) years.push(y);
    const thisYear = new Date().getFullYear();
    openDlg(
      '<h3>New class / semester</h3>' +
      '<div class="flex"><label>Year <select class="inp" id="wiz-year">' +
        years.map((y) => '<option value="' + y + '"' + (y === thisYear ? ' selected' : '') + '>' + y + '</option>').join('') + '</select></label>' +
      '<label>Period <select class="inp" id="wiz-period"><option value="fall">Fall</option><option value="spring">Spring</option></select></label></div>' +
      '<div class="small muted" id="wiz-hint" style="margin:8px 0"></div>' +
      '<div class="month-checks" id="wiz-months"></div>' +
      '<label style="display:block;margin:10px 0">Semester name <input class="inp" id="wiz-name" style="width:100%"></label>' +
      '<div class="flex">' +
        '<label>School <input class="inp" id="wiz-school" value="' + U.esc((cur() && cur().school) || '') + '"></label>' +
        '<label>Class <input class="inp" id="wiz-class" placeholder="P4C4" value="' + U.esc((cur() && cur().className) || '') + '"></label>' +
        '<label>Teachers <input class="inp" id="wiz-teachers" placeholder="Mo, Lisa"></label>' +
      '</div>' +
      '<hr class="divider"><b class="small">Students</b>' +
      '<div class="flex" style="margin-top:8px">' +
        '<label><input type="radio" name="wiz-rmode" value="empty" checked> start empty</label>' +
        '<label><input type="radio" name="wiz-rmode" value="copy"> copy roster from</label>' +
        '<select class="inp" id="wiz-copyfrom" style="display:none">' + DB.semesters.map((s) => '<option value="' + U.esc(s.id) + '">' + U.esc(s.name) + '</option>').join('') + '</select>' +
        '<label><input type="radio" name="wiz-rmode" value="paste"> paste a list</label>' +
      '</div>' +
      '<textarea id="wiz-paste" class="inp" rows="4" style="width:100%;display:none;margin-top:8px" placeholder="One per line: ID, Chinese name, English name, Gender"></textarea>' +
      '<div class="dlg-actions"><button class="btn" data-action="dlg-close">Cancel</button>' +
      '<button class="btn primary" data-action="wiz-create">Create</button></div>',
      function () { wizSync(true); });
  }
  function wizSync(fresh) {
    const y = Number($('#wiz-year').value), p = $('#wiz-period').value;
    const suggested = U.suggestMonths(y, p);
    $('#wiz-hint').textContent = U.suggestHint(y, p);
    const keep = !fresh && ui.wizMonths ? ui.wizMonths : suggested;
    $('#wiz-months').innerHTML = U.MONTHS.map((m) =>
      '<label><input type="checkbox" name="wizm" value="' + m + '"' + (keep.includes(m) ? ' checked' : '') + '> ' + (U.MONTH_ABBR[m] || m) + '</label>').join('');
    ui.wizMonths = keep.slice();
    const nameEl = $('#wiz-name');
    if (!nameEl.value) nameEl.value = y + ' ' + (p === 'fall' ? 'Fall' : 'Spring');
  }
  function wizCreate() {
    const y = Number($('#wiz-year').value), p = $('#wiz-period').value;
    const months = $$('#wiz-months input[name="wizm"]:checked').map((i) => i.value).sort((a, b) => acadRank(a) - acadRank(b));
    if (!months.length) { toast('Pick at least one month', true); return; }
    const name = $('#wiz-name').value.trim() || (y + ' ' + (p === 'fall' ? 'Fall' : 'Spring'));
    const teachers = $('#wiz-teachers').value.split(/[,;&、]/).map((t) => t.trim()).filter(Boolean);
    const mode = ($$('input[name="wiz-rmode"]').find((r) => r.checked) || {}).value || 'empty';
    let students = [];
    if (mode === 'copy') {
      const src = DB.semesters.find((s) => s.id === $('#wiz-copyfrom').value);
      if (src) students = src.students.map((s) => ({ id: s.id, nameCn: s.nameCn, nameEn: s.nameEn, gender: U.normGender(s.gender) }));
    } else if (mode === 'paste') {
      students = parseRosterPaste($('#wiz-paste').value);
    }
    const sem = normalizeSemester({
      id: U.uid('sem'), name: name, year: y, period: p,
      school: $('#wiz-school').value.trim() || 'School',
      className: $('#wiz-class').value.trim(), teachers: teachers,
      months: months, students: students,
      observations: {}, spelling: {}, daily: {}, tests: {},
    });
    /* round5 item 2: the FIRST class on a fresh browser must land in class
       mode (per-class workbooks, pairing, per-teacher access): never in the
       shared single-markbook. Existing vault browsers keep vault mode. */
    if (sprMode() !== 'class' && !classIndex().length && !DB.semesters.length) {
      const clsName = sem.className || sem.name;
      (async () => {
        const cid = await createClassWorkbook(sem.school || 'School', clsName, '', '');
        if (!cid) return;
        await openClass(cid);
        DB.semesters.push(sem);
        DB.currentSemesterId = sem.id;
        saveDB(); buildShell(); closeDlg();
        toast('Class ' + clsName + ' created. This browser now manages classes one at a time: add teachers from Users to give them this class.');
        location.hash = '#/dashboard'; route();
      })();
      return;
    }
    DB.semesters.push(sem);
    DB.currentSemesterId = sem.id;
    saveDB(); buildShell(); closeDlg();
    toast('Created ' + name + (students.length ? ' · ' + students.length + ' students' : ''));
    const target = students.length ? '#/entry/sp' : '#/manage';
    if (location.hash === target) route();
    else location.hash = target;
  }
  function openMonthsEdit(semid) {
    const sem = DB.semesters.find((s) => s.id === semid);
    if (!sem) return;
    openDlg('<h3>Months: ' + U.esc(sem.name) + '</h3>' +
      '<div class="month-checks">' + U.MONTHS.map((m) =>
        '<label><input type="checkbox" name="mm" value="' + m + '"' + (sem.months.includes(m) ? ' checked' : '') + '> ' + m + '</label>').join('') + '</div>' +
      '<p class="small red-pen">Removing a month deletes its scores for every student.</p>' +
      '<div class="dlg-actions"><button class="btn" data-action="dlg-close">Cancel</button>' +
      '<button class="btn primary" data-action="months-save" data-semid="' + U.esc(semid) + '">Save</button></div>');
  }
  async function monthsSave(semid) {
    const sem = DB.semesters.find((s) => s.id === semid);
    if (!sem) return;
    const months = $$('input[name="mm"]:checked').map((i) => i.value).sort((a, b) => acadRank(a) - acadRank(b));
    const removed = sem.months.filter((m) => !months.includes(m));
    if (removed.length) {
      const okGo = await confirmDlg('Remove ' + removed.join(', ') + '?',
        'All scores recorded in ' + U.esc(removed.join(', ')) + ' will be deleted for every student.', 'Remove');
      if (!okGo) return;
      for (const sid of Object.keys(sem.observations)) removed.forEach((m) => delete sem.observations[sid][m]);
      for (const key of ['spelling', 'daily']) for (const sid of Object.keys(sem[key])) removed.forEach((m) => delete sem[key][sid][m]);
    }
    sem.months = months;
    saveDB(); closeDlg(); buildShell(); route(); toast('Months updated');
  }

  /* ========================= import / export / backup ========================= */
  function sanitizeFn(s) { return String(s).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'markbook'; }
  /* parse one SPR workbook file -> semester (no dialogs, no side effects) */
  function parseWorkbookFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          const warnings = [];
          const sem = normalizeSemester(EB.importWorkbook(wb, { id: U.uid('sem'), name: EB.suggestNameFromFilename(file.name), warnings: warnings }));
          sem.students.forEach((st) => { st.id = String(st.id == null ? '' : st.id).replace(/[^A-Za-z0-9_\-]/g, '-').slice(0, 40) || U.uid('stu'); });
          const dup = sem.students.filter((st, i) => sem.students.findIndex((x) => x.id === st.id) !== i);
          if (dup.length) throw new Error('duplicate student IDs after sanitising: ' + dup[0].id);
          validateDB({ semesters: [sem], settings: {} });
          const tm = String(file.name).match(/\(([^)]+)\)/);
          if (tm && !sem.teachers.length) sem.teachers = tm[1].split(/\s*[&,、]\s*/).map((t) => t.trim()).filter((t) => t && t.length <= 40);
          if (warnings.length) toast('Imported with ' + warnings.length + ' invalid score' + (warnings.length > 1 ? 's' : '') + ' ignored: check the class details', true);
          resolve(sem);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('could not read the file'));
      reader.readAsArrayBuffer(file);
    });
  }
  /* import one or many SPR workbooks — one shared confirmation for the whole batch */
  async function importXlsxFiles(files) {
    const sems = [], failed = [];
    for (const file of files) {
      try { sems.push(await parseWorkbookFile(file)); }
      catch (err) { failed.push(file.name + ': ' + err.message); }
    }
    if (!sems.length) { toast('Import failed: ' + (failed[0] || 'no file readable'), true); return; }
    const MAX_LIST = 15;
    const listed = sems.slice(0, MAX_LIST).map((s) => '<b>' + U.esc(s.name) + '</b>: ' + s.students.length + ' students · ' + U.esc(s.months.join(', '))).join('<br>') +
      (sems.length > MAX_LIST ? '<br>…and ' + (sems.length - MAX_LIST) + ' more' : '');
    const dupNames = sems.filter((s) => DB.semesters.some((x) => x.name === s.name)).length;
    const okGo = await confirmDlg('Add ' + (sems.length === 1 ? 'this class' : 'these ' + sems.length + ' classes') + '?',
      listed +
      (dupNames ? '<br><br>' + (dupNames === 1 ? 'A semester with' : dupNames + ' semesters with') + ' a matching name already exist in this browser: both will be kept; you can rename or delete either one in Manage &amp; setup.' : '') +
      (failed.length ? '<br><br><b>Not imported:</b><br>' + failed.map(U.esc).join('<br>') : '') +
      '<br><br>Nothing is overwritten: your existing classes stay exactly as they are.',
      'Add');
    if (!okGo) { toast('Import cancelled: nothing was changed'); return; }
    for (const s of sems) DB.semesters.push(s);
    DB.currentSemesterId = sems[sems.length - 1].id;
    saveDB(); buildShell();
    toast('Imported ' + sems.length + ' workbook' + (sems.length > 1 ? 's' : '') + (failed.length ? ' · ' + failed.length + ' could not be read' : ''));
    if (location.hash === '#/dashboard') route();
    else location.hash = '#/dashboard';
  }
  function importXlsxFile(file) { importXlsxFiles([file]); }
  function exportXlsx() {
    const sem = cur();
    if (!sem) return;
    const wb = EB.exportWorkbook(sem, CLS ? (DB.audit || []) : null);
    XLSX.writeFile(wb, sanitizeFn(sem.school + '-' + (sem.className || 'class') + '-SPR-' + sem.name + '-by-Teacher-Mo') + '.xlsx');
    toast('Excel exported: check your downloads');
  }
  function backupJSON() {
    const out = Object.assign({}, DB, {
      credit: 'Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)',
      author: 'Mohammed Shehzad Khan (Teacher Mo)',
    });
    const pc = dsCfg();   /* backups carry the device-sync pairing so a restore
                             on another system re-enables sync there by itself */
    if (pc && pc.on && pc.channel && pc.key) out.__sprPair = { channel: pc.channel, key: pc.key };
    DB.settings.lastBackupAt = Date.now();   /* powers the gentle backup reminder */
    try { saveDB(true); } catch (e) {}
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'SPR-backup-by-Teacher-Mo-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('Full backup downloaded: use “Restore backup” on the other computer to load it');
  }
  function restoreJSONFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || !Array.isArray(d.semesters)) throw new Error('not a markbook backup file');
        validateDB(d);
        /* replacing everything deserves a clear question first */
        const okRestore = await confirmDlg('Replace everything with this backup?',
          'This backup holds <b>' + d.semesters.length + ' semester(s)</b> and will <b>replace all classes currently in this browser</b> (' + DB.semesters.length + ' now).<br><br>Your current data is kept as a safety copy you can restore (Manage &rarr; Backups).',
          'Replace');
        if (!okRestore) { toast('Restore cancelled: nothing was changed'); return; }
        stashSafetyBackup('before restoring a backup file');
        let healed = 0;
        d.semesters.forEach((sm) => { normalizeSemester(sm); healed += (sm.__droppedInvalid || 0); });
        const pairCfg = d.__sprPair; if (pairCfg) delete d.__sprPair;
        d.settings = Object.assign({ autoTotal: true, spTotal: 20, daTotal: 10 }, d.settings || {});
        d.credit = d.credit || 'Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)';
        d.author = d.author || 'Mohammed Shehzad Khan (Teacher Mo)';
        DB = d;
        if (!DB.semesters.find((s) => s.id === DB.currentSemesterId)) DB.currentSemesterId = DB.semesters[0] ? DB.semesters[0].id : null;
        saveDB(true); buildShell(); location.hash = '#/dashboard'; route();
        toast('Backup restored' + (healed ? ': ' + healed + ' invalid score' + (healed > 1 ? 's' : '') + ' removed' : ''));
        if (pairCfg && pairCfg.channel && pairCfg.key) dsPair(pairCfg.channel, pairCfg.key);
      } catch (err) { toast('Restore failed: ' + err.message, true); }
    };
    reader.readAsText(file);
  }

  /* ============================ global listeners ============================ */
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    /* pseudo-links (href='#') must not navigate: the hashchange re-route would
       instantly close the very dialog this click just opened */
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
    const a = el.dataset.action;
    const sem = cur();
    if (a === 'class-open') { openClass(el.dataset.id); return; }
    if (a === 'class-new-open') { classNewDialog(); return; }
    if (a === 'class-import-btn') { const f = $('#file-class'); if (f) f.click(); return; }
    if (a === 'class-roster-btn') { const f = $('#file-roster'); if (f) f.click(); return; }
    if (a === 'restore-all-btn') { const f = $('#file-restore-all'); if (f) f.click(); return; }
    if (a === 'class-migrate-open') { migrateOpen(); return; }
    if (a === 'class-pair') { pairClassDialog(el.dataset.id); return; }
    if (a === 'class-share') { classShareDialog(el.dataset.id); return; }
    if (a === 'class-export-file') { exportClassFile(el.dataset.id); return; }
    if (a === 'export-all') { exportEverything(); return; }
    if (a === 'start-fresh') { startFreshDevice(); return; }
    if (a === 'review-approve') { reviewDecide(el.dataset.id, true); return; }
    if (a === 'review-reject') { reviewDecide(el.dataset.id, false); return; }
    if (a === 'show-setup') { loginSetupMode = true; renderLogin(); return; }
    if (a === 'show-signin') { loginSetupMode = false; renderLogin(); return; }
    if (a === 'first-run') {
      const un = ($('#suUser') ? $('#suUser').value : '').trim();
      const pw = ($('#suPass') ? $('#suPass').value : '') || '';
      const cf = ($('#suConf') ? $('#suConf').value : '') || '';
      const errEl = $('#suErr');
      if (!un) { if (errEl) errEl.textContent = 'Choose a username.'; return; }
      if (un === MASTER_KEY) { if (errEl) errEl.textContent = 'That username is reserved.'; return; }
      const pwErr = CS.pwOk('admin', pw);
      if (pwErr) { if (errEl) errEl.textContent = pwErr; return; }
      if (pw !== cf) { if (errEl) errEl.textContent = 'Passwords do not match.'; return; }
      (async () => {
        try {
          const res = await firstRunCreate(un, pw);
          if (res.error) { if (errEl) errEl.textContent = res.error; return; }
          /* item 4: no admin account without a recovery path. The dialog stays
             up until a master password is set or a recovery file is saved. */
          openDlg('<h3>One more thing: your recovery path</h3>' +
            '<p class="small">If the admin password is ever forgotten, one of these two is the only way back in. Choose one now.</p>' +
            '<div class="panel" style="margin:10px 0"><b>1. Set a master password (recommended)</b>' +
            '<p class="small muted">A second password that resets the admin password from the sign-in screen. No file needed, and it still works years from now. Keep it on paper.</p>' +
            '<div class="flex" style="gap:8px;flex-wrap:wrap"><input type="password" id="mrPw" class="inp" style="max-width:210px" placeholder="Master password" autocomplete="new-password">' +
            '<button class="btn" data-action="recovery-master">Set master password</button></div>' +
            '<div class="login-err" id="mrErr" aria-live="assertive"></div></div>' +
            '<div class="panel" style="margin:10px 0"><b>2. Download a recovery file instead</b>' +
            '<p class="small muted">What this can and cannot do: the file restores your data <b>as of the moment you save it</b>. Right now that is nothing: the workbook is empty. SPR offers a fresh recovery file at the first backup prompt (when there is real data to protect). Keep the newest copy with the school\u2019s records. A file cannot reset a forgotten password: it only brings data back.</p>' +
            '<div class="flex" style="gap:8px;flex-wrap:wrap;align-items:center"><button class="btn" data-action="recovery-dl">Download recovery file</button>' +
            '<span class="small muted" id="recoveryDlState">not downloaded yet</span></div></div>' +
            '<div class="login-err" id="recErr" aria-live="assertive"></div>' +
            '<div class="dlg-actions"><button class="btn primary" data-action="recovery-ack" id="recoveryGo" disabled>Continue</button></div>',
            function (d) { d.addEventListener('cancel', function (e) { e.preventDefault(); }); });
        } catch (err) { if (errEl) errEl.textContent = 'Setup failed: ' + err.message; }
      })();
      return;
    }
    if (a === 'recovery-master') {
      (async () => {
        const err = $('#mrErr');
        const mst = ($('#mrPw') ? $('#mrPw').value : '') || '';
        const perr = CS.pwOk('admin', mst);
        if (perr) { if (err) err.textContent = perr; return; }
        try {
          const v2 = readV2() || { fmt: 2, wraps: {}, ts: Date.now() };
          v2.wraps[MASTER_KEY] = await makeWrap(SESSION.dk, mst);
          writeV2(v2);
          if (err) err.textContent = '';
          const go = $('#recoveryGo'); if (go) go.disabled = false;
          toast('Master password set');
        } catch (e2) { if (err) err.textContent = 'Could not set the master password: ' + e2.message; }
      })();
      return;
    }
    if (a === 'recovery-dl') {
      downloadBackup();   /* round5 item 3: Continue enables only after this really fired */
      try { DB.settings.recoveryFilePending = 1; saveDB(true); } catch (eR) {}
      const st = $('#recoveryDlState');
      if (st) st.textContent = 'downloaded: a fresh one is offered at the first backup prompt';
      const go = $('#recoveryGo'); if (go) go.disabled = false;
      return;
    }
    if (a === 'recovery-ack') {
      const go = $('#recoveryGo');
      const err = $('#recErr');
      const v2 = readV2();
      const masterSet = !!(v2 && v2.wraps && v2.wraps[MASTER_KEY]);
      if (go && go.disabled) { if (err) err.textContent = 'Choose one of the two options first: set a master password, or download the recovery file.'; return; }
      if (!masterSet && !(go && !go.disabled)) { if (err) err.textContent = 'Choose one of the two options first.'; return; }
      try { localStorage.setItem('spr-recovery-ack', String(Date.now())); } catch (e3) {}
      closeDlg(); document.body.classList.remove('auth-gate'); buildShell(); route();
      toast('Sign-in created. Welcome to SPR');
      if (!DB.settings.privacyAck) openPrivacy();
      return;
    }
    if (a === 'acct-del') {
      (async () => {
        if (!isAdmin()) { toast('Admin only.', true); return; }
        const un = el.dataset.user;
        if (!un || un === SESSION.user) return;
        const okGo = await confirmDlg('Remove sign-in ' + U.esc(un) + '?',
          'This deletes <b>' + U.esc(un) + '</b> and the key that opens it <b>from this device only</b>. If this person still uses this browser, they will no longer be able to open the data here. Other devices are not affected.',
          'Remove sign-in');
        if (!okGo) return;
        const auth = getAuth();
        auth.users = auth.users.filter((u) => u.username !== un);
        saveAuth(auth);
        const v2 = readV2();
        if (v2 && v2.wraps && v2.wraps[un]) { delete v2.wraps[un]; writeV2(v2); }
        dsAddGone(un);   /* stay deleted: without the tombstone the additive account merge would resurrect it from the cloud row */
        await dsKillPointer(un);
        if (dsCanPush()) {
          /* push NOW, not on the 4 s debounce: in that window another device
             pushing (it adopted the pre-deletion copy) would put the account
             back on the row. If the immediate push cannot run (hold/read
             failure), the debounce retry still applies. */
          const pushedNow = await dsPushNow(false);
          if (!pushedNow) scheduleSyncPush();
        }
        toast('Sign-in removed: ' + un);
        if (location.hash === '#/manage') renderManage();
      })();
      return;
    }
    if (a === 'sb-restore') {
      (async () => {
        const list = safetyBackups();
        const b = list[Number(el.dataset.i)];
        if (!b || !b.db) { toast('That safety copy is gone', true); return; }
        const okGo = await confirmDlg('Restore this safety copy?',
          'Your data from <b>' + new Date(b.t).toLocaleString() + '</b> (' + ((b.db || {}).semesters || []).length + ' classes) will replace what is here now. Today&rsquo;s data is kept as a new safety copy.', 'Restore');
        if (!okGo) return;
        stashSafetyBackup('before restoring a safety copy');
        persistReplaced(JSON.parse(JSON.stringify(b.db)));
      })();
      return;
    }
    if (a === 'sb-del') {
      const list = safetyBackups();
      const i = Number(el.dataset.i);
      if (!list[i]) return;
      list.splice(i, 1);
      try { localStorage.setItem(SAFETY_KEY, JSON.stringify(list)); } catch (e) {}
      if (location.hash === '#/manage') renderManage();
      return;
    }
    if (a === 'users-csv') {
      const head = 'username,display_name,role,class_or_grade,paired_with,status';
      const lines = getAuth().users.map((u) => {
        const ci = usersClassInfo(u.username, u.role);
        const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        return [u.username, u.name || u.username, roleLabel(u.role), ci.classes, ci.partner, u.disabled ? 'Disabled' : 'Active'].map(esc).join(',');
      });
      const blob = new Blob([head + '\n' + lines.join('\n')], { type: 'text/csv' });
      const a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = 'spr-accounts.csv';
      document.body.appendChild(a2); a2.click(); a2.remove();
      return;
    }
    if (a === 'user-toggle') {
      if (!isAdmin()) { toast('Admin only.', true); return; }
      const un = el.dataset.user;
      const auth = getAuth();
      const u = auth.users.find((x) => x.username === un);
      if (!u || un === SESSION.user) return;
      u.disabled = !u.disabled;
      saveAuth(auth);
      if (dsCanPush()) scheduleSyncPush();
      toast(un + (u.disabled ? ' disabled' : ' enabled') + ' \u2014 they cannot sign in while disabled');
      renderUsers();
      return;
    }
    if (a === 'acct-add-open') {
      if (!isAdmin()) { toast('Admin only.', true); return; }
      openDlg('<h3>Add a sign-in</h3>' +
        '<p class="small">Creates an account with its own password. In this mode it opens this same markbook (all students); class mode gives each teacher their own class instead. With device sync on, it also works on any other system: the teacher signs in and the same data arrives. <b>Teacher</b>: the everyday markbook tools. <b>Management</b>: also sees the Ranking view across every workbook.</p>' +
        '<label>Username <input class="inp" id="naUser" placeholder="e.g. ZFYBLS" autocomplete="off"></label>' +
        '<label>Display name <input class="inp" id="naName" placeholder="shown on the sidebar (optional)"></label>' +
        '<label>Role <select class="inp" id="naRole"><option value="teacher">Teacher</option><option value="management">Management</option></select></label>' +
        '<label>Password <input class="inp" type="password" id="naPass" autocomplete="new-password"></label>' +
        '<label>Repeat password <input class="inp" type="password" id="naConf" autocomplete="new-password"></label>' +
        '<div class="login-err" id="naErr" aria-live="assertive"></div>' +
        '<div class="dlg-actions"><button class="btn" data-action="dlg-close">Cancel</button>' +
        '<button class="btn primary" data-action="acct-add" id="naGo">Create sign-in</button></div>');
      return;
    }
    if (a === 'acct-add') {
      (async () => {
        /* creating a sign-in runs two 600k key derivations (~2s): park the button so the admin sees it working */
        const goBtn = $('#naGo');
        if (goBtn) { goBtn.disabled = true; goBtn.textContent = 'Creating…'; }
        try {
        if (!isAdmin()) { toast('Admin only.', true); return; }
        const err = $('#naErr');
        const un = ($('#naUser') ? $('#naUser').value : '').trim();
        const name = ($('#naName') ? $('#naName').value : '').trim();
        const role = ($('#naRole') ? $('#naRole').value : 'teacher');
        { const pre = CS.pwOk(role, ($('#naPass') ? $('#naPass').value : '') || ''); if (pre && $('#naPass').value) { if (err) err.textContent = pre; return; } }
        const pw = ($('#naPass') ? $('#naPass').value : '') || '';
        const cf = ($('#naConf') ? $('#naConf').value : '') || '';
        if (!un || /[^A-Za-z0-9_.-]/.test(un)) { if (err) err.textContent = 'Username: letters, numbers, dot, dash or underscore.'; return; }
        if (un === MASTER_KEY) { if (err) err.textContent = 'That username is reserved.'; return; }
        if (getAuth().users.some((u) => u.username.toLowerCase() === un.toLowerCase())) { if (err) err.textContent = 'That username is already on this device.'; return; }
        if (!pw) { if (err) err.textContent = 'Enter a password.'; return; }
        if (pw !== cf) { if (err) err.textContent = 'Passwords do not match.'; return; }
        const addErr = await addUser(un, pw, name || un, role);
        if (addErr) { if (err) err.textContent = addErr; return; }
        /* share the encrypted markbook with the new account: wrap this browser's
           master key under the new password so their sign-in can unlock it */
        const v2 = readV2();
        if (SESSION.dk && v2 && v2.wraps) {
          try {
            v2.wraps[un] = await makeWrap(SESSION.dk, pw);
            writeV2(v2);
          } catch (e2) { if (err) err.textContent = 'Account created, but key wrapping failed: ' + e2.message; return; }
        }
        closeDlg();
        const ptr = await dsWritePointer(un, pw);
        if (dsCanPush()) scheduleSyncPush();   /* fresh devices need the new account hash in the data row */
        toast(ptr === 'ok' ? 'Sign-in created: ' + un + ' (' + roleLabel(role) + '): works on any system they sign in from'
             : ptr === 'name-taken' ? 'Created on this device, but the username is taken in the SPR cloud by another school: rename it so it works everywhere'
             : 'Sign-in created: ' + un + ' (' + roleLabel(role) + ')');
        if (location.hash === '#/manage') renderManage();
        else if (location.hash === '#/users') renderUsers();   /* the new row appears immediately on the Users tab */
        } finally { if (goBtn) { goBtn.disabled = false; goBtn.textContent = 'Create sign-in'; } }
      })();
      return;
    }
    if (a === 'acct-reset-open') {
      if (!isAdmin()) { toast('Admin only.', true); return; }
      const un = el.dataset.user;
      openDlg('<h3>Reset password: ' + U.esc(un) + '</h3>' +
        '<p class="small">Sets a new password for this sign-in. Tell the person their new password: they will need it next time they sign in here.</p>' +
        '<label>New password <input class="inp" type="password" id="rpPass" autocomplete="new-password"></label>' +
        '<label>Repeat password <input class="inp" type="password" id="rpConf" autocomplete="new-password"></label>' +
        '<div class="login-err" id="rpErr" aria-live="assertive"></div>' +
        '<div class="dlg-actions"><button class="btn" data-action="dlg-close">Cancel</button>' +
        '<button class="btn primary" data-action="acct-reset" data-user="' + U.esc(un) + '" id="rpGo">Save password</button></div>');
      return;
    }
    if (a === 'acct-reset') {
      (async () => {
        /* same 600k derivations as add — park the button while the keys are re-derived */
        const goBtn = $('#rpGo');
        if (goBtn) { goBtn.disabled = true; goBtn.textContent = 'Saving…'; }
        try {
        if (!isAdmin()) { toast('Admin only.', true); return; }
        const err = $('#rpErr');
        const un = el.dataset.user;
        const nw = ($('#rpPass') ? $('#rpPass').value : '') || '';
        const cf = ($('#rpConf') ? $('#rpConf').value : '') || '';
        const auth = getAuth();
        const u = auth.users.find((x) => x.username === un);
        if (!u) { closeDlg(); return; }
        { const perr = CS.pwOk(u.role, nw); if (perr) { if (err) err.textContent = perr; return; } }
        if (nw !== cf) { if (err) err.textContent = 'New passwords do not match.'; return; }
        u.login = await CS.loginWrap(nw);
        delete u.hash;
        /* re-seal the class keys under the new password. The old password is
           only available when the holder themselves changes it (rpOld) or the
           session holds it. If neither is true (admin reset from a restored
           session), the re-wrap CANNOT succeed: fail loudly, and clear the
           stale wrap so the next Pair re-issues a fresh key instead of the
           account silently keeping a key nobody can unwrap (owner lockout). */
        let rewrapFail = '';
        if (u.keyring) {
          for (const cid of Object.keys(u.keyring)) {
            try {
              u.keyring[cid] = await CS.rewrapKey(u.keyring[cid], ($('#rpOld') ? $('#rpOld').value : '') || SESSION.pw || '', nw);
            } catch (e) {
              delete u.keyring[cid];
              rewrapFail = ' The class key could not be re-keyed on this device (the current password was not available here): use Pair to issue this account a fresh key.';
            }
          }
        }
        saveAuth(auth);
        const v2 = readV2();
        if (SESSION.dk && v2 && v2.wraps && v2.wraps[un]) {
          try {
            v2.wraps[un] = await makeWrap(SESSION.dk, nw);
            writeV2(v2);
          } catch (e2) { if (err) err.textContent = 'Saved, but re-keying failed: ' + e2.message; return; }
        }
        if (SESSION.user === un) SESSION.pw = nw;   /* next cloud push re-wraps under the new password */
        const ptr = await dsWritePointer(un, nw);
        if (dsCanPush()) scheduleSyncPush();   /* fresh devices need the new password hash in the data row */
        closeDlg();
        toast((ptr === 'ok' ? 'Password updated for ' + un + ': sign-in on any system uses this password now'
             : ptr === 'name-taken' ? 'Password updated, but the username is taken in the SPR cloud by another school: rename it so it works everywhere'
             : 'Password updated for ' + un) + rewrapFail, !!rewrapFail);
        if (location.hash === '#/manage') renderManage();
        } finally { if (goBtn) { goBtn.disabled = false; goBtn.textContent = 'Save password'; } }
      })();
      return;
    }
    /* ---------- master password: admin recovery key for this device ---------- */
    if (a === 'master-recover-cancel') { renderLogin(); return; }
    if (a === 'master-recover-open') {
      if (!masterWrap()) { renderLogin(); return; }
      openDlg('<h3>Reset the admin password</h3>' +
        '<p class="small">Use the <b>master password</b> to set a new password for the admin account on this device. All data and all other sign-ins stay untouched. Nothing works without the master password: keep it on paper.</p>' +
        '<label>Master password <input class="inp" type="password" id="mrMaster" autocomplete="off"></label>' +
        '<label>New admin password <input class="inp" type="password" id="mrPass" autocomplete="new-password"></label>' +
        '<label>Repeat new password <input class="inp" type="password" id="mrConf" autocomplete="new-password"></label>' +
        '<div class="login-err" id="mrErr" aria-live="assertive"></div>' +
        '<div class="dlg-actions"><button class="btn" data-action="master-recover-cancel">Back to sign-in</button>' +
        '<button class="btn primary" data-action="master-recover">Reset &amp; sign in</button></div>');
      return;
    }
    if (a === 'master-recover') {
      (async () => {
        const err = $('#mrErr');
        const master = ($('#mrMaster') ? $('#mrMaster').value : '') || '';
        const nw = ($('#mrPass') ? $('#mrPass').value : '') || '';
        const cf = ($('#mrConf') ? $('#mrConf').value : '') || '';
        if (!master) { if (err) err.textContent = 'Enter the master password.'; return; }
        { const perr = CS.pwOk('admin', nw); if (perr) { if (err) err.textContent = perr; return; } }
        if (nw !== cf) { if (err) err.textContent = 'New passwords do not match.'; return; }
        const v2 = readV2();
        const w = v2 && v2.wraps && v2.wraps[MASTER_KEY];
        if (!w) { if (err) err.textContent = 'No master password is set on this device.'; return; }
        let dk;
        try { dk = await unwrapWrap(w, master); }
        catch (e) { if (err) err.textContent = 'Wrong master password.'; return; }
        const auth = getAuth();
        const admin = auth.users.find((u) => u.role === 'admin') || auth.users[0];
        if (!admin) { if (err) err.textContent = 'No admin account exists on this device.'; return; }
        try {
          v2.wraps[admin.username] = await makeWrap(dk, nw);
          admin.hash = hashPassword(nw);
          writeV2(v2);
          saveAuth(auth);
        } catch (e) { if (err) err.textContent = 'Recovery failed: ' + e.message; return; }
        closeDlg();
        const res = await doLoginFull(admin.username, nw);
        if (res.error) { toast(res.error, true); renderLogin(); return; }
        document.body.classList.remove('auth-gate'); buildShell(); route();
        toast('Admin password reset via master password: welcome back, ' + res.user.name);
      })();
      return;
    }
    if (a === 'master-set-open') {
      if (!isAdmin()) { toast('Admin only.', true); return; }
      openDlg('<h3>Set master password</h3>' +
        '<p class="small">A recovery key for this device: if the admin password is ever forgotten, the master password can reset it from the sign-in screen. <b>Write it on paper</b>: SPR cannot show it to you again.</p>' +
        '<label>Master password <input class="inp" type="password" id="msPass" autocomplete="new-password"></label>' +
        '<label>Repeat master password <input class="inp" type="password" id="msConf" autocomplete="new-password"></label>' +
        '<div class="login-err" id="msErr" aria-live="assertive"></div>' +
        '<div class="dlg-actions"><button class="btn" data-action="dlg-close">Cancel</button>' +
        '<button class="btn primary" data-action="master-set">Save master password</button></div>');
      return;
    }
    if (a === 'master-set') {
      (async () => {
        const err = $('#msErr');
        if (!isAdmin()) { closeDlg(); toast('Admin only.', true); return; }
        if (!cryptoOK() || !SESSION.dk) { if (err) err.textContent = 'Needs the online (https) version.'; return; }
        const pw = ($('#msPass') ? $('#msPass').value : '') || '';
        const cf = ($('#msConf') ? $('#msConf').value : '') || '';
        if (!pw) { if (err) err.textContent = 'Enter a master password.'; return; }
        if (pw !== cf) { if (err) err.textContent = 'Master passwords do not match.'; return; }
        const v2 = readV2();
        if (!v2 || !v2.wraps) { if (err) err.textContent = 'No encrypted storage found: sign out and in once first.'; return; }
        try {
          v2.wraps[MASTER_KEY] = await makeWrap(SESSION.dk, pw);
          writeV2(v2);
        } catch (e) { if (err) err.textContent = 'Saving failed: ' + e.message; return; }
        closeDlg();
        toast('Master password set: write it on paper, SPR cannot show it again.');
        if (location.hash === '#/manage') renderManage();
      })();
      return;
    }
    if (a === 'master-del') {
      (async () => {
        if (!isAdmin()) { toast('Admin only.', true); return; }
        const okGo = await confirmDlg('Remove master password?',
          'The sign-in screen will no longer offer admin recovery on this device. If the admin password is then forgotten, the data can no longer be opened here.', 'Remove');
        if (!okGo) return;
        const v2 = readV2();
        if (v2 && v2.wraps && v2.wraps[MASTER_KEY]) { delete v2.wraps[MASTER_KEY]; writeV2(v2); }
        toast('Master password removed.');
        if (location.hash === '#/manage') renderManage();
      })();
      return;
    }
    if (a === 'rk-sort') {
      if (!ui.rk) ui.rk = { school: '', teacher: '', k: 'avg', dir: -1 };
      const k = el.dataset.k;
      const key = (k === 'rank') ? 'avg' : k;
      if (ui.rk.k === key) ui.rk.dir = -ui.rk.dir;
      else { ui.rk.k = key; ui.rk.dir = (key === 'avg' || key === 'delta' || key === 'distTop') ? -1 : 1; }
      renderRanking();
      return;
    }
    if (a === 'rk-open') {
      const id = el.dataset.sem;
      if (!DB.semesters.some((s) => s.id === id)) return;
      DB.currentSemesterId = id;
      saveDB(true); buildShell();
      if (location.hash === '#/dashboard') route();
      else location.hash = '#/dashboard';
      return;
    }
    if (a === 'do-login') {
      const u = $('#loginUser') ? $('#loginUser').value.trim() : '';
      const p = $('#loginPass') ? $('#loginPass').value : '';
      if (!u || !p) { $('#loginErr').textContent = 'Enter username and password.'; return; }
      const btn = document.querySelector('[data-action="do-login"]'); if (btn) btn.disabled = true;
      (async () => {
        try {
          const res = await doLoginFull(u, p);
          if (res.error) { if (res.error !== '__shown__') { const eEl = $('#loginErr'); if (eEl) eEl.textContent = res.error; } return; }
          closeDlg(); document.body.classList.remove('auth-gate'); buildShell(); route();
          /* single-class auto-open then takes the landing: on success it points
             #/dashboard itself; on failure its honest dialog shows over the
             working chooser (never a blank screen, never a dead end) */
          if (SPR_LOGIN_AUTO_CLASS) { const cid0 = SPR_LOGIN_AUTO_CLASS; SPR_LOGIN_AUTO_CLASS = null; openClass(cid0); }
          toast('Welcome back, ' + res.user.name); maybeJoin();
        } catch (err) { $('#loginErr').textContent = 'Sign-in failed: ' + err.message; }
        finally { const b2 = document.querySelector('[data-action="do-login"]'); if (b2) b2.disabled = false; }
      })();
      return;
      if (!DB.settings.privacyAck) openPrivacy();
      return;
    }
    if (a === 'logout') { doLogout(); return; }
    if (a === 'change-pass-save') {
      (async () => {
        /* P1.1: self-service for EVERY role. The current password is verified
           by UNLOCKING (login wrap / v2 wrap): never against a stored hash:
           and everything wrapped under the old password is re-wrapped under
           the new one: v2 master wrap, the login wrap, and every class key in
           the user's keyring. */
        const err = $('#cpErr');
        const cur = ($('#cpCur') || {}).value || '';
        const nw = ($('#cpNew') || {}).value || '';
        const cf = ($('#cpConf') || {}).value || '';
        if (!SESSION.user) { if (err) err.textContent = 'Sign in first.'; return; }
        const auth = getAuth();
        const me = auth.users.find((u) => u.username === SESSION.user);
        if (!me) { if (err) err.textContent = 'Account not found.'; return; }
        const v2 = readV2();
        const vres = await verifyUserPw(me, cur, v2);
        if (!vres.ok) { if (err) err.textContent = 'Current password is wrong.'; return; }
        const perr = CS.pwOk(me.role, nw);
        if (perr) { if (err) err.textContent = perr; return; }
        if (nw !== cf) { if (err) err.textContent = 'New passwords do not match.'; return; }
        stashSafetyBackup('before password change');
        try {
          if (SESSION.dk && v2 && v2.wraps && v2.wraps[me.username]) v2.wraps[me.username] = await makeWrap(SESSION.dk, nw);
          if (me.keyring) { for (const cid of Object.keys(me.keyring)) me.keyring[cid] = await CS.rewrapKey(me.keyring[cid], cur, nw); }
          me.login = await CS.loginWrap(nw);
          delete me.hash;
          if (SESSION.pw !== null || SESSION.pw !== undefined) SESSION.pw = nw;
          for (const cid of Object.keys(SESSION.keys || {})) { try { SESSION.keys[cid] = await CS.unwrapKey(me.keyring[cid], nw); } catch (e) {} }
          classKeysToSession();
          /* persist LAST: either the whole change lands (and the toast shows),
             or nothing does (error, old password still valid): a half-applied
             change (hash flipped but wraps stale) must be impossible. */
          saveAuth(auth);
          if (v2) writeV2(v2);
        } catch (e) { if (err) err.textContent = 'Re-keying failed: ' + e.message; return; }
        /* P1.2: also re-seal this account's cloud POINTER row, so sign-in on a
           fresh browser with the NEW password still finds the data (the pointer
           is sealed under the password). Best-effort + reported, never fatal. */
        let ptrNote = '';
        if (dsOn()) {
          try {
            const chan = await dsChan(me.username);
            const row = await sbGet(chan);
            if (row && row.payload && row.payload.sprPTR === 1) {
              const pt = await ptrOpen(row.payload, cur);
              const env2 = await ptrSeal(pt, nw);
              await sbSave(chan, env2, row.share_name || 'SPR pointer', me.username, new Date().toISOString(), false);
              ptrNote = ' Cloud pointer updated too.';
            }
          } catch (e2) { ptrNote = ' (Could not update the cloud pointer - on other devices use the I-use-SPR-on-another-device option with the OLD password once, or ask the admin to reset it.)'; }
        }
        closeDlg(); toast('Password updated: use it next time you sign in.' + ptrNote);
        if (location.hash === '#/manage') renderManage();
      })();
      return;
    }
    if (a === 'dash-review-goto') { location.hash = '#/manage'; return; }
    if (a === 'review-goto') {
      const sem = DB.semesters.find((x) => x.id === el.dataset.sem);
      if (sem) { DB.currentSemesterId = sem.id; saveDB(); }
      location.hash = '#/entry/obs'; toast('Find the cell listed under Manage → quarantined scores'); return;
    }
    if (a === 'review-discard') {
      const sem = DB.semesters.find((x) => x.id === el.dataset.sem);
      if (sem && Array.isArray(sem.review)) {
        const all = reviewItems();
        const idx = Number(el.dataset.i);
        const target = all[idx];
        if (target) {
          sem.review = sem.review.filter((r) => !(r === target.item));
          saveDB(true); toast('Discarded: the value stays out of every calculation');
        }
      }
      if (location.hash === '#/manage') renderManage(); else renderClasses();
      return;
    }
    if (a === 'change-pass-open') {
      if (!SESSION.user) return;
      openDlg(
        '<h3>Change my password</h3>' +
        '<p class="small">Works for every role. Your current password is verified by opening your keys: nothing is compared against a stored hash. Everything wrapped under the old password (your data key and class keys) is re-wrapped under the new one.</p>' +
        '<div class="login-field"><label>Current password</label><input type="password" id="cpCur" autocomplete="current-password"></div>' +
        '<div class="login-field"><label>New password</label><input type="password" id="cpNew" autocomplete="new-password"></div>' +
        '<div class="login-field"><label>Repeat new password</label><input type="password" id="cpConf" autocomplete="new-password"></div>' +
        '<div class="login-err" id="cpErr" aria-live="assertive"></div>' +
        '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-action="change-pass-save">Save new password</button></div>');
      return;
    }

    if (a === 'share-create') { shareCreate(); return; }
    if (a === 'share-push') { sharePush(); return; }
    if (a === 'share-pull') { sharePull(); return; }
    if (a === 'share-qr') { shareQrModal(); return; }
    if (a === 'share-copy') {
      const inp = $('#shareLink');
      if (!inp) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inp.value).then(() => toast('Share link copied'), () => { inp.select(); document.execCommand('copy'); toast('Share link copied'); });
      } else { inp.select(); document.execCommand('copy'); toast('Share link copied'); }
      return;
    }
    if (a === 'recovery-file-now') {
      downloadBackup();
      try { delete DB.settings.recoveryFilePending; saveDB(true); } catch (eR2) {}
      closeDlg();
      toast('Recovery file saved: it now holds your real data as of today');
      return;
    }
    if (a === 'ds-test') {
      if (!dsOn()) { toast('Turn on device sync first', true); return; }
      (async () => {
        const c = dsCfg();
        let msg;
        try {
          const chan = c.channel || await dsChan(c.owner || SESSION.user);
          const r = await sbPing(chan, c.writeToken);
          msg = r === 'ok' ? 'Cloud connection is good: the server knows this device\u2019s write token, and pushes are protected.'
              : r === 'no-token' ? 'Connected, but the cloud channel has no write token enrolled yet. Your next change will enrol it automatically. Until then the server refuses pushes (they fail safely).'
              : r === 'bad-token' ? 'Connected, but the server rejected this device\u2019s write token: turn device sync off and on to rotate it.'
              : r === 'no-row' ? 'Connected: no cloud copy exists yet. It is created on your first change.'
              : r === 'not-installed' ? 'Connected, but the server-side protection is NOT installed yet: the cloud copy can still be overwritten by anyone. See docs/supabase-write-token.sql (three copy-paste steps).'
              : 'Unexpected answer from the server: ' + r;
        } catch (e) {
          if (e && e.rpcMissing) {
            msg = 'Connected, but the server-side protection is NOT installed yet (the write-token SQL has not been run). Pushes fall back to the old unprotected write, so the cloud copy can still be overwritten by anyone until the owner runs docs/supabase-write-token.sql.';
          } else {
            msg = 'Cloud connection FAILED: ' + String((e && e.message) || e) + '. Your data on this device is safe.';
          }
        }
        openDlg('<h3>Cloud connection</h3><p class="small">' + U.esc(msg) + '</p>' +
          '<div class="dlg-actions"><button class="btn primary" data-x="close">Close</button></div>');
      })();
      return;
    }
    if (a === 'ds-enable') { dsEnable(); return; }
    if (a === 'ds-now') { dsPullCheck(true); return; }
    if (a === 'ds-link') { dsLinkModal(); return; }
    if (a === 'stale-reload') { location.reload(); return; }
    if (a === 'dl-backup') { downloadBackup(); toast('Backup downloaded. Keep it somewhere safe outside this device.'); return; }
    if (a === 'stale-reload') { location.reload(); return; }
    if (a === 'dl-backup') { downloadBackup(); toast('Backup downloaded. Keep it somewhere safe outside this device.'); return; }
    if (a === 'req-email') { window.location.href = reqMailto(); toast('Opening your email app: the request is already filled in.'); return; }
    if (a === 'req-copy') {
      const t = reqText();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(() => toast('Request copied: paste it to Teacher Mo in WeChat/DingTalk'), () => { toast('Could not copy: take a screenshot instead', true); });
      } else { toast('Could not copy on this browser: take a screenshot instead', true); }
      return;
    }
    if (a === 'ds-ding') { const i = $('#dsLinkInp'); if (i) dingtalkOpen(i.value); return; }
    if (a === 'share-chatmsg') { const i = $('#shareLink'); if (i) copyChatMessage(i.value, 'SPR class markbook: tap to open and join our class:'); return; }
    if (a === 'share-ding') { const i = $('#shareLink'); if (i) dingtalkOpen(i.value); return; }
    if (a === 'ds-off') { dsOff(false); return; }
    if (a === 'ds-off-del') { dsOff(true); return; }
    if (a === 'ds-copy') {
      const inp = $('#dsLinkInp');
      if (!inp) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inp.value).then(() => toast('Pairing link copied'), () => { inp.select(); document.execCommand('copy'); toast('Pairing link copied'); });
      } else { inp.select(); document.execCommand('copy'); toast('Pairing link copied'); }
      return;
    }
    if (a === 'ds-share') { shareNative($('#dsLinkInp') ? $('#dsLinkInp').value : ''); return; }
    if (a === 'share-native') { shareNative($('#shareLink') ? $('#shareLink').value : ''); return; }
    if (a === 'approval-save') {
      if (!isAdmin()) { toast('Admin only.', true); return; }
      const by = ($('#ap-by') ? $('#ap-by').value : '').trim();
      const date = ($('#ap-date') ? $('#ap-date').value : '').trim();
      const ref = ($('#ap-ref') ? $('#ap-ref').value : '').trim();
      if (!by) { toast('Enter who approved it (name and title).', true); return; }
      if (!DB.settings) DB.settings = {};
      DB.settings.schoolApproval = { by: by, date: date, ref: ref };
      saveDB(); renderManage();
      toast('School approval recorded: it shows at the bottom of the notice.');
      return;
    }
    if (a === 'privacy-open') { openPrivacy(); return; }
    if (a === 'notice-lang') { noticeLang = el.dataset.lang === 'zh' ? 'zh' : 'en'; openPrivacy(); return; }
    if (a === 'privacy-open-full') {
      openDlg('<h3>Notice / 使用说明</h3>' + noticeBodyHtml() +
        '<div class="dlg-actions"><button class="btn" data-action="privacy-back-gate">Back</button></div>');
      return; }
    if (a === 'privacy-back-gate') {
      const wasGate = privacyGateNeeded();
      openDlg(privacyHtml(wasGate), function (d) {
        const box = d.querySelector('#notice-read');
        const go = d.querySelector('#notice-ack-btn');
        if (box && go) { box.checked = wasGate ? false : true; go.disabled = wasGate ? !box.checked : false; box.addEventListener('change', function () { go.disabled = !box.checked; }); }
      });
      return; }
    if (a === 'login-other-device') { otherDeviceDialog(); return; }
    if (a === 'privacy-ack') { closeDlg(); return; } /* legacy: viewer closes plainly */
    if (a === 'dl-class-report') { dlClassReport(); return; }
    if (a === 'dl-all-cards') { dlAllCards(); return; }
    if (a === 'dl-one-card') { dlOneCard(); return; }
    if (a === 'dl-card') { dlCard(el.dataset.sid); return; }
    if (a === 'view-card') {
      const sel = $('#rptStu');
      if (sel && sel.value) location.hash = '#/report/' + sel.value;
      return;
    }
    if (a === 'wiz-open') { openWizard(); return; }
    if (a === 'dlg-close') { closeDlg(); return; }
    if (a === 'wiz-create') { wizCreate(); return; }
    if (a === 'months-edit') { openMonthsEdit(el.dataset.semid); return; }
    if (a === 'months-save') { monthsSave(el.dataset.semid); return; }
    if (a === 'entry-month') {
      ui.entryMonth[el.dataset.metric] = el.dataset.month;
      renderEntry(el.dataset.metric === 'obs' ? 'obs' : el.dataset.metric);
      return;
    }
    if (a === 'gsort') {
      const k = el.dataset.k;
      ui.gsort = { k: k, d: ui.gsort.k === k ? -ui.gsort.d : (k === 'name' ? 1 : -1) };
      renderGrading();
      return;
    }
    if (a === 'sem-current') {
      DB.currentSemesterId = el.dataset.semid;
      saveDB(true); buildShell(); route(); return;
    }
    if (a === 'jump-sem') {
      DB.currentSemesterId = el.dataset.semid;
      saveDB(true); buildShell(); route(); return;
    }
    if (a === 'sem-del') {
      (async () => {
        const s = DB.semesters.find((x) => x.id === el.dataset.semid);
        if (!s) return;
        const okGo = await confirmDlg('Delete ' + U.esc(s.name) + '?',
          'All scores for this semester will be removed. A safety copy is kept first: Manage & setup &rarr; Backups can bring it back.', 'Delete semester');
        if (!okGo) return;
        stashSafetyBackup('before deleting semester ' + (s.name || s.id));
        const idx = DB.semesters.findIndex((x) => x.id === s.id);
        DB.semesters = DB.semesters.filter((x) => x.id !== s.id);
        if (DB.currentSemesterId === s.id) DB.currentSemesterId = DB.semesters[0] ? DB.semesters[0].id : null;
        saveDB(); buildShell(); route();
        toastAction('Semester deleted', 'Undo', () => {
          DB.semesters.splice(Math.min(idx, DB.semesters.length), 0, s);
          DB.currentSemesterId = s.id;
          saveDB(); buildShell(); route(); toast('Semester restored');
        });
      })();
      return;
    }
    if (a === 'stu-del') {
      (async () => {
        const sid = el.dataset.sid;
        const stu = sem && sem.students.find((s) => s.id === sid);
        if (!stu) return;
        const okGo = await confirmDlg('Remove ' + U.esc(stu.nameEn || stu.nameCn || sid) + '?',
          'Their scores in ' + U.esc(sem.name) + ' will be deleted. A safety copy is kept first: Manage & setup &rarr; Backups can bring them back.', 'Remove student');
        if (!okGo) return;
        stashSafetyBackup('before removing ' + (stu.nameEn || stu.nameCn || sid));
        const obs = sem.observations[sid] || null, spl = sem.spelling[sid] || null, dal = sem.daily[sid] || null, tst = sem.tests[sid] || null;
        const stuIdx = sem.students.findIndex((s) => s.id === sid);
        sem.students = sem.students.filter((s) => s.id !== sid);
        delete sem.observations[sid]; delete sem.spelling[sid]; delete sem.daily[sid]; delete sem.tests[sid];
        saveDB(); route();
        toastAction('Student removed', 'Undo', () => {
          sem.students.splice(Math.min(stuIdx, sem.students.length), 0, stu);
          if (obs) sem.observations[sid] = obs;
          if (spl) sem.spelling[sid] = spl;
          if (dal) sem.daily[sid] = dal;
          if (tst) sem.tests[sid] = tst;
          saveDB(); route(); toast('Student restored');
        });
      })();
      return;
    }
    if (a === 'roster-add') { rosterAdd(); return; }
    if (a === 'roster-paste') { rosterBulk(); return; }
    if (a === 'import-xlsx') { const f = $('#file-xlsx'); if (f) f.click(); return; }
    if (a === 'export-xlsx') { exportXlsx(); return; }
    if (a === 'backup') { backupJSON(); return; }
    if (a === 'restore') {
      if (CLS) { toast('In class mode use "Restore everything" (Classes screen) or import a class file: a single-markbook backup cannot replace a class workbook.', true); return; } const f = $('#file-json'); if (f) f.click(); return; }
    if (a === 'load-sample') {
      (async () => {
        /* destructive master-reset of the dataset — administrator only (2026-10-27, owner request 2) */
        if (!isAdmin()) { toast('Administrator only: ask Teacher Mo.', true); return; }
        if (DB.semesters.length) {
          const okGo = await confirmDlg('Reset to sample data?', 'This replaces <b>every class, student and score in this browser</b> with the demo semester. Real data is gone from this device (a cloud copy for sharing, if any, is <b>not</b> removed). A safety copy is kept: restore it from Manage &rarr; Backups.', 'Reset to sample data');
          if (!okGo) return;
        }
        stashSafetyBackup('before reset to sample data');
        DB = seedFromWindow();
        if (cryptoOK() && SESSION.dk) { await persistNow(true); }
        else { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) {} }
        location.reload();
      })();
      return;
    }
    /* the old "wipe" (Erase everything) action was removed entirely on the
       owner's decision (2026-10-27): it deleted all data AND every sign-in,
       letting whoever ran it become the admin via first-time setup. Data
       problems are handled by "Reset to sample data" (admin, keeps sign-ins
       and stashes a safety copy) or a full backup restore. */
    if (a === 'dl-corrupt') {
      const raw = (window.__SPR_CORRUPT && window.__SPR_CORRUPT.raw) || '';
      const blob = new Blob([raw], { type: 'application/json' });
      const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = 'SPR-damaged-data.json';
      document.body.appendChild(a2); a2.click(); a2.remove(); return;
    }
    if (a === 'dash-view') { (ui.dash = ui.dash || {}).view = el.dataset.view; if (el.dataset.view === 'evidence') ui.dash.ev = ui.dash.ev || 'all'; renderDashboard(); return; }
    if (a === 'prog-skill') { ui.progSkill = el.dataset.skill; renderStudent(location.hash.split('/')[2] ? decodeURIComponent(location.hash.split('/')[2]) : null); return; }
    if (a === 'rag-why') {
      const why = A.ragWhy(cur(), el.dataset.sid, DB);
      openDlg('<h3>' + U.esc(why.title) + ' \u2014 why?</h3><p class="small" style="line-height:1.6">' + U.esc(why.body) + '</p>' +
        '<div class="dlg-actions"><button class="btn primary" data-action="dlg-close">Close</button></div>');
      return;
    }
    if (a === 'rn-reset') {
      const semR = cur();
      if (semR && semR.reportNotes && semR.reportNotes[el.dataset.sid]) {
        delete semR.reportNotes[el.dataset.sid][el.dataset.field];
        saveDB();
      }
      renderReportCard(el.dataset.sid);
      toast('Reset to suggested wording');
      return;
    }
    if (a === 'print') { window.print(); return; }
  });

  /* support teachers click a readonly observation cell to propose a change */
  document.addEventListener('click', function (e) {
    const pr = e.target.closest('[data-propose]');
    if (pr) proposeDialog(pr);
  });
  document.addEventListener('input', function (e) {
    const t = e.target;
    if (t.classList && t.classList.contains('cell')) { onGridInput(t); return; }
    if (t.id === 'stuSearch') { ui.q = t.value; const el = $('#stuList'); if (el && cur()) el.innerHTML = stuCards(cur()); return; }
    if (t.id === 'dashSearch') { (ui.dash = ui.dash || {}).q = t.value; const el = $('#dashEvBody'); if (el && cur()) el.innerHTML = dashEvidenceRows(cur()); return; }
    if (t.id === 'usersQ') { (ui.usersView = ui.usersView || { q: '', role: 'all' }).q = t.value; renderUsers(); return; }
    if (t.id === 'usersRole') { (ui.usersView = ui.usersView || { q: '', role: 'all' }).role = t.value; renderUsers(); return; }
    if (t.dataset && t.dataset.rn) {
      const semRn = cur(); if (!semRn) return;
      semRn.reportNotes = semRn.reportNotes || {};
      semRn.reportNotes[t.dataset.sid] = semRn.reportNotes[t.dataset.sid] || {};
      semRn.reportNotes[t.dataset.sid][t.dataset.rn] = t.value;
      saveDB();
      const card = document.getElementById('rc-sec-' + t.dataset.rn);
      if (card) card.innerHTML = t.value ? '<p>' + U.esc(t.value) + '</p>' : '<p class="muted small">\u2014</p>';
      return;
    }
    if (t.id === 'grSearch') { ui.grQ = t.value; const el = $('#grBody'); if (el && cur()) el.innerHTML = grRows(cur()); return; }
    if (t.dataset && t.dataset.semf) {
      const s = DB.semesters.find((x) => x.id === t.dataset.semid);
      if (!s) return;
      if (t.dataset.semf === 'teachersInput') s.teachers = t.value.split(/[,;&、]/).map((x) => x.trim()).filter(Boolean);
      else s[t.dataset.semf] = t.value;
      saveDB(); syncRailMeta();
      return;
    }
    if (t.dataset && t.dataset.stufield) {
      const s = cur() && cur().students.find((x) => x.id === t.dataset.sid);
      if (s) { s[t.dataset.stufield] = t.value; saveDB(); }
      return;
    }
    if (t.dataset && t.dataset.setf) {
      const k = t.dataset.setf;
      DB.settings[k] = k === 'autoTotal' ? t.checked : (t.value === '' ? null : Number(t.value));
      saveDB();
      return;
    }
  });

  document.addEventListener('change', function (e) {
    const t = e.target;
    if (t.id === 'anStu') { ui.anStu = t.value; renderAnalysis(); return; }
    if (t.id === 'dashEv') { (ui.dash = ui.dash || {}).ev = t.value; renderDashboard(); return; }
    if (t.id === 'dashSkill') { (ui.dash = ui.dash || {}).skill = t.value; renderDashboard(); return; }
    if (t.id === 'dashRag') { (ui.dash = ui.dash || {}).rag = t.value; renderDashboard(); return; }
    if (t.id === 'scatMode') { ui.scat = t.value; renderDashboard(); return; }
    if (t.id === 'classSwitch') { if (t.value && (!CLS || CLS.id !== t.value)) openClass(t.value); return; }
    if (t.id === 'semSelect') { DB.currentSemesterId = t.value; saveDB(true); buildShell(); route(); return; }
    if (t.id === 'file-xlsx') { if (t.files && t.files.length) importXlsxFiles(Array.from(t.files)); t.value = ''; return; }
    if (t.id === 'file-class') { if (t.files && t.files.length) importClassFileGo(t.files[0]); t.value = ''; return; }
    if (t.id === 'file-roster') { if (t.files && t.files.length) rosterImportGo(t.files[0]); t.value = ''; return; }
    if (t.id === 'file-restore-all') { if (t.files && t.files.length) restoreEverythingGo(t.files[0]); t.value = ''; return; }
    if (t.id === 'rkSchool') { (ui.rk = ui.rk || { k: 'avg', dir: -1 }).school = t.value; renderRanking(); return; }
    if (t.id === 'rkTeacher') { (ui.rk = ui.rk || { k: 'avg', dir: -1 }).teacher = t.value; renderRanking(); return; }
    if (t.id === 'file-json') { if (t.files && t.files[0]) restoreJSONFile(t.files[0]); t.value = ''; return; }
    if (t.id === 'wiz-year' || t.id === 'wiz-period') { ui.wizMonths = null; wizSync(true); return; }
    if (t.name === 'wizm') { ui.wizMonths = $$('#wiz-months input[name="wizm"]:checked').map((i) => i.value); return; }
    if (t.name === 'wiz-rmode') {
      const paste = $('#wiz-paste'), copy = $('#wiz-copyfrom');
      if (paste) paste.style.display = t.value === 'paste' ? '' : 'none';
      if (copy) copy.style.display = t.value === 'copy' ? '' : 'none';
      return;
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target && (e.target.id === 'loginUser' || e.target.id === 'loginPass')) {
      var btn = document.querySelector('[data-action="do-login"]');
      if (btn) btn.click();
      return;
    }
    onGridKey(e);
  });
  window.addEventListener('beforeunload', function() {
    /* offline/legacy mode only: online mode keeps data encrypted at rest
       (plaintext mirror in localStorage would contradict that promise) */
    if (DB && !cryptoOK()) { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch(e) {} }
  });
  document.addEventListener('paste', onGridPaste);

  /* =================================== init =================================== */

  /* ============================ CREDENTIALS ============================ */
  /* ============================ share & sync (encrypted SPR cloud) ====================
     Two teachers, one dataset. The class data is AES-GCM encrypted with a random
     key; only the ciphertext goes to the cloud bin. The key travels exclusively
     inside the share link (#join=<bin>&k=<key>), so the server never sees it.
     Manual Push/Pull (last-save-wins). */
  const SHARE_KEY = 'spr-share-v1';
  const SUPABASE = { url: 'https://hvjswsedoapsskedrkoj.supabase.co', key: 'sb_publishable_kY2tUdMKmqOIUPYi0OtfNg_K_YqpDSh' }; /* publishable key only: RLS applies; see assets/supabase-setup.md */
  function SB() {
    try { const o = JSON.parse(localStorage.getItem('spr-sb-v1')); if (o && o.url && o.key) return o; } catch (e) {}
    return SUPABASE;
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function looksUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }
  function getShare() { try { return JSON.parse(localStorage.getItem(SHARE_KEY)) || {}; } catch (e) { return {}; } }
  function setShare(cfg) { localStorage.setItem(SHARE_KEY, JSON.stringify(cfg)); }
  function b64uFromBytes(b) { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function bytesFromB64u(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  function subtle() { return (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null; }

  async function cloudEnvelope(cfg) {
    /* reuse the stored key so share links stay valid across pushes */
    const keyBytes = cfg.key ? bytesFromB64u(cfg.key) : crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ck = await subtle().importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv }, ck, new TextEncoder().encode(JSON.stringify({ spr: 1, db: DB })));
    const env = { sprEnc: 1, pushedAt: new Date().toISOString(), pushedBy: (currentUser() || {}).username || 'teacher', iv: b64uFromBytes(iv), ct: b64uFromBytes(new Uint8Array(ct)) };
    return { keyBytes: keyBytes, env: env };
  }
  async function cloudDecrypt(env, keyB64) {
    const ck = await subtle().importKey('raw', bytesFromB64u(keyB64), 'AES-GCM', false, ['decrypt']);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: bytesFromB64u(env.iv) }, ck, bytesFromB64u(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function applyCloudObj(env, keyB64) {
    let obj;
    if (env && env.sprEnc) {
      if (!keyB64) throw new Error('this cloud copy is encrypted: open the share link that contains its key');
      return cloudDecrypt(env, keyB64);
    } else if (env && env.spr === 1) {
      if (getShare().key) throw new Error('refusing an UNENCRYPTED cloud copy while a key is configured (possible tampering)');
      obj = env;
    } else throw new Error('not an SPR cloud copy');
    return Promise.resolve(obj);
  }
  function shareLink() {
    const c = getShare();
    const id = c.channel || c.bin;
    if (!id || !c.key) return null;
    return location.origin + location.pathname + '#join=' + encodeURIComponent(id) + '&k=' + encodeURIComponent(c.key);
  }
  /* ---------- Supabase channel (Save & Share, per-class) ---------- */
  function sbHeaders(extra) {
    const sb = SB();
    /* round5 item 1: the write token travels in the RPC body now (a header is
       invisible to the row policy and was ignored by the server anyway) */
    return Object.assign({ apikey: sb.key, Authorization: 'Bearer ' + sb.key }, extra || {});
  }
  async function sha256Hex(str) {
    const d = await subtle().digest('SHA-256', new TextEncoder().encode(String(str)));
    return Array.from(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function rpcBody(fn, payload) {
    const sb = SB();
    const res = await fetch(sb.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload) });
    if (res.status === 404) { const e = new Error('rpc-missing'); e.rpcMissing = true; throw e; }
    if (!res.ok) {
      let m = 'HTTP ' + res.status;
      try { const j = await res.json(); m = (j && (j.message || j.details)) || m; } catch (e2) {}
      const e = new Error(m);
      e.notEnrolled = /no token enrolled/i.test(m);
      e.badToken = /write token rejected/i.test(m);
      e.alreadyEnrolled = /already enrolled/i.test(m);
      throw e;
    }
    try { return await res.json(); } catch (e3) { return null; }
  }
  async function sbWrite(channel, token, env, who, at, shareName) {
    await rpcBody('spr_channel_write', { p_id: channel, p_token: String(token), p_payload: env, p_pushed_by: who, p_pushed_at: at, p_share_name: shareName });
    return 'ok';
  }
  async function sbEnrol(channel, token, keyB64) {
    /* proof of pairing: the sync key itself, verified server-side by
       recomputing the row's payload HMAC (see docs/supabase-write-token.sql) */
    await rpcBody('spr_channel_enrol', { p_id: channel, p_token: String(token), p_key: String(keyB64) });
    return true;
  }
  async function sbPing(channel, token) {
    const r = await rpcBody('spr_channel_ping', { p_id: channel, p_token: String(token || '') });
    return (r === null || r === undefined) ? '' : String(r);
  }
  async function sbGet(channel) {
    const sb = SB();
    const res = await fetch(sb.url + '/rest/v1/spr_channels?id=eq.' + encodeURIComponent(channel) + '&select=*', { headers: sbHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    return rows.length ? rows[0] : null;
  }
  async function sbSave(channel, env, shareName, who, at, insert) {
    const sb = SB();
    const dsC = (function () { try { return dsCfg(); } catch (e0) { return null; } })();
    const token = dsC && dsC.writeToken;
    if (token) {
      /* write-token world. Fresh channel: the very first INSERT arms the row
         (write_token_hash in the insert body). Existing row: the RPC is the
         only write path; if the row predates the SQL (hash NULL) this client
         enrols once with the key proof and retries. If the server does not
         have the RPC yet (SQL not run), fall back to the legacy direct write
         so nothing breaks before the owner upgrades. */
      if (insert) {
        let armed = null;
        try {
          armed = JSON.stringify({ id: channel, share_name: shareName, pushed_by: who, pushed_at: at, payload: env, write_token_hash: await sha256Hex(token) });
        } catch (eHash) { armed = null; }
        if (armed) {
          const r1 = await fetch(sb.url + '/rest/v1/spr_channels', { method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: armed });
          if (r1.ok) return 'ok';
          if (r1.status === 409) return 'conflict';
          /* pre-SQL server: the hash column does not exist (PGRST204) */
          const r2 = await fetch(sb.url + '/rest/v1/spr_channels', { method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ id: channel, share_name: shareName, pushed_by: who, pushed_at: at, payload: env }) });
          if (r2.status === 409) return 'conflict';
          if (!r2.ok) throw new Error('HTTP ' + r2.status);
          return 'ok';
        }
      }
      try {
        return await sbWrite(channel, token, env, who, at, shareName);
      } catch (e) {
        if (e && e.rpcMissing) {   /* SQL not run yet: legacy direct write */
          /* fall through to the direct path below */
        } else if (e && e.notEnrolled && dsC.key) {
          try {
            await sbEnrol(channel, token, dsC.key);
            return await sbWrite(channel, token, env, who, at, shareName);
          } catch (e2) {
            if (e2 && e2.rpcMissing) { /* fall through */ }
            else throw e2;
          }
        } else throw e;
      }
    }
    if (insert) {
      const res = await fetch(sb.url + '/rest/v1/spr_channels', { method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ id: channel, share_name: shareName, pushed_by: who, pushed_at: at, payload: env }) });
      if (res.status === 409) return 'conflict';
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return 'ok';
    }
    const res = await fetch(sb.url + '/rest/v1/spr_channels?id=eq.' + encodeURIComponent(channel), { method: 'PATCH', headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ payload: env, pushed_by: who, pushed_at: at, share_name: shareName }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return 'ok';
  }
  async function sealSem(sem, keyB64, who, pushedAt, shareName) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ck = await subtle().importKey('raw', bytesFromB64u(keyB64), 'AES-GCM', false, ['encrypt']);
    /* class name and username travel INSIDE the ciphertext — the host stores only
       an opaque channel id, a timestamp and encrypted bytes */
    const pt = new TextEncoder().encode(JSON.stringify({ spr: 1, sem: sem, name: shareName || '', by: who }));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv: iv }, ck, pt);
    return { sprEnc: 1, v: 2, pushedAt: pushedAt, iv: b64uFromBytes(iv), ct: b64uFromBytes(new Uint8Array(ct)) };
  }
  function mergeSharedSem(sem) {
    validateDB({ semesters: [sem], settings: {} });
    normalizeSemester(sem);
    const i = DB.semesters.findIndex((s) => s.id === sem.id);
    if (i >= 0) DB.semesters[i] = sem; else DB.semesters.push(sem);
    DB.currentSemesterId = sem.id;
    saveDB(true); buildShell(); location.hash = '#/dashboard'; route();
  }
  function shareQrModal() {
    const link = shareLink();
    if (!link) { toast('Create the share first', true); return; }
    openDlg(
      '<h3>Share this class</h3>' +
      '<p class="small">Send the link to your co-teacher, or let them scan the code with a phone camera. Anyone who has it can open this class: share it only with them.</p>' +
      (shareAppHint() ? '<p class="small" style="margin-top:-6px">' + shareAppHint() + '</p>' : '') +
      '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
        '<div id="qrbox" style="background:#fff;padding:10px;border-radius:8px;border:1px solid #d8e2d8"></div>' +
        '<div style="flex:1;min-width:220px"><input class="inp" id="shareLink" readonly style="font-size:12px" value="' + U.esc(link) + '">' +
        '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn primary" data-action="share-chatmsg">Copy for DingTalk / WeChat</button>' +
        (navigator.share ? '<button class="btn" data-action="share-native">Share…</button>' : '') +
        '<button class="btn" data-action="share-copy">Copy link</button>' +
        '<button class="btn" data-action="share-ding">Open in DingTalk</button>' +
        '<button class="btn" data-x="close">Close</button></div>' +
        '<p class="small muted" style="margin-top:8px">' + (navigator.share
          ? 'Share opens your phone&rsquo;s share sheet (WeChat, WhatsApp, QQ, email…).'
          : 'On a computer: copy the link, or let your co-teacher scan the code with a phone.') + '</p></div>' +
      '</div>',
      (d) => {
        try {
          const q = qrcode(0, 'M'); q.addData(link); q.make();
          const box = $('#qrbox'); if (box) box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2 });
        } catch (e) { const box = $('#qrbox'); if (box) box.textContent = 'QR unavailable: use the link'; }
        d.onclick = (e) => { if (e.target.closest('[data-x="close"]')) closeDlg(); };
      }
    );
  }
  async function shareCreate() {
    if (!subtle()) { toast('Save & Share needs the online (https) version of the app', true); return; }
    const semId = $('#shareSem') ? $('#shareSem').value : (cur() || {}).id;
    const name = ($('#shareName') ? $('#shareName').value : '').trim();
    const sem = DB.semesters.find((s) => s.id === semId);
    if (!sem) { toast('Pick the class to share first', true); return; }
    const c = getShare();
    c.provider = 'sb'; c.semId = semId; c.shareName = name || (sem.className || sem.name);
    setShare(c);
    await sharePush();
  }
  async function sharePush() {
    if (!subtle()) { toast('Save & Share needs the online (https) version of the app', true); return; }
    const c = getShare();
    const sb = SB();
    /* ---------- Save & Share (Supabase, per class) ---------- */
    if ((c.provider === 'sb' || c.channel) && sb.url && sb.key) {
      const sem = DB.semesters.find((s) => s.id === c.semId);
      if (!c.semId || !sem) { toast('Pick the class to share first', true); return; }
      try {
        /* freshness guard: never silently overwrite a co-teacher's newer copy */
        let row = null;
        try { row = await sbGet(c.channel); } catch (e) { /* the save below surfaces real errors */ }
        if (row && row.pushed_at) {
          const cloudAt = new Date(row.pushed_at).getTime();
          const mineAt = Math.max(
            c.lastPush ? new Date(c.lastPush).getTime() : 0,
            c.lastPull ? new Date(c.lastPull).getTime() : 0
          );
          if (cloudAt - mineAt > 90000) { /* 90 s tolerance for clock skew between computers */
            const act = await staleCloudDlg(row.pushed_by || 'your co-teacher', new Date(row.pushed_at).toLocaleString());
            if (act === 'pull') { sharePull(); return; }
            if (act !== 'push') { toast('Save cancelled: open the shared copy first'); return; }
          }
        }
        toast('Saving & sharing…');
        const who = (currentUser() || {}).username || 'teacher';
        const pushedAt = new Date().toISOString();
        if (!c.key) c.key = b64uFromBytes(crypto.getRandomValues(new Uint8Array(32)));
        if (!c.channel) c.channel = uuid();
        const env = await sealSem(sem, c.key, who, pushedAt, c.shareName);
        /* '' keeps NOT NULL columns happy without sending real names (privacy) */
        let out = await sbSave(c.channel, env, '', '', pushedAt, !row);
        if (out === 'conflict') { out = await sbSave(c.channel, env, '', '', pushedAt, false); }
        c.lastPush = pushedAt; c.lastPushBy = who; setShare(c);
        toast('Saved & shared: send the link or QR to your co-teacher');
        shareQrModal();
        if (location.hash === '#/manage') renderManage();
      } catch (e) { toast('Save & Share failed: ' + e.message, true); }
      return;
    }
    toast('The classic npoint channel was retired - Save & Share now uses the encrypted SPR cloud (Create share).', true);
  }
  function staleCloudDlg(who, when) {
    return new Promise((resolve) => {
      openDlg(
        '<h3>Cloud was updated after your last sync</h3>' +
        '<p class="small">The cloud copy was pushed by <b>' + U.esc(who) + '</b> at ' + U.esc(when) + '. Pushing now would <b>overwrite their newer copy with your older one</b>: sync is last-save-wins.</p>' +
        '<p class="small"><b>Pull first</b> to get their changes (your current copy is kept as a safety copy: Manage &rarr; Backups). Push anyway only if you are sure their copy is outdated.</p>' +
        '<div class="dlg-actions">' +
          '<button class="btn" data-x="2">Cancel</button>' +
          '<button class="btn danger" data-x="1">Push anyway</button>' +
          '<button class="btn primary" data-x="0">Pull first</button>' +
        '</div>',
        (d) => {
          d.onclick = (e) => {
            const b = e.target.closest('[data-x]');
            if (!b) return;
            resolve(b.dataset.x === '0' ? 'pull' : b.dataset.x === '1' ? 'push' : 'cancel');
            closeDlg();
          };
          d.onclose = () => resolve('cancel');
        }
      );
    });
  }
  async function sharePull() {
    const c = getShare();
    const sb = SB();
    /* ---------- Save & Share: update just the shared class ---------- */
    if ((c.provider === 'sb' || c.channel) && sb.url && sb.key) {
      if (!c.channel || !c.key) { toast('No shared class on this browser yet: open the link or QR your co-teacher sent you', true); return; }
      try {
        toast('Checking cloud…');
        const row = await sbGet(c.channel);
        if (!row || !row.payload) { toast('Nothing has been saved to this channel yet', true); return; }
        const obj = await applyCloudObj(row.payload, c.key);
        if (obj.sem) {
          validateDB({ semesters: [obj.sem], settings: {} });
          normalizeSemester(obj.sem);
          const nm = (obj.sem.className ? obj.sem.className + ' · ' : '') + obj.sem.name;
          const when = row.pushed_at ? new Date(row.pushed_at).toLocaleString() : 'unknown time';
          const okGo = await confirmDlg('Open shared copy?',
            'This will update <b>' + U.esc(nm) + '</b> in this browser with the copy saved by <b>' + U.esc(row.pushed_by || 'someone') + '</b> at ' + when + '. Your other classes are untouched. Your current copy is kept as a safety copy (Manage &rarr; Backups).', 'Open it');
          if (!okGo) return;
          stashSafetyBackup('before replacing data');
          c.lastPull = new Date().toISOString(); setShare(c);
          mergeSharedSem(obj.sem);
          toast('Shared copy loaded');
        } else if (obj.db) {
          validateDB(obj.db);
          const when = row.pushed_at ? new Date(row.pushed_at).toLocaleString() : 'unknown time';
          const okGo = await confirmDlg('Open shared copy?',
            'This shared channel carries a <b>whole workbook</b>. Opening it will <b>REPLACE all data in this browser</b> with the cloud copy saved by <b>' + U.esc(row.pushed_by || 'someone') + '</b> at ' + when + '. Your current data is kept as a safety copy you can restore (Manage &rarr; Backups).', 'Open & replace');
          if (!okGo) return;
          stashSafetyBackup('before replacing data');
          c.lastPull = new Date().toISOString(); setShare(c);
          persistReplaced(obj.db);
        } else throw new Error('cloud copy has no class data');
      } catch (e) { toast('Open failed: ' + e.message, true); }
      return;
    }

    toast('The classic npoint channel was retired - ask your co-teacher for a current Save & Share link.', true);
  }
  async function shareJoin(id, keyB64) {
    if (looksUuid(id)) return joinSb(id, keyB64);
    /* pre-2026 npoint links are retired: nothing is fetched from npoint */
    toast('This share link uses the retired classic channel. Ask the sender to Push again with current SPR (Save & Share), or open a backup file.', true);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  async function joinSb(channel, keyB64) {
    const sb = SB();
    try {
      if (!(sb.url && sb.key)) throw new Error('Save & Share is not set up on this browser yet');
      toast('Opening shared class…');
      const row = await sbGet(channel);
      if (!row || !row.payload) throw new Error('nothing saved under this link yet');
      const obj = await applyCloudObj(row.payload, keyB64);
      if (!obj.sem) throw new Error('this link uses a legacy whole-workbook format');
      validateDB({ semesters: [obj.sem], settings: {} });
      normalizeSemester(obj.sem);
      const nm = (obj.sem.className ? obj.sem.className + ' · ' : '') + obj.sem.name;
      const okGo = await confirmDlg('Join shared class?',
        'This adds <b>' + U.esc(nm) + '</b> to this browser' + (row.pushed_by ? ' (saved by <b>' + U.esc(row.pushed_by) + '</b>)' : '') + '. Your other classes stay untouched, and the Save &amp; Share button will keep this class in sync from now on. Your current copy is kept as a safety copy (Manage &rarr; Backups).', 'Join');
      if (!okGo) { history.replaceState(null, '', location.pathname + location.search); return; }
      stashSafetyBackup('before replacing data');
      setShare({ provider: 'sb', channel: channel, key: keyB64 || null, semId: obj.sem.id, shareName: obj.shareName || nm, lastPull: new Date().toISOString() });
      history.replaceState(null, '', location.pathname + location.search);
      mergeSharedSem(obj.sem);
      toast('Joined: Save & Share now keeps this class in sync');
    } catch (e) {
      toast('Join failed: ' + e.message, true);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
  function maybeJoin() {
    const h = location.hash || '';
    const m = h.match(/^#join=([^&]+)(?:&k=([^&]+))?/);
    if (m) { shareJoin(decodeURIComponent(m[1]), m[2] ? decodeURIComponent(m[2]) : null); return; }
    const p = h.match(/^#pair=([^&]+)&k=([^&]+)/);
    if (p) dsPair(decodeURIComponent(p[1]), decodeURIComponent(p[2]));
  }

  /* ============================ device sync (admin) ============================
     Whole-database cloud mirror for the admin. The complete encrypted state
     (accounts + wrapped data keys + sealed workbook) is AES-GCM sealed under a
     random 256-bit sync key; only unreadable ciphertext reaches the cloud row.
     The channel id is derived from the admin's username (dsChan), and the sync
     key itself is stored inside the row wrapped under the admin's login
     password (PBKDF2-310k, the same wrapping used for the local vault). So a
     fresh device needs NOTHING but the admin username + password: sign in and
     the whole markbook arrives. The pairing link (#pair=<channel>&k=<key>) and
     JSON backups remain as alternative ways to carry the key. Automatic:
     debounced push after every save, pull-check on admin sign-in. Last save
     wins; every payload carries a content digest and an HMAC so tampered or
     identical copies are detected. */
  const DS_KEY = 'spr-devicesync-v1';
  const DS_DECLINED_KEY = 'spr-ds-declined';
  let DS_BOOT_TS = 0, dsTimer = null, dsHoldPush = false;
  /* the pull-check must never treat the copy this device JUST installed as
     "newer than itself": floor the boot clock at the envelope's seal time
     (v2.ts is the SENDER's last local write: often older than the envelope) */
  function dsBootFloor(ts) {
    try {
      const prev = Number(localStorage.getItem('spr-ds-boot') || 0);
      const t = Math.max(prev, Number(ts) || 0) || Date.now();
      localStorage.setItem('spr-ds-boot', String(t));
      DS_BOOT_TS = Math.max(DS_BOOT_TS, t);
    } catch (e) {}
  }
  /* account-derived channel id: stable across password changes, guessable
     only with the username: everything inside is sealed, so an id match
     reveals nothing without the password (which is needed to unwrap the key) */
  async function dsChan(username) {
    /* deterministic UUID: spr_channels.id is a Postgres uuid column, so the
       id must be uuid-shaped (a tag like 'ds1-…' is rejected with 22P02).
       NOTE: the variant group must be built from the NUMBER: wrapping it in
       String() first makes .toString(16) a no-op (String.toString ignores the
       radix) and emits a 5-char DECIMAL group Postgres rejects. */
    const d = await subtle().digest('SHA-256', new TextEncoder().encode('spr-ds1:chan:' + String(username).trim().toLowerCase()));
    const hex = Array.from(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    const variant = ((parseInt(hex.slice(16, 20), 16) & 0x3fff) | 0x8000).toString(16).padStart(4, '0');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-' + variant + '-' + hex.slice(20, 32);
  }
  function dsCfg() { try { const c = JSON.parse(localStorage.getItem(DS_KEY)); return (c && c.channel && c.key) ? c : null; } catch (e) { return null; } }
  /* ---- teacher bootstrap pointers ----
     The data row lives at dsChan(ADMIN). A teacher's fresh-browser sign-in
     knows only the teacher's username, so it looks at dsChan(teacher): which
     holds a tiny pointer: {chan, key} of the school row, sealed under the
     teacher's own password (PBKDF2-310k). Written when the admin creates or
     resets the sign-in (the only moments the plaintext password is available);
     removed with the account. Attacking a pointer = brute-forcing the
     password; swapping rows buys nothing: the sealed payload won't unwrap
     under the real teacher's password and the data row's account hashes are
     verified after decryption. */
  async function ptrSeal(obj, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bits = await deriveKeyBits(password, salt);
    const key = await subtle().importKey('raw', bits, 'AES-GCM', false, ['encrypt']);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
    return { sprPTR: 1, salt: b64uFromBytes(salt), iv: b64uFromBytes(iv), ct: b64uFromBytes(ct) };
  }
  async function ptrOpen(payload, password) {
    const bits = await deriveKeyBits(password, bytesFromB64u(payload.salt));
    const key = await subtle().importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: bytesFromB64u(payload.iv) }, key, bytesFromB64u(payload.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  /* returns 'ok' | 'name-taken' | 'off' (sync not on / not this account's device) */
  async function dsWritePointer(username, password) {
    const cfg = dsCfg();
    if (!dsOn() || !cfg || cfg.adoptedAcct !== true || !SESSION.dk) return 'off';
    try {
      const id = await dsChan(username);
      const env = await ptrSeal({ chan: cfg.channel, key: cfg.key }, password);
      const known = !!(cfg.pointers && cfg.pointers[username]);
      if (!known) {
        /* first write must INSERT: a 409 means this username is already taken
           in the SPR cloud by another school: never overwrite their pointer */
        const res = await sbSave(id, env, 'ds-ptr', 'cloud sign-in: ' + username, new Date().toISOString(), true);
        if (res !== 'ok') return 'name-taken';
      } else {
        /* re-seal (password reset): PATCH our own row, then verify it landed —
           PostgREST reports success even when the id matches zero rows */
        await sbSave(id, env, 'ds-ptr', 'cloud sign-in: ' + username, new Date().toISOString(), false);
        const back = await sbGet(id);
        if (!back || !back.payload || back.payload.ct !== env.ct) {
          const res = await sbSave(id, env, 'ds-ptr', 'cloud sign-in: ' + username, new Date().toISOString(), true);
          if (res !== 'ok') return 'name-taken';
        }
      }
      cfg.pointers = cfg.pointers || {};
      cfg.pointers[username] = new Date().toISOString();
      dsSaveCfg(cfg);
      return 'ok';
    } catch (e) { return 'off'; }
  }
  async function dsKillPointer(username) {
    const cfg = dsCfg();
    if (cfg && cfg.pointers) { delete cfg.pointers[username]; dsSaveCfg(cfg); }
    try { await dsKillRow(await dsChan(username)); } catch (e) {}
  }
  function dsOn() { const c = dsCfg(); return !!(c && c.on); }
  function dsSaveCfg(cfg) {
    if (cfg) {
      /* item 5: every paired device gets a random write token; pushes carry it
         and the cloud row keeps only its hash (see docs/device-sync.md) */
      if (cfg.on && !cfg.writeToken) {
        try { const t = new Uint8Array(24); crypto.getRandomValues(t); cfg.writeToken = Array.from(t).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); } catch (e) {}
      }
      localStorage.setItem(DS_KEY, JSON.stringify(cfg));
    } else { try { localStorage.removeItem(DS_KEY); } catch (e) {} }
  }
  function dsAdminActive() { return !!(cryptoOK() && isAdmin() && SESSION && SESSION.dk); }
  /* sync transport runs for EVERY signed-in user on a paired device (the
     markbook is shared by the whole school); channel CONTROL (enable / turn
     off / delete / pairing link) stays admin-only */
  function dsSyncActive() { return !!(cryptoOK() && SESSION && SESSION.dk && SESSION.user); }
  /* a legacy pre-account pairing (random channel, no adoptedAcct flag) keeps
     admin-only pushes until an admin's fresh sign-in migrates the channel to
     the account home: a teacher must never fork a second cloud island */
  /* P1.3: device sync OFF must mean ZERO cloud requests — the on-flag is
     checked again here so no path can push without an explicitly-enabled cfg */
  function dsCanPush() { return dsOn() && dsSyncActive() && (dsAdminActive() || (dsCfg() || {}).adoptedAcct === true); }
  function dsDeviceName() {
    const c = dsCfg(); if (c && c.device) return c.device;
    const ua = navigator.userAgent || '';
    const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'device';
    return b + ' · ' + os;
  }
  function dsLink() { const c = dsCfg(); return (c && c.channel && c.key) ? location.origin + location.pathname + '#pair=' + encodeURIComponent(c.channel) + '&k=' + encodeURIComponent(c.key) : null; }
  /* ---- China-app aware sharing (DingTalk / WeChat) ----
     No third-party JS-SDK: WeChat requires a verified公众号 + ICP domain and
     DingTalk an enterprise app registration. What works everywhere without
     registrations: paste-ready chat messages (the way teachers actually
     share), QR codes (both apps scan natively), the OS share sheet on
     phones, and a DingTalk deep link to open the page inside DingTalk. */
  function inWeChat() { return /MicroMessenger/i.test(navigator.userAgent || ''); }
  function inDingTalk() { return /DingTalk/i.test(navigator.userAgent || ''); }
  function copyChatMessage(url, message) {
    const text = message + '\n' + url;
    const done = () => toast('Copied: paste it into your DingTalk or WeChat chat');
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); }); return; }
    fallbackCopy(text); done();
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
  function dingtalkOpen(url) { location.href = 'dingtalk://dingtalkclient/page/link?url=' + encodeURIComponent(url) + '&pc_slide=true'; }
  function shareAppHint() {
    if (inWeChat()) return 'You are inside WeChat: tap <b>&hellip;</b> (top right) &rarr; <b>Send to friend</b> to forward this page, or long-press the code to scan it from another phone.';
    if (inDingTalk()) return 'You are inside DingTalk: tap <b>&hellip;</b> (top right) &rarr; <b>Forward</b> to send this page to a colleague.';
    return '';
  }
  /* native share sheet (WeChat / WhatsApp / QQ / email…) where the platform
     provides one: phones; computers keep Copy + QR */
  function shareNative(url) {
    if (!url) return;
    if (!navigator.share) { toast('This browser has no share sheet: use Copy link or the QR', true); return; }
    navigator.share({ title: 'SPR', text: 'SPR link (contains the decryption key: keep it private):', url: url }).catch(function () { /* user cancelled */ });
  }
  /* stable content digest: everything except volatile timestamps */
  function classSyncPayload() {
    if (sprMode() !== 'class') return null;
    const ix = classIndex(); const blobs = {};
    for (const c of ix) {
      const raw = localStorage.getItem(classBlobKey(c.id));
      if (raw) { try { blobs[c.id] = JSON.parse(raw); } catch (e) {} }
    }
    return { index: ix, blobs: blobs };
  }
  /* the user projection that travels in sync payloads: credentials for
     unlocking (login wrap, keyring) but NEVER a password hash. The content
     digest uses the SAME projection so the sum stays meaningful. */
  function syncUsers() {
    /* never export a tombstoned account: a device that adopted the
       pre-deletion copy still holds the user in auth.users: the tombstone
       must win (dsClearGone lifts it when the username is re-created) */
    const gone = dsGone().map(function (v) { return String(v).toLowerCase(); });
    return getAuth().users.filter(function (u) {
      return u.username && gone.indexOf(String(u.username).toLowerCase()) < 0;
    }).map(function (u) {
      const c = { username: u.username, name: u.name, role: u.role, keyring: u.keyring || {} };
      if (u.login) c.login = u.login;
      return c;
    });
  }
  /* ---- accounts survive whole-blob sync (fix 2026-10-24) ----------------
     The cloud envelope used to REPLACE the account list with the pusher's,
     so a device with a stale short list silently erased colleagues from the
     copy everyone else installs. Accounts now travel ADDITIVELY:
       - union of the cloud list and the local list, by username;
       - the fresher side wins a conflict (local on push, cloud on install);
       - a deleted account stays deleted via the tombstone list below. */
  const DS_GONE_KEY = 'spr-ds-gone-v1';
  function dsGone() { try { const g = JSON.parse(localStorage.getItem(DS_GONE_KEY)); return Array.isArray(g) ? g : []; } catch (e) { return []; } }
  function dsAddGone(un) {
    if (!un) return;
    const k = String(un).toLowerCase();   /* tombstones compare case-insensitively */
    const g = dsGone();
    if (g.indexOf(k) < 0) { g.push(k); try { localStorage.setItem(DS_GONE_KEY, JSON.stringify(g)); } catch (e) {} }
  }
  function dsClearGone(un) {
    /* tombstones are stored lowercased (usernames are matched case-insensitively) */
    const k = String(un || '').toLowerCase();
    const g = dsGone();
    if (g.indexOf(k) >= 0) { try { localStorage.setItem(DS_GONE_KEY, JSON.stringify(g.filter(function (x) { return x !== k; }))); } catch (e) {} }
  }
  const acctSig = function (u) { return [u.username, u.name || '', u.role || '', Object.keys(u.keyring || {}).sort().join(','), u.login ? 1 : 0].join('|'); };
  /* merge a cloud copy's accounts into THIS device. dir 'push' = local wins
     conflicts (we are about to publish), 'install' = cloud wins (the copy is
     newer than this device). Returns true when local state changed. */
  function dsMergeAccounts(obj, dir, baseV2) {
    if (!obj || !Array.isArray(obj.users)) return false;
    const auth0 = getAuth();
    let gone = dsGone().concat(Array.isArray(obj.gone) ? obj.gone : []);
    gone = gone.map(function (v) { return String(v).toLowerCase(); });   /* case-insensitive: "Mo" and "mo" are the same account */
    gone = gone.filter(function (v, i) { return gone.indexOf(v) === i; });
    /* re-creating a username lifts its tombstone at creation time (dsClearGone
       in addUser); a tombstone meeting the account STILL LISTED in an older
       cloud copy must WIN: that cloud simply has not seen the deletion yet */
    try { localStorage.setItem(DS_GONE_KEY, JSON.stringify(gone)); } catch (e) {}
    const cloudBy = {};
    for (const u of obj.users) { if (u && u.username && gone.indexOf(String(u.username).toLowerCase()) < 0) cloudBy[u.username] = u; }
    const auth = getAuth();
    const localBy = {};
    for (const u of auth.users) localBy[u.username] = u;
    const byUn = (dir === 'install') ? Object.assign({}, localBy, cloudBy) : Object.assign({}, cloudBy, localBy);
    for (const un of gone) { for (const k of Object.keys(byUn)) { if (k.toLowerCase() === un) delete byUn[k]; } }
    const merged = Object.keys(byUn).sort().map(function (k) { return byUn[k]; });
    const changed = merged.length !== auth.users.length ||
      merged.some(function (u) { return acctSig(u) !== acctSig(localBy[u.username] || { username: u.username }); });
    /* data-key wraps travel beside the account records — union them the same
       way so a cloud-only teacher can still unlock the archive on this device.
       On install the cloud wrap wins (a password reset made there must land
       here); on push the local wrap wins. baseV2 (installs) is written out in
       full: in legacy mode its .data IS the workbook being adopted. */
    const localV2 = readV2();
    let v2 = baseV2 ? JSON.parse(JSON.stringify(baseV2)) : (localV2 || { fmt: 2, wraps: {}, ts: Date.now() });
    if (!v2.wraps) v2.wraps = {};
    const cw = (obj.v2 && obj.v2.wraps) || {};
    let wrapChanged = false;
    const canonical = function (un) { const m = merged.find(function (u) { return String(u.username).toLowerCase() === String(un).toLowerCase(); }); return m ? m.username : null; };
    for (const un of Object.keys(cw)) {
      const cu = canonical(un);
      if (!cu) continue;   /* wrap without a live account: tombstones handle removal */
      const existing = wrapForV2(v2, cu);
      if (dir === 'install' ? (JSON.stringify(existing) !== JSON.stringify(cw[un])) : !existing) { v2.wraps[cu] = cw[un]; wrapChanged = true; }
    }
    for (const un of Object.keys(localBy)) {   /* a local-only account keeps its wrap through an install */
      if (byUn[un] === localBy[un] && !wrapForV2(v2, un) && localV2 && localV2.wraps) { const lw = wrapForV2(localV2, un); if (lw) { v2.wraps[un] = lw; wrapChanged = true; } }
    }
    for (const un of gone) { for (const wk of Object.keys(v2.wraps)) { if (wk.toLowerCase() === un && v2.wraps[wk]) { delete v2.wraps[wk]; wrapChanged = true; } } }
    if (changed) { auth.users = merged; saveAuth(auth); }
    if (wrapChanged || baseV2 || changed) { try { localStorage.setItem(V2_KEY, JSON.stringify(v2)); } catch (e) {} }   /* direct write: no scheduleSyncPush loop */
    return !!(changed || wrapChanged);
  }
  function dsContentString() {
    /* digest the DECRYPTED content, never the stored ciphertext: sealDB uses a
       fresh random IV on every save, so v2.data is a different string each
       time even when nothing changed: digesting it made every device see the
       cloud copy as "newer" (false-positive dialogs, pointless re-pushes) */
    const v2 = readV2() || { fmt: 2, wraps: {} };
    if (sprMode() === 'class') {
      const sums = {};
      for (const c of classIndex()) { try { sums[c.id] = (JSON.parse(localStorage.getItem(classBlobKey(c.id))) || {}).sum || ''; } catch (e) {} }
      return JSON.stringify({ users: syncUsers(), wraps: v2.wraps || {}, classSums: sums, open: CLS ? { id: CLS.id, pending: classPendingCount(), audit: (DB.audit || []).length } : null });
    }
    return JSON.stringify({ users: syncUsers(), wraps: v2.wraps || {}, db: DB });
  }
  async function dsSum(str) {
    const d = await subtle().digest('SHA-256', new TextEncoder().encode(str));
    return b64uFromBytes(new Uint8Array(d)).slice(0, 22);
  }
  async function dsHmac(keyBytes, ctBytes) {
    const k = await subtle().importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64uFromBytes(new Uint8Array(await subtle().sign('HMAC', k, ctBytes)));
  }
  async function dsSeal(wrap) {
    const cfg = dsCfg();
    const keyBytes = bytesFromB64u(cfg.key);
    const v2 = readV2() || { fmt: 2, wraps: {}, ts: Date.now() };
    const sum = await dsSum(dsContentString());
    const pt = JSON.stringify({ sprDS: 1, ts: Date.now(), sum: sum, users: syncUsers(), v2: v2, v3: classSyncPayload(), gone: dsGone() });   /* NO hash ever leaves this device */
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ck = await subtle().importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv }, ck, new TextEncoder().encode(pt)));
    const env = { sprDS: 1, sum: sum, iv: b64uFromBytes(iv), ct: b64uFromBytes(ct), mac: await dsHmac(keyBytes, ct) };
    /* the wrap lets a fresh device unwrap this sync key with nothing but the
       admin username + password; refreshed on every push made during a fresh
       sign-in, carried forward unchanged otherwise */
    if (wrap) env.wrap = wrap;
    return env;
  }
  async function dsOpenWith(row, keyB64) {
    const env = row && row.payload;
    if (!env || env.sprDS !== 1) throw new Error('that cloud row is not a device-sync copy');
    const keyBytes = bytesFromB64u(keyB64);
    const ctBytes = bytesFromB64u(env.ct);
    const mac = await dsHmac(keyBytes, ctBytes);
    if (mac !== env.mac) throw new Error('the cloud copy failed its integrity check (wrong pairing key, or the row was tampered with)');
    const ck = await subtle().importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: bytesFromB64u(env.iv) }, ck, ctBytes);
    const obj = JSON.parse(new TextDecoder().decode(pt));
    if (!obj || obj.sprDS !== 1 || !Array.isArray(obj.users) || !obj.v2) throw new Error('the cloud copy is damaged');
    /* v3 payloads add per-class blobs; v2 stays for the legacy archive */
    return obj;
  }
  async function dsOpen(row) {
    const cfg = dsCfg(); if (!cfg) throw new Error('device sync is not set up on this browser');
    return dsOpenWith(row, cfg.key);
  }
  function dsInstall(obj) {
    try {
      dsMergeAccounts(obj, 'install', obj.v2);   /* union, cloud records win: never silently drop local-only accounts */
      dsBootFloor(obj.ts);
      try { sessionStorage.removeItem('spr-session'); } catch (e2) {}
      if (obj.v3 && obj.v3.index) {
        setClassIndex(obj.v3.index);
        for (const cid of Object.keys(obj.v3.blobs || {})) localStorage.setItem(classBlobKey(cid), JSON.stringify(obj.v3.blobs[cid]));
        try { localStorage.setItem(MODE_KEY, 'class'); } catch (e2) {}
      }
    } catch (e) { toast('Could not install the cloud copy: ' + e.message, true); return; }
    location.reload();
  }
  function scheduleSyncPush() {
    if (!dsCanPush()) return;
    clearTimeout(dsTimer);
    dsTimer = setTimeout(function () { dsPushNow(false); }, 4000);
  }
  function writeV2(v2) {
    try {
      localStorage.setItem(V2_KEY, JSON.stringify(v2));
      KNOWN_STORE_TS = Math.max(KNOWN_STORE_TS, v2.ts || Date.now());
      saveOkBanner();
    } catch (e) { saveFailedBanner(); return false; }
    scheduleSyncPush();
    return true;
  }
  /* tombstone-first row removal (a DELETE the row policy ignores still says
     204 in PostgREST, so overwrite the payload with a dead marker first) */
  async function dsKillRow(id) {
    if (!id) return false;
    try {
      const r = await sbSave(id, { sprDS: 0, dead: 1 }, 'devicesync', 'turned off', new Date().toISOString(), false);
      if (r !== 'ok') return false;
      try { await fetch(SB().url + '/rest/v1/spr_channels?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: sbHeaders() }); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }
  async function dsPushNow(interactive) {
    if (!dsCanPush()) return false;
    if (dsHoldPush) return false;   /* a pull-check is deciding local-vs-cloud; never overwrite mid-decision */
    let cfg = dsCfg();
    try {
      /* the cloud home is derived from the OWNER (admin) account, so every
         device: and every teacher signed in on a paired device: pushes to
         the same single row without any link sharing; a legacy random-channel
         pairing migrates here on the first admin sign-in */
      const owner = (cfg && cfg.adoptedAcct && cfg.owner) ? cfg.owner : SESSION.user;
      const chan = await dsChan(owner);
      /* a FAILED read must abort the push: sealing without the previous row
         would publish a local-only envelope and clobber the cloud union
         (accounts AND deletion tombstones). "No row yet" (first push) is fine. */
      let rowReadErr = null;
      const row = await sbGet(chan).catch(function (e) { rowReadErr = (e && e.message) || 'read failed'; return null; });
      if (rowReadErr) {
        cfg.lastResult = 'fail'; dsSaveCfg(cfg);
        if (interactive) toast('Could not read the cloud copy (' + rowReadErr + '): not overwriting it blind; try again later.', true);
        return false;
      }
      /* accounts travel additively: union this device's list with the cloud
         row's BEFORE sealing, so a stale short list here can no longer erase
         colleagues from the copy every other device installs */
      if (row && row.payload && row.payload.sprDS === 1 && !row.payload.dead) {
        try { dsMergeAccounts(await dsOpen(row), 'push'); } catch (e) { /* unreadable row: the guard below handles it */ }
      }
      let wrap = null;
      if (cfg && cfg.key && SESSION.pw && SESSION.user === owner) {
        try { wrap = await makeWrap(bytesFromB64u(cfg.key), SESSION.pw); } catch (e) { wrap = null; }
      }
      if (!wrap && row && row.payload && row.payload.wrap) wrap = row.payload.wrap;   /* carry forward until the owner signs in fresh */
      const env = await dsSeal(wrap);
      /* same-content rows still get one repair write when this fresh sign-in can
         add the password wrap the row lacks: without it, a brand-new device
         cannot bootstrap by sign-in alone */
      const wrapRepair = !!(wrap && row && row.payload && row.payload.sprDS === 1 && !row.payload.wrap);
      /* never clobber a copy sealed under a DIFFERENT sync key (device sync
         enabled independently on two systems): that row belongs to another
         setup: open it (adopt) instead of overwriting it with this device's
         data */
      if (row && row.payload && row.payload.sprDS === 1 && !row.payload.dead && cfg && cfg.key) {
        let rowOurs = true;
        try { rowOurs = (await dsHmac(bytesFromB64u(cfg.key), bytesFromB64u(row.payload.ct))) === row.payload.mac; }
        catch (e) { rowOurs = true; }
        if (!rowOurs) {
          try { console.warn('row ownership check failed: adopting instead of overwriting (channel mismatch after adoption?)'); } catch (e5) {}
          cfg.lastResult = 'fail'; dsSaveCfg(cfg);
          if (interactive) toast('The cloud copy for this account was saved from a different device-sync setup: open it from Manage → Device sync first.', true);
          return false;
        }
      }
      if (row && row.payload && row.payload.sum === env.sum && !wrapRepair) {
        await dsAdoptChan(cfg, chan);
        cfg.lastPush = row.pushed_at || new Date().toISOString(); cfg.lastResult = 'ok'; dsSaveCfg(cfg);
        if (interactive) toast('Cloud copy already up to date');
        return true;
      }
      const at = new Date().toISOString();
      const who = (cfg && cfg.device ? cfg.device : 'device') + ': ' + SESSION.user;
      let r = await sbSave(chan, env, 'devicesync', who, at, !row);
      if (r === 'conflict') r = await sbSave(chan, env, 'devicesync', who, at, false);
      if (r !== 'ok') throw new Error('cloud save rejected');
      await dsAdoptChan(cfg, chan);
      cfg = dsCfg() || cfg;
      cfg.lastPush = at; cfg.lastResult = 'ok'; dsSaveCfg(cfg);
      if (interactive) toast('Cloud copy updated');
      if (location.hash === '#/manage') renderManage();
      return true;
    } catch (e) {
      try { console.warn('cloud save failed:', (e && e.message) || e); } catch (e4) {}   /* silent failures here cost days to diagnose */
      const reason = String((e && e.message) || e || 'unknown error').replace(/\s+/g, ' ').slice(0, 160);
      const c2 = dsCfg();
      if (c2) { c2.lastResult = 'fail'; c2.lastError = 'Cloud copy not updated: ' + reason + '. Your data on this device is safe.'; dsSaveCfg(c2); }
      if (interactive) toast('Cloud copy not updated: ' + reason + '. Your data on this device is safe.', true);
      /* auto-retry a failed push once after 30s — a flaky link shouldn't need a
         new edit to get the data out */
      clearTimeout(dsTimer);
      dsTimer = setTimeout(function () { if (dsCanPush()) dsPushNow(false); }, 30000);
      return false;
    }
  }
  /* move this device's config to the account channel; if it previously used a
     random legacy channel, retire that row so no device stays behind on it */
  async function dsAdoptChan(cfg, chan) {
    if (!cfg) return;
    const legacy = (cfg.channel && cfg.channel !== chan) ? cfg.channel : null;
    if (legacy) await dsKillRow(legacy);
    if (cfg.channel !== chan || cfg.adoptedAcct !== true || (dsAdminActive() && cfg.owner !== SESSION.user)) {
      cfg.channel = chan; cfg.adoptedAcct = true;
      if (dsAdminActive()) cfg.owner = SESSION.user;   /* only an admin session sets the owner: a teacher pushing to the shared row must not re-key it */
      dsSaveCfg(cfg);
    }
  }
  function dsAuthDiffers(obj) {
    /* hashes are gone: compare the STRUCTURE of my account (role, which class
       keys I hold, whether a login wrap exists): not any secret material */
    const sig = function (u) { return [u.username, u.role, Object.keys(u.keyring || {}).sort().join(','), u.login ? 1 : 0].join('|'); };
    const mine = getAuth().users.find(function (u) { return u.username === SESSION.user; });
    const cloud = (obj.users || []).find(function (u) { return u.username === SESSION.user; });
    return !mine || !cloud || sig(mine) !== sig(cloud);
  }
  async function dsPullCheck(interactive) {
    /* hold auto-pushes for the whole check INCLUDING the decision dialog —
       otherwise the 4s-debounced push could overwrite the newer cloud copy
       while the user is still deciding whether to open it */
    dsHoldPush = true;
    try { await dsPullCheckInner(interactive); }
    finally {
      dsHoldPush = false;
      if (dsOn() && dsCanPush()) scheduleSyncPush();   /* resume: pushes local choice if user declined */
    }
  }
  function dsDeclined() { try { return JSON.parse(localStorage.getItem(DS_DECLINED_KEY)) || null; } catch (e) { return null; } }
  function dsSetDeclined(user) { try { localStorage.setItem(DS_DECLINED_KEY, JSON.stringify({ user: user, at: new Date().toISOString() })); } catch (e) {} }
  async function dsPullCheckInner(interactive) {
    if (!dsSyncActive()) { if (interactive) toast('Sign in to check the cloud copy', true); return; }
    const chan = await dsChan(SESSION.user);
    /* ---- this browser has device sync OFF: the cloud is contacted ONLY when
       the user explicitly asks (Manage -> Check now). P1.2: no background
       lookups - signing in must not phone home. ---- */
    if (!dsOn()) {
      if (!interactive) return;
      const dec = dsDeclined();
      if (dec && dec.user === SESSION.user) return;   /* asked before, user kept local data */
      let row;
      try { row = await sbGet(chan); }
      catch (e) { if (interactive) toast('Cloud unreachable: check your internet connection', true); return; }
      if (!row || !row.payload || row.payload.dead) { if (interactive) toast('No cloud copy found for this account'); return; }
      if (row.payload.sprDS !== 1 || !row.payload.wrap) {
        if (interactive) toast('The cloud copy was made by an older SPR version. Sign in as admin once on the device that has device sync on, make any small change, then try again.', true);
        return;
      }
      if (!SESSION.pw) { if (interactive) toast('Sign out and sign in again first: the check needs your password to unlock the cloud copy.', true); return; }
      let hit = null;
      try { hit = await dsAccountLookup(SESSION.user, SESSION.pw); }
      catch (e) { if (interactive) toast(e.message, true); return; }
      if (!hit) { if (interactive) toast('The cloud copy was saved under a different admin password: open it with the pairing link instead.', true); return; }
      const ok = await confirmDlg('Cloud data found for ' + U.esc(SESSION.user),
        'SPR found an <b>encrypted cloud copy</b> of this markbook for your account: saved <b>' + new Date(hit.at || Date.now()).toLocaleString() + '</b> by <b>' + U.esc(String(hit.by)) + '</b>.<br><br>Open it on this device and turn on device sync here? Your current data is kept as a safety copy you can restore (Manage &rarr; Backups).',
        'Open cloud copy');
      if (!ok) { dsSetDeclined(SESSION.user); toast('Kept this device’s data: find the cloud copy later in Manage → Device sync'); return; }
      stashSafetyBackup('before replacing data');
      dsInstallFrom(hit, SESSION.user);
      dsInstall(hit.obj);
      return;
    }
    /* ---- device sync is ON: the usual freshness check ---- */
    const cfg = dsCfg();
    let row;
    try { row = await sbGet(cfg.channel); }
    catch (e) { if (interactive) toast('Cloud unreachable: check your internet connection', true); return; }
    if ((!row || (row.payload && row.payload.dead)) && cfg.channel !== chan) {
      /* legacy channel retired by the account migration — follow it home */
      try { row = await sbGet(chan); } catch (e) { row = null; }
      if (row && row.payload && !row.payload.dead) { cfg.channel = chan; cfg.owner = cfg.owner || SESSION.user; dsSaveCfg(cfg); }
    }
    cfg.lastCheck = new Date().toISOString(); dsSaveCfg(cfg);
    if (!row || (row.payload && row.payload.dead)) {
      if (interactive) toast('No cloud copy yet: it is created on your next change');
      if (location.hash === '#/manage') renderManage();
      return;
    }
    let obj;
    try { obj = await dsOpen(row); }
    catch (e) {
      /* this device's pairing key cannot read the row any more (sync was set
         up or reset elsewhere): with the account password we can still adopt
         the row's own key instead of dead-ending */
      if (/integrity check/.test(e.message || '') && SESSION.pw) {
        let hit = null;
        try { hit = await dsAccountLookup(SESSION.user, SESSION.pw); } catch (e2) { hit = null; }
        if (hit) {
          const okA = await confirmDlg('Cloud data found for ' + U.esc(SESSION.user),
            'SPR found an <b>encrypted cloud copy</b> of this markbook for your account: saved <b>' + new Date(hit.at || Date.now()).toLocaleString() + '</b> by <b>' + U.esc(String(hit.by)) + '</b>.<br><br>This device&rsquo;s pairing is out of date. Open the cloud copy and re-pair? Your current data is kept as a safety copy you can restore (Manage &rarr; Backups).',
            'Open cloud copy');
          if (okA) { stashSafetyBackup('before opening the cloud copy'); dsInstallFrom(hit, SESSION.user); dsInstall(hit.obj); }
          else if (interactive) toast('Kept this device’s data: its pairing key no longer matches the cloud copy', true);
          return;
        }
      }
      if (interactive) toast(e.message, true); return;
    }
    const localSum = await dsSum(dsContentString());
    if (obj.sum === localSum) { cfg.lastPush = row.pushed_at || cfg.lastPush; dsSaveCfg(cfg); if (interactive) toast('This device already has the newest copy'); if (location.hash === '#/manage') renderManage(); return; }
    const cloudTs = obj.ts || 0;
    if (cloudTs <= DS_BOOT_TS) {
      /* contents differ (the sum check above passed) but neither side is
         strictly newer: the copies have diverged. A flat "nothing to open"
         refusal here dead-ends a device whose local copy is broken (e.g. a
         class blob went missing), so offer the copy with honest wording. */
      if (!interactive) return;
      const okD = await confirmDlg('The cloud copy differs from this device',
        'Neither copy is newer: this device last saved <b>' + new Date(DS_BOOT_TS).toLocaleString() + '</b>; the cloud copy was saved <b>' + new Date(cloudTs).toLocaleString() + '</b> by <b>' + U.esc(String(row.pushed_by || 'another device')) + '</b>.<br><br>Open the cloud copy here? Your current data is kept as a safety copy you can restore.',
        'Open cloud copy');
      if (!okD) { toast('Kept this device’s copy'); return; }
      stashSafetyBackup('before replacing data');
      dsInstall(obj);
      return;
    }
    const ok = await confirmDlg('A newer copy is in the cloud',
      'Saved <b>' + new Date(cloudTs).toLocaleString() + '</b> by <b>' + U.esc(String(row.pushed_by || 'another device')) + '</b>: newer than this device&rsquo;s data from ' + new Date(DS_BOOT_TS).toLocaleString() + '.<br><br>Open the cloud copy here? Your current data is kept as a safety copy you can restore (Manage &rarr; Backups).' +
      (dsAuthDiffers(obj) ? '<br><br><b>Note:</b> the cloud copy has a different password for this account: use the password from the device that saved it.' : ''),
      'Open cloud copy');
    if (!ok) { toast('Kept this device’s copy'); return; }
    stashSafetyBackup('before replacing data');
    dsInstall(obj);
  }
  async function dsFreshInstall(username, password) {
    /* fresh browser paired via the pairing link: pull accounts + data BEFORE login.
       Installs quietly and returns true: the caller then signs in normally, no reload. */
    const cfg = dsCfg();
    let row;
    try { row = await sbGet(cfg.channel); }
    catch (e) { throw new Error('cannot reach the cloud copy (' + e.message + '): check your internet and try again'); }
    if (!row) throw new Error('this pairing has no cloud copy yet: sign in on your main device once so it can save one');
    const obj = await dsOpen(row);
    /* case-insensitive: users type "mo"/"Mo"/"MO" — the account is stored once */
    const u = (obj.users || []).find(function (x) { return String(x.username).toLowerCase() === String(username).toLowerCase(); });
    if (!u) return false;
    const vr = await verifyUserPw(u, password, obj.v2); if (!vr || !vr.ok) return false;
    try {
      dsMergeAccounts(obj, 'install', obj.v2);
      try { localStorage.removeItem(LS_KEY); } catch (e2) {}
      if (obj.v3 && obj.v3.index) {   /* class workbooks: without these a paired fresh browser signs into a class-less device */
        setClassIndex(obj.v3.index);
        for (const cid of Object.keys(obj.v3.blobs || {})) localStorage.setItem(classBlobKey(cid), JSON.stringify(obj.v3.blobs[cid]));
        try { localStorage.setItem(MODE_KEY, 'class'); } catch (e3) {}
      }
    } catch (e) { throw new Error('could not store the cloud copy on this device: ' + e.message); }
    dsBootFloor(obj.ts);
    return true;
  }
  /* the account IS the pairing. Looks up the channel derived from the given
     username; the row's wrap (PBKDF2 over the given password) unlocks the sync
     key. Returns:
       {chan, keyB64, obj, by, at} → verified cloud copy for this account
       false → account known to the cloud but the password is wrong
       null  → no cloud copy for this account */
  async function dsAccountLookup(username, password) {
    const chan = await dsChan(username);
    let row;
    try { row = await sbGet(chan); }
    catch (e) { throw new Error('cannot reach the cloud copy (' + e.message + '): check your internet and try again'); }
    if (!row || !row.payload || row.payload.dead) return null;
    const env = row.payload;
    /* teacher account: this row is a pointer to the school's data row,
       sealed under the teacher's own password */
    if (env.sprPTR === 1) {
      let pt;
      try { pt = await ptrOpen(env, password); }
      catch (e) { return false; }
      if (!pt || !pt.chan || !pt.key) return null;
      let dataRow;
      try { dataRow = await sbGet(pt.chan); }
      catch (e) { throw new Error('cannot reach the cloud copy (' + e.message + '): check your internet and try again'); }
      if (!dataRow || !dataRow.payload || dataRow.payload.dead) return null;
      const keyB64 = pt.key;
      const obj = await dsOpenWith(dataRow, keyB64);
      const u = (obj.users || []).find(function (x) { return String(x.username).toLowerCase() === String(username).toLowerCase(); });
      if (!u) return false;
      const vr = await verifyUserPw(u, password, obj.v2); if (!vr || !vr.ok) return false;
      const owner = ((obj.users || []).find(function (x) { return x.role === 'admin'; }) || {}).username || username;
      return { chan: pt.chan, keyB64: keyB64, obj: obj, by: row.pushed_by || 'another device', at: row.pushed_at, owner: owner };
    }
    if (env.sprDS !== 1 || !env.wrap) return null;   /* legacy pairing-only row: needs the link */
    let keyBytes;
    try { keyBytes = await unwrapWrap(env.wrap, password); }
    catch (e) { return false; }   /* AES-GCM auth failed → wrong password */
    const keyB64 = b64uFromBytes(keyBytes);
    const obj = await dsOpenWith(row, keyB64);
    const u = (obj.users || []).find(function (x) { return String(x.username).toLowerCase() === String(username).toLowerCase(); });
    if (!u) return false;
    const vr = await verifyUserPw(u, password, obj.v2); if (!vr || !vr.ok) return false;
    return { chan: chan, keyB64: keyB64, obj: obj, by: row.pushed_by || 'another device', at: row.pushed_at };
  }
  /* install a verified cloud copy on this device and join its sync channel */
  function dsInstallFrom(hit, owner) {
    try {
      dsMergeAccounts(hit.obj, 'install', hit.obj.v2);
      try { localStorage.removeItem(LS_KEY); } catch (e2) {}
      if (hit.obj.v3 && hit.obj.v3.index) {   /* class workbooks travel here too: otherwise the device lands class-less */
        setClassIndex(hit.obj.v3.index);
        for (const cid of Object.keys(hit.obj.v3.blobs || {})) localStorage.setItem(classBlobKey(cid), JSON.stringify(hit.obj.v3.blobs[cid]));
        try { localStorage.setItem(MODE_KEY, 'class'); } catch (e3) {}
      }
    } catch (e) { throw new Error('could not store the cloud copy on this device: ' + e.message); }
    const cfg = dsCfg() || {};
    cfg.on = true; cfg.channel = hit.chan; cfg.key = hit.keyB64; cfg.owner = owner; cfg.adoptedAcct = true;
    cfg.device = cfg.device || dsDeviceName(); cfg.pairedAt = cfg.pairedAt || new Date().toISOString();
    dsSaveCfg(cfg);
    try { localStorage.removeItem(DS_DECLINED_KEY); } catch (e2) {}
    dsBootFloor(hit.obj.ts);
  }
  function dsPair(channel, key) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { try { location.hash = ''; } catch (e2) {} }
    const cfg = dsCfg() || {};
    cfg.on = true; cfg.channel = channel; cfg.key = key;
    cfg.device = cfg.device || dsDeviceName(); cfg.pairedAt = new Date().toISOString();
    dsSaveCfg(cfg);
    const fresh = !readV2() && getAuth().users.length === 0;
    toast(fresh ? 'Device paired: now sign in with your SPR account; your data arrives from the cloud'
                : 'Device paired: cloud sync is on and will be checked when an admin signs in');
    if (document.body.classList.contains('auth-gate')) renderLogin();
  }
  function dsEnable() {
    if (!dsAdminActive()) { toast('Sign in as the admin to turn on device sync', true); return; }
    (async () => {
      const ok = await confirmDlg('Turn on device sync?',
        'SPR will keep an <b>encrypted copy of everything</b>: all classes, all sign-ins: in your private cloud channel after each change.<br><br>On any other system, <b>just sign in with this admin account</b>: the whole markbook arrives automatically, no links needed. The copy is sealed so the cloud never sees names, scores or passwords: the key is wrapped under your SPR password (and a pairing link stays available as a backup way in).<br><br>Last save wins across systems; keep downloading occasional local backups too.', 'Turn on');
      if (!ok) return;
      /* this account may already own a cloud copy (set up on another system):
         turning sync on must ADOPT that copy: never overwrite it with this
         browser's own (possibly empty) data */
      {
        const already = dsCfg();
        if (!already || !already.on) {
          let hit = null;
          if (SESSION.pw) { try { hit = await dsAccountLookup(SESSION.user, SESSION.pw); } catch (e) { hit = null; } }
          if (hit) {
            const okGo = await confirmDlg('This account already has a cloud copy',
              'The account <b>' + U.esc(SESSION.user) + '</b> already keeps an <b>encrypted cloud copy</b>: saved <b>' + new Date(hit.at || Date.now()).toLocaleString() + '</b> by <b>' + U.esc(String(hit.by)) + '</b>.<br><br>Open it here and turn on device sync? This device&rsquo;s current data is kept as a safety copy you can restore (Manage &rarr; Backups).', 'Open cloud copy');
            if (!okGo) { toast('Device sync left unchanged'); return; }
            stashSafetyBackup('before replacing data');
            dsInstallFrom(hit, SESSION.user);
            dsInstall(hit.obj);
            return;
          }
        }
      }
      const cfg = dsCfg() || {};
      cfg.on = true;
      cfg.owner = SESSION.user;
      cfg.channel = cfg.channel || uuid();   /* replaced by the account channel on first push */
      cfg.key = cfg.key || b64uFromBytes(crypto.getRandomValues(new Uint8Array(32)));
      cfg.device = cfg.device || dsDeviceName(); cfg.pairedAt = new Date().toISOString();
      dsSaveCfg(cfg);
      const done = await dsPushNow(false);
      toast(done ? 'Device sync is on: cloud copy saved. On other systems, just sign in with this account.'
                 : 'Device sync is on, but the first cloud save failed: it will retry on your next change.', !done);
      if (location.hash === '#/manage') renderManage();
    })();
  }
  function dsLinkModal() {
    if (!isAdmin()) { toast('Device sync is managed by the administrator', true); return; }
    const link = dsLink();
    if (!link) { toast('Turn on device sync first', true); return; }
    openDlg(
      '<h3>Pair another system</h3>' +
      '<p class="small">Easiest way: on the other system <b>just sign in with your SPR admin account</b>: everything arrives from the cloud automatically.<br><br>This link is the <b>backup way</b>: open it once on a system (or scan the code with a phone) to pair it without typing the admin account. The link contains the decryption key: share it with <b>nobody</b>. The pairing also travels inside your JSON backups.</p>' +
      '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
        '<div id="dsQrBox" style="background:#fff;padding:10px;border-radius:8px;border:1px solid #d8e2d8"></div>' +
        '<div style="flex:1;min-width:220px"><input class="inp" id="dsLinkInp" readonly style="font-size:12px" value="' + U.esc(link) + '">' +
        '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
        (navigator.share ? '<button class="btn primary" data-action="ds-share">Share…</button>' : '') +
        '<button class="btn" data-action="ds-copy">Copy link</button>' +
        '<button class="btn" data-action="ds-ding">Open in DingTalk</button>' +
        '<button class="btn" data-x="ds-close">Close</button></div>' +
        '<p class="small muted" style="margin-top:8px">' + (navigator.share
          ? 'Share opens your phone&rsquo;s share sheet (WeChat, WhatsApp, QQ, email…). <b>Send it only to yourself</b>: e.g. WeChat File Transfer or your own email.'
          : 'On a computer: copy the link, or let your phone scan the code. <b>Keep it only for yourself.</b>') + '</p></div>' +
      '</div>',
      (d) => {
        try {
          const q = qrcode(0, 'M'); q.addData(link); q.make();
          const box = $('#dsQrBox'); if (box) box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2 });
        } catch (e) { const box = $('#dsQrBox'); if (box) box.textContent = 'QR unavailable: use the link'; }
        d.onclick = (e) => { if (e.target.closest('[data-x="ds-close"]')) closeDlg(); };
      }
    );
  }
  function dsOff(withDelete) {
    if (!isAdmin()) { toast('Device sync is managed by the administrator', true); return; }
    const cfg = dsCfg(); if (!cfg || !cfg.on) return;
    (async () => {
      const ok = await confirmDlg(withDelete ? 'Turn off and delete the cloud copy?' : 'Turn off device sync?',
        withDelete ? 'Syncing stops and SPR tries to <b>delete the encrypted copy</b> from your cloud channel. Everything on this device stays untouched.'
                   : 'Syncing stops on this device. The encrypted cloud copy stays in place until you delete it (“Turn off &amp; delete”). Everything on this device stays untouched.',
        withDelete ? 'Turn off & delete' : 'Turn off');
      if (!ok) return;
      if (withDelete) {
        /* Supabase/PostgREST quirk: a DELETE the row policy ignores still
           returns 204: so the authoritative step is overwriting the payload
           with a dead tombstone (destroys the ciphertext); row removal via
           DELETE is only a best-effort extra. */
        let dead = false;
        try {
          const r2 = await sbSave(cfg.channel, { sprDS: 0, dead: 1 }, 'devicesync', 'turned off', new Date().toISOString(), false);
          dead = (r2 === 'ok');
          if (dead) { try { await fetch(SB().url + '/rest/v1/spr_channels?id=eq.' + encodeURIComponent(cfg.channel), { method: 'DELETE', headers: sbHeaders() }); } catch (e2) {} }
        } catch (e) { dead = false; }
        /* teacher sign-in pointers die with the school channel */
        for (const un of Object.keys(cfg.pointers || {})) { try { await dsKillPointer(un); } catch (e2) {} }
        toast(dead ? 'Cloud copy deleted' : 'The cloud copy could not be cleared: it stays encrypted and unreadable without your pairing link.', !dead);
      }
      dsSaveCfg(null);
      toast('Device sync is off');
      if (location.hash === '#/manage') renderManage();
    })();
  }
  function dsManageCard() {
    const cfg = dsCfg();
    if (!cfg || !cfg.on) {
      return '<div class="panel" style="margin-top:10px"><p class="small" style="margin-bottom:8px"><b>Device sync</b>: keep an encrypted copy of the whole markbook in your private cloud channel, so every system you sign in on shows the same data. The copy is sealed under your SPR account: sign in anywhere with your admin username and password and everything arrives: the cloud stores only unreadable bytes.</p>' +
        '<div class="flex"><button class="btn" data-action="ds-enable">Turn on device sync</button>' +
        '<span class="small muted" style="align-self:center">Optional: SPR works fully without it.</span></div></div>';
    }
    const when = function (iso) { return iso ? new Date(iso).toLocaleString() : '—'; };
    return '<div class="panel" style="margin-top:10px"><p class="small" style="margin-bottom:8px"><b>Device sync is on.</b> ' +
      (cfg.lastResult === 'fail' ? '<span style="color:#b45309">Last cloud save failed: it will retry automatically.</span>'
                                  : 'An encrypted copy of everything is updated after each change.') + '</p>' +
      '<table class="tbl"><tbody>' +
      '<tr><td style="width:180px">This device</td><td>' + U.esc(cfg.device || '—') + '</td></tr>' +
      '<tr><td>Last cloud save</td><td>' + U.esc(when(cfg.lastPush)) + '</td></tr>' +
      '<tr><td>Last cloud check</td><td>' + U.esc(when(cfg.lastCheck)) + '</td></tr>' +
      '</tbody></table>' +
      '<div class="flex" style="margin-top:10px"><button class="btn sm" data-action="ds-now">Check for newer copy</button>' +
      '<button class="btn sm" data-action="ds-test">Test cloud connection</button>' +
      '<button class="btn sm" data-action="ds-link">Show pairing link &amp; QR</button>' +
      '<button class="btn sm" data-action="ds-off">Turn off</button>' +
      '<button class="btn sm danger" data-action="ds-off-del">Turn off &amp; delete cloud copy</button></div>' +
      '<p class="small muted" style="margin-top:8px">Other systems: just sign in with your admin account. The pairing link (below) and JSON backups are backup ways to carry the key.</p></div>';
  }

  const AUTH_KEY = 'spr-auth-v1';
  const MASTER_KEY = '__master__';   /* reserved wrap slot: admin recovery key */
  function masterWrap() { const v = readV2(); return (v && v.wraps && v.wraps[MASTER_KEY]) || null; }
  function isAdmin() { return (currentUser() || {}).role === 'admin'; }

  /* Password verification WITHOUT any stored hash: try (1) the account's
     login wrap, (2) the v2 master-key wrap, (3) a legacy FNV hash: the last
     only to migrate pre-P1.1 accounts, and only until they next sign in. */
  /* data-key wraps are keyed by the account's stored username, but users type
     the name in any case ("Mo"/"mo"): look the wrap up case-insensitively so
     a wrap stored under one spelling unlocks the account under another */
  function wrapForV2(v2, name) {
    if (!v2 || !v2.wraps || !name) return null;
    if (v2.wraps[name]) return v2.wraps[name];
    const k = String(name).toLowerCase();
    for (const key of Object.keys(v2.wraps)) { if (key.toLowerCase() === k && v2.wraps[key]) return v2.wraps[key]; }
    return null;
  }
  async function verifyUserPw(user, password, v2) {
    if (user.login && (await CS.verifyLogin(user.login, password))) return { ok: true, via: 'login' };
    const w = wrapForV2(v2, user.username);
    if (w) { try { await unwrapWrap(w, password); return { ok: true, via: 'v2' }; } catch (e) {} }
    if (user.hash && user.hash === hashPassword(password)) return { ok: true, via: 'legacy-hash', staleDefault: user.hash === LEGACY_DEFAULT_HASH };
    return { ok: false };
  }
  function hashPassword(pw) {
    let h = 0x811c9dc5;
    for (let i = 0; i < pw.length; i++) {
      h ^= pw.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  /* FNV-1a hash of the RETIRED public default password — kept only to detect
   accounts still on it and force a rotation. No plaintext default ships. */
  const LEGACY_DEFAULT_HASH = '1yby56e';
  function getAuth() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) {}
    if (!d || !Array.isArray(d.users)) d = { users: [], session: null };
    return d; /* fresh installs stay empty until first-run setup creates a user */
  }
  function saveAuth(auth) { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }

  function isLoggedIn() {
    /* online: a session exists only while this tab holds the unlocked master
       key; offline (file://): legacy localStorage session */
    if (cryptoOK()) return !!(SESSION.dk && SESSION.user);
    const a = getAuth(); return !!(a.session && a.session.username);
  }
  function currentUser() {
    if (cryptoOK() && SESSION.user) {
      const a = getAuth();
      const u = (a.users || []).find((x) => x.username === SESSION.user);
      return { username: SESSION.user, name: (u && u.name) || SESSION.user, role: (u && u.role) || 'teacher' };
    }
    const a = getAuth(); return a.session;
  }
  /* accounts still on their seeded password can be issued a data key at
     migration time; there is no password-change UI, so this is all accounts */
  /* no seeded accounts — the first user on a device creates their own sign-in */
  async function doLoginFull(username, password) {
    username = String(username || '').trim();
    if (username.toLowerCase() === MASTER_KEY) return { error: 'Invalid username or password.' };
    /* fresh browser: quietly pull accounts + data from the cloud, then sign
       in normally. Unpaired browsers need nothing but the admin account:
       the channel is derived from the username and the key is password-wrapped.
       Paired browsers try their pairing first (covers pre-migration rows),
       then the account. */
    let installedFromCloud = false;
    const freshBrowser = !readV2() && getAuth().users.length === 0;
    if (cryptoOK() && freshBrowser) {
      let pairErr = null, netErr = null;
      if (dsOn()) {
        try { installedFromCloud = await dsFreshInstall(username, password); }
        catch (e) { pairErr = e; if (/^cannot reach/.test(e.message || '')) netErr = e; }
      }
      /* no automatic cloud lookup here: while sync is OFF, signing in must not
         contact the cloud at all. Users coming from another device press
         "I use SPR on another device" on the sign-in card instead. */
      if (!installedFromCloud) {
        if (netErr) throw netErr;              /* offline: say so instead of "invalid password" */
        if (dsOn() && pairErr) throw pairErr;  /* e.g. paired, but no cloud copy exists yet */
      }
    }
    const auth = getAuth();
    /* username matching is case-insensitive: the cloud channel already
       lowercases (dsChan), and users type "mo"/"Mo"/"MO" interchangeably */
    const user = auth.users.find((u) => String(u.username).toLowerCase() === username.toLowerCase());
    if (user && user.disabled) return { error: 'This account is disabled \u2014 ask your administrator.' };
    if (!user) {
      if (auth.users.length === 0) {
        return { error: 'This device holds no accounts yet. If you use SPR on another device, tap "I use SPR on another device" below to pull your cloud copy: or set up this device fresh.' };
      }
      return { error: 'Invalid username or password.' };
    }
    const vv2 = readV2();
    const vres = await verifyUserPw(user, password, vv2);
    if (!vres.ok) return { error: 'Invalid username or password.' };
    if (vres.via === 'legacy-hash') {
      /* one-time migration off the stored hash: safety copy, then a login
         wrap replaces it (any stale FNV hash leaves this device for good) */
      stashSafetyBackup('before password-verification migration');
      user.login = await CS.loginWrap(password);
      delete user.hash;
      saveAuth(auth);
    }
    if (!cryptoOK()) {
      auth.session = { username: user.username, name: user.name, role: user.role };
      saveAuth(auth);
      return { user: auth.session };
    }
    let v2 = readV2();
    let dk;
    if (!v2) {
      /* first encrypted run: seal the current workbook under this user's password */
      dk = crypto.getRandomValues(new Uint8Array(32));
      v2 = { fmt: 2, wraps: {}, ts: Date.now() };
      v2.wraps[user.username] = await makeWrap(dk, password);   /* canonical spelling: typed case must not fork the wrap */
      DB = DB || emptyDB();
      v2.data = await sealDB(DB, dk);
      writeV2(v2);
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
    } else {
      const w = wrapForV2(v2, user.username);
      if (!w) return { error: 'No data key is stored for this account. Sign in as the admin once, then sign in again with this account.' };
      try { dk = await unwrapWrap(w, password); }
      catch (e) { return { error: 'Invalid username or password.' }; }
      if (sprMode() === 'class') {
        /* class mode: v2 is only the pre-migration archive — open the user's
           class workbook instead of loading the legacy markbook */
        DB = emptyDB();
      } else {
        try { DB = normalizeDB(await unsealDB(v2.data, dk)); }
        catch (e) { return { error: 'Could not open the encrypted workbook.' }; }
      }
    }
    SESSION = { user: user.username, dk: dk, pw: password, keys: {} };
    /* class mode: unwrap this account's class keys (wrapped under the same password) */
    for (const cid of Object.keys(user.keyring || {})) {
      try { SESSION.keys[cid] = await CS.unwrapKey(user.keyring[cid], password); } catch (e) { /* wrong-wrap: skip */ }
    }
    auth.session = { username: user.username, name: user.name, role: user.role };
    saveAuth(auth);
    classKeysToSession();
    if (sprMode() === 'class') {
      const ix = classIndex();
      const lastId = localStorage.getItem('spr-last-class');
      const openable = function (c) { return SESSION.keys[c.id] && localStorage.getItem(classBlobKey(c.id)); };
      const hasBlob = function (c) { return !!localStorage.getItem(classBlobKey(c.id)); };
      /* key in hand -> open right away; otherwise a single class with data on
         this device is STILL auto-opened: openClass either derives the key
         from the just-typed password or shows one honest recovery screen:
         never the bare chooser (the 2026-10-24 owner's case) */
      const meta = ix.find((c) => c.id === lastId && openable(c)) || ix.filter(openable)[0]
        || ((ix.filter(hasBlob).length === 1 && SESSION.pw) ? ix.filter(hasBlob)[0] : null);
      if (meta) SPR_LOGIN_AUTO_CLASS = meta.id;   /* opened after the gate drops */
    }
    await persistNow(true);
    if (!installedFromCloud && dsOn()) setTimeout(function () { dsPullCheck(false); }, 1500);   /* paired devices only: keep the cloud copy current. With sync OFF, nothing contacts the cloud at sign-in - the explicit Manage action or the other-device button does that. */
    /* fresh sign-in with device sync on: push soon even without a data change,
       so a legacy channel migrates home and the owner's password wrap lands on
       the row (a fresh device cannot bootstrap until the wrap exists) */
    if (SESSION.pw && dsCanPush()) scheduleSyncPush();
    if (installedFromCloud) toast('Welcome back: your data arrived from the cloud');
    return { user: auth.session };
  }
  function doLogout() {
    const auth = getAuth();
    auth.session = null;
    saveAuth(auth);
    try { sessionStorage.removeItem('spr-session'); sessionStorage.removeItem('spr-session-db'); } catch (e) {}
    SESSION = { user: null, dk: null, pw: null, keys: {} }; CLS = null; CLS_KEY = null;
    location.reload();
  }
  async function addUser(username, password, name, role) {
    const auth = getAuth();
    username = String(username || '').trim();
    if (auth.users.some((u) => String(u.username).toLowerCase() === username.toLowerCase())) return 'username taken';
    const pwErr = CS.pwOk(role || 'teacher', password);
    if (pwErr) return pwErr;
    dsClearGone(username);   /* re-creating a previously deleted name lifts its sync tombstone */
    auth.users.push({ username: username, name: name, role: role || 'teacher', keyring: {}, login: await CS.loginWrap(password) });
    saveAuth(auth);
    return null;
  }
  /* create an account AND make it usable: master-key wrap under the same
     password (login requires it), optional class-key wraps added by callers */
  async function provisionUser(username, password, name, role) {
    const err = await addUser(username, password, name, role);
    if (err) return err;
    if (cryptoOK() && SESSION.dk) {
      try {
        const v2 = readV2() || { fmt: 2, wraps: {} };
        v2.wraps = v2.wraps || {};
        v2.wraps[username] = await makeWrap(SESSION.dk, password);
        writeV2(v2);
      } catch (e) { return 'Account created, but key wrapping failed: ' + e.message; }
    }
    return null;
  }
  /* rotate an account password completely: hash + master-key wrap, so a
     generated password from pairing/rostering is a REAL new password */
  async function rotateUserPassword(username, password) {
    const auth = getAuth();
    const u = auth.users.find((x) => x.username === username);
    if (!u) return 'no such user';
    const pwErr = CS.pwOk(u.role, password);
    if (pwErr) return pwErr;
    u.login = await CS.loginWrap(password);
    delete u.hash;   /* P1.1: hashes are gone for good */
    if (cryptoOK() && SESSION.dk) {
      try {
        const v2 = readV2() || { fmt: 2, wraps: {} };
        v2.wraps = v2.wraps || {};
        v2.wraps[u.username] = await makeWrap(SESSION.dk, password);
        writeV2(v2);
      } catch (e) { return 'password set, but key wrapping failed: ' + e.message; }
    }
    saveAuth(auth);
    return null;
  }
  function removeUser(username) {
    const auth = getAuth();
    if (username === 'mo') return 'cannot remove admin';
    auth.users = auth.users.filter((u) => u.username !== username);
    saveAuth(auth);
    return null;
  }

  let SPR_LOGIN_AUTO_CLASS = null;   /* class to open right after sign-in completes */
  let RESTORING = false;   /* a restored session is mid-way opening its class: closeClass()/route() must not tear it down during the await (the queued hashchange race ate restores on slow environments) */
  let loginSetupMode = false;   /* fresh browsers open on the sign-in card: signing in with an existing account pulls its data from the cloud; setup is an explicit choice */
  /* ---- explicit "I use SPR on another device": the ONLY sign-in-time cloud
     contact, and only because the user asked for it ---- */
  function otherDeviceDialog() {
    if (!cryptoOK()) { toast('The offline (file://) version cannot reach cloud copies: use the same browser profile or a backup file.', true); return; }
    openDlg(
      '<h3>Use SPR on another device</h3>' +
      '<p class="small">Sign in with your usual SPR account: SPR looks up the <b>encrypted cloud copy</b> (if device sync was set up) and installs it here. Nothing is sent anywhere until you press Continue.</p>' +
      '<label class="small">Username <input class="inp" id="odUser" style="width:100%" autocomplete="username"></label>' +
      '<label class="small" style="margin-top:8px">Password <input class="inp" id="odPass" type="password" style="width:100%" autocomplete="current-password"></label>' +
      '<div class="login-err" id="odErr" aria-live="assertive"></div>' +
      '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1">Continue</button></div>',
      function (d) {
        d.onclick = async function (e) {
          const b = e.target.closest('[data-x]');
          if (!b) return;
          if (b.dataset.x === '0') { closeDlg(); return; }
          const un = ($('#odUser').value || '').trim(), pw = $('#odPass').value || '';
          if (!un || !pw) { $('#odErr').textContent = 'Enter your username and password.'; return; }
          b.disabled = true; const eEl0 = $('#odErr'); if (eEl0) eEl0.textContent = 'Looking up the encrypted cloud copy…';
          try {
            let hit = null;
            try { hit = await dsAccountLookup(un, pw); }
            catch (e2) { throw new Error('cannot reach the cloud (' + e2.message + '): check your internet'); }
            if (hit === false) { $('#odErr').textContent = 'Wrong password for that account.'; return; }
            if (!hit) { $('#odErr').textContent = 'No cloud copy found for that account (device sync may not be set up). First-run setup or a backup file also work.'; return; }
            const okGo = await confirmDlg('Open the cloud copy here?',
              'An encrypted copy saved <b>' + new Date(hit.at || Date.now()).toLocaleString() + '</b>' + (hit.by ? ' by <b>' + U.esc(String(hit.by)) + '</b>' : '') + ' was found.' +
              (readV2() ? '<br><br>This device\u2019s current data is kept as a safety copy you can restore (Manage &rarr; Backups).' : ''),
              'Open it here');
            if (!okGo) { closeDlg(); return; }
            stashSafetyBackup('before replacing data');
            dsInstallFrom(hit, hit.owner || un);
            const res = await doLoginFull(un, pw);
            if (res && res.error) { const eEl2 = $('#odErr'); if (eEl2) eEl2.textContent = res.error; else toast(res.error, true); return; }
            closeDlg(); document.body.classList.remove('auth-gate'); buildShell(); route(); maybeJoin();
            if (SPR_LOGIN_AUTO_CLASS) { const cid1 = SPR_LOGIN_AUTO_CLASS; SPR_LOGIN_AUTO_CLASS = null; openClass(cid1); }   /* paired sign-in goes straight into the class, like a normal sign-in */
          } catch (err) { const eEl = $('#odErr'); if (eEl) eEl.textContent = err.message || String(err); else toast('Sign-in failed: ' + (err.message || String(err)), true); }
          finally { b.disabled = false; }
        };
      });
  }

  function renderLogin() {
    const freshBrowser = getAuth().users.length === 0 && !readV2();
    const setupCard = freshBrowser && loginSetupMode;
    const card = setupCard
      ? '<div class="login-card">' +
          '<div class="login-logo">SPR</div>' +
          '<h2>Set up this browser</h2>' +
          '<p>Starting fresh? Create the sign-in that locks and unlocks this browser\u2019s student data: SPR has no server accounts, and this password never leaves this device.</p>' +
          '<div class="login-field"><label for="suUser">Username</label><input type="text" id="suUser" autocomplete="username"></div>' +
          '<div class="login-field"><label for="suPass">Password: this sign-in is the admin</label><input type="password" id="suPass" autocomplete="new-password"></div>' +
          '<div class="login-field"><label for="suConf">Confirm password</label><input type="password" id="suConf" autocomplete="new-password"></div>' +
          '<div class="login-err" id="suErr" aria-live="assertive"></div>' +
          '<button class="login-btn" data-action="first-run">Create sign-in</button>' +
          '<div style="margin-top:10px"><button type="button" style="background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:13px;text-decoration:underline" data-action="show-signin">&larr; I already use SPR: sign in instead</button></div>' +
          '<div class="login-foot">Designed for teachers, by a teacher<br>\u2014 Mohammed Shehzad Khan (Teacher Mo)</div>' +
        '</div>'
      : '<div class="login-card">' +
          '<div class="login-logo">SPR</div>' +
          '<h2>Student\u2019s Performance Report (SPR)</h2>' +
          '<p>' + (cryptoOK() ? 'Sign in: your password unlocks the encrypted class data in this browser. Closing the browser locks it again.' : 'Sign in to access student data. Offline mode: data is stored unencrypted in this browser.') +
          (cryptoOK() && freshBrowser ? '<br><b>New device?</b> If you already use SPR elsewhere, use <b>I use SPR on another device</b> below: your data arrives from the encrypted cloud copy.' :
           (cryptoOK() && dsOn() && !readV2() ? '<br><b>Paired for device sync</b>: sign in and your data arrives from the cloud.' : '')) + '</p>' +
          '<div class="login-field"><label for="loginUser">Username</label><input type="text" id="loginUser" autocomplete="username"></div>' +
          '<div class="login-field"><label for="loginPass">Password</label><input type="password" id="loginPass" autocomplete="current-password"></div>' +
          '<div class="login-err" id="loginErr" aria-live="assertive"></div>' +
          '<button class="login-btn" data-action="do-login">Sign In</button>' +
          (masterWrap() ? '<div style="margin-top:10px"><button type="button" style="background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:13px;text-decoration:underline" data-action="master-recover-open">Forgot the admin password?</button></div>' : '') +
          '<div class="small" style="margin-top:10px;opacity:.75">Teacher and forgot your password? Ask the administrator to reset it (<b>Users &rarr; Reset password</b>).</div>' +
          (cryptoOK() ? '<div style="margin-top:10px"><button type="button" style="background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:13px;text-decoration:underline" data-action="login-other-device">I use SPR on another device &rarr;</button></div>' : '') +
          (cryptoOK() && freshBrowser ? '<div style="margin-top:10px"><button type="button" style="background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:13px;text-decoration:underline" data-action="show-setup">First time using SPR? Set up this browser &rarr;</button></div>' : '') +
          '<div class="login-foot">Designed for teachers, by a teacher<br>\u2014 Mohammed Shehzad Khan (Teacher Mo)</div>' +
        '</div>';
    openDlg(card);
    setTimeout(function() { var u = document.getElementById(setupCard ? 'suUser' : 'loginUser'); if (u) u.focus(); }, 50);
  }
  async function firstRunCreate(username, password) {
    const auth = getAuth();
    if (auth.users.some((u) => u.username === username)) return { error: 'That username already exists on this device.' };
    if (!cryptoOK()) {
      auth.users.push({ username: username, name: username, role: 'admin', keyring: {}, login: await CS.loginWrap(password) });
      auth.session = { username: username, name: username, role: 'admin' };
      saveAuth(auth);
      return { user: auth.session };
    }
    const dk = crypto.getRandomValues(new Uint8Array(32));
    const v2 = { fmt: 2, wraps: {}, ts: Date.now() };
    v2.wraps[username] = await makeWrap(dk, password);
    DB = DB || emptyDB();
    v2.data = await sealDB(DB, dk);
    writeV2(v2);
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    auth.users.push({ username: username, name: username, role: 'admin', keyring: {}, login: await CS.loginWrap(password) });
    auth.session = { username: username, name: username, role: 'admin' };
    saveAuth(auth);
    SESSION = { user: username, dk: dk, pw: password, keys: {} };
    try { sessionStorage.setItem('spr-session', JSON.stringify({ user: username, dk: b64uFromBytes(dk) })); } catch (e) {}
    return { user: auth.session };
  }



  async function init() {
    chartTheme();
    DS_BOOT_TS = (readV2() || {}).ts || 0;   /* boot-time data age, for device-sync pull checks */
    KNOWN_STORE_TS = DS_BOOT_TS;             /* stale-tab guard baseline (item 1) */
    KNOWN_STORE_TS = DS_BOOT_TS;             /* stale-tab guard baseline (item 1) */
    try { DS_BOOT_TS = Math.max(DS_BOOT_TS, Number(localStorage.getItem('spr-ds-boot') || 0) || 0); } catch (e) {}
    window.addEventListener('online', function () { const c = dsCfg(); if (c && c.on && c.lastResult === 'fail') scheduleSyncPush(); });
    /* a push scheduled but not yet fired when the tab is hidden/closed would
       otherwise leave the cloud copy one edit behind: flush best effort */
    function dsFlushPending() {
      if (dsTimer) { clearTimeout(dsTimer); dsTimer = null; try { dsPushNow(false); } catch (e) {} }
    }
    function flushPendingSave() {
      if (!saveTimer) return;
      clearTimeout(saveTimer); saveTimer = null;
      if (CLS && CLS_KEY) classPersistNow(true);
      else if (cryptoOK() && SESSION.dk) persistNow(true);
      else { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) {} }
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { flushPendingSave(); dsFlushPending(); } });
    window.addEventListener('pagehide', function () { flushPendingSave(); dsFlushPending(); });
    DB = emptyDB();
    buildShell();
    document.title = "Student's Performance Report";
    window.addEventListener('hashchange', function () { route(); maybeJoin(); });
    window.addEventListener('storage', function (e) {
      if (e.key === V2_KEY || e.key === LS_KEY || (CLS && CLS_KEY && e.key === classBlobKey(CLS.id))) {
        if (SESSION && SESSION.dk) showStaleOverlay();   /* another tab wrote newer data */
        else toast('Data changed in another tab: reload this tab to see it.', true);
      }
    });
    route();
    let ready = false;
    if (cryptoOK()) {
      try {
        const sess = JSON.parse(sessionStorage.getItem('spr-session') || 'null');
        const v2 = readV2();
        if (sess && sess.user && sess.dk && (v2 || sprMode() === 'class')) {
          SESSION = { user: sess.user, dk: bytesFromB64u(sess.dk), keys: {} };
          for (const k of Object.keys(sess.keys || {})) { try { SESSION.keys[k] = bytesFromB64u(sess.keys[k]); } catch (e2) {} }
          if (sprMode() === 'class') {
            /* open the last-used class this account still holds a key for */
            try { window.__SPR_RESTORE_STEP = 'entered sess=' + !!sess + ' keys=' + Object.keys(SESSION.keys || {}).join(','); } catch (e9) {}
            const lastId = localStorage.getItem('spr-last-class');
            const ix = classIndex(); const meta = ix.find((c) => c.id === lastId) || ix.filter((c) => SESSION.keys[c.id])[0];
            try { window.__SPR_RESTORE_STEP += ' meta=' + (meta ? meta.id : 'MISSING') + ' hasKey=' + !!(meta && SESSION.keys[meta.id]); } catch (e9) {}
            if (meta && SESSION.keys[meta.id]) {
              RESTORING = true;
              try {
                const raw = localStorage.getItem(classBlobKey(meta.id));
                try { window.__SPR_RESTORE_STEP += ' raw=' + (raw ? raw.length : 'null'); } catch (e9) {}
                if (raw) { CLS = { id: meta.id }; CLS_KEY = SESSION.keys[meta.id]; CLS_TS = classBlobTs(raw) || Date.now(); DB = normalizeDB(await CS.openClass(JSON.parse(raw), CLS_KEY)); DB.sprClass = 1; DB.id = meta.id; try { window.__SPR_RESTORE_STEP += ' decrypted'; } catch (e9) {} }
              } catch (e3) { try { window.__SPR_RESTORE_ERR = (e3 && e3.message) || 'unknown restore error'; } catch (e4) {} console.warn('[spr] the saved class copy could not be opened on restore:', e3 && e3.message); CLS = null; CLS_KEY = null; }
            }
            RESTORING = false;
            if (!CLS) DB = emptyDB();
            else {
              /* the early route() bounced a class-mode #/dashboard to #/classes
                 while CLS was still null: now that the class is open, go back.
                 history.replaceState, NOT location.hash: jsdom (and some real
                 embedding contexts) apply hash writes asynchronously, so an
                 immediate route() still sees the old #/classes with CLS set
                 and closeClass() throws the freshly restored class away. */
              ui.classOpen = true;
              try { window.__SPR_RESTORE_STEP += ' opened'; } catch (e9) {}
              try { history.replaceState(null, '', '#/dashboard'); } catch (e6) { location.hash = '#/dashboard'; }
              try { window.__SPR_RESTORE_STEP += ' pointed hash=' + location.hash; } catch (e9) {}
              buildShell(); route();
              try { window.__SPR_RESTORE_STEP += ' routed hash=' + location.hash; } catch (e9) {}
            }
          } else {
            DB = normalizeDB(await unsealDB(v2.data, SESSION.dk));
          }
          const auth = getAuth();
          if (!auth.session || auth.session.username !== sess.user) {
            const u = (auth.users || []).find((x) => x.username === sess.user);
            auth.session = { username: sess.user, name: (u && u.name) || sess.user, role: (u && u.role) || 'teacher' };
            saveAuth(auth);
          }
          ready = true;
          try { window.__SPR_SESSION_RESTORED = sess.user; } catch (e5) {}
        }
      } catch (e) { try { sessionStorage.removeItem('spr-session'); } catch (e2) {} }
      if (!ready) {
        const legacy = loadDBLegacy();
        /* first run stays EMPTY — the teacher lands on the welcome screen and
           chooses how to start (new class / import / load sample). The demo
           class is only loaded on demand via "Load sample data". */
        DB = legacy || emptyDB();
      }
    } else {
      const legacy = loadDBLegacy();
      DB = legacy || emptyDB();
      ready = isLoggedIn();
    }
    if (!ready) {
      document.body.classList.add('auth-gate');
      if (privacyGateNeeded()) openPrivacyGate(function () { renderLogin(); });
      else renderLogin();
    }
    else {
      if (window.__SPR_CORRUPT) toast('A damaged data file was found and preserved: Manage → Data can download it.', true);
      if (privacyGateNeeded()) openPrivacyGate(null);
      /* session was restored after the first paint: re-render with the real DB
         so a reload lands on the current view instead of the empty welcome */
      buildShell(); route();
      /* item 6: a session mirror newer than the stored blob means the tab closed
         faster than the 300 ms debounce could save: offer it back */
      (function mirrorRecover() {
        try {
          const mir = JSON.parse(sessionStorage.getItem('spr-session-db') || 'null');
          if (mir && mir.ts && mir.db && mir.ts > ((readV2() || {}).ts || 0)) {
            confirmDlg('Recover your last edit?', 'The window closed before saving finished. The newer copy from that session can be brought back now.', 'Recover').then(function (yes) {
              if (!yes) return;
              try { DB = normalizeDB(mir.db); buildShell(); route(); persistNow(true); toast('Last edit recovered'); } catch (e) { toast('Could not recover that copy', true); }
            });
          }
        } catch (e) {}
      })();
      /* item 3: ask the browser to keep SPR storage (best effort, shown in Manage) */
      requestPersistentStorage();
      /* item 3: Safari/iOS can drop site data after ~7 days idle — say it once */
      (function iosDataWarn() {
        try {
          const ua = navigator.userAgent || '';
          const safariish = /iPad|iPhone|iPod/.test(ua) || (/Safari/.test(ua) && !/Chrom|Edg|Firefox/.test(ua));
          if (!safariish || localStorage.getItem('spr-ios-data-warn')) return;
          localStorage.setItem('spr-ios-data-warn', '1');
          openDlg('<h3>One thing to know about Safari</h3><p class="small">Safari on iPhone and iPad can remove website data after about 7 days of not using a site. Download a backup from the sidebar regularly, and keep a copy outside this device.</p><div class="dlg-actions"><button class="btn primary" data-action="privacy-ack">Got it</button></div>');
        } catch (e) {}
      })();
      /* item 3: many edits without a backup -> offer one (at most once a day) */
      (function backupAfterSession() {
        try {
          if (!DB.semesters.length) return;
          const n = Number(localStorage.getItem('spr-edits-since-backup')) || 0;
          const DAY = 86400000;
          const lastNudge = Number(localStorage.getItem('spr-backup-nudged-day')) || 0;
          if (n < 30 || (Date.now() - lastNudge) < DAY) return;
          localStorage.setItem('spr-backup-nudged-day', String(Date.now()));
          openDlg('<h3>Download a backup?</h3><p class="small">' + n + ' changes have been made since the last backup download. It takes one tap and keeps the class recoverable.</p><div class="dlg-actions"><button class="btn" data-action="dlg-close">Not now</button><button class="btn primary" data-action="dl-backup">Download backup</button></div>');
        } catch (e) {}
      })();
      /* gentle backup nudge: monthly reminder, at most once a week */
      (function nudgeBackup() {
        if (!DB.semesters.length) return;
        const DAY = 86400000, now = Date.now();
        const last = DB.settings.lastBackupAt || 0;
        const lastNudge = DB.settings.lastBackupNudgeAt || 0;
        if ((now - lastNudge) < 7 * DAY) return;
        if (last && (now - last) < 30 * DAY) return;
        const days = last ? Math.round((now - last) / DAY) : null;
        if (DB.settings.recoveryFilePending) {
          /* round5 item 3: the setup-time recovery file was empty; the honest
             one is generated HERE, from real data, at the first backup prompt */
          openDlg('<h3>Your recovery file needs updating</h3>' +
            '<p class="small">The recovery file from sign-up day was empty. This one is generated from your <b>current</b> data and restores your classes as of today. Save it with the school\u2019s records.</p>' +
            '<div class="dlg-actions"><button class="btn" data-action="dlg-close">Later</button>' +
            '<button class="btn primary" data-action="recovery-file-now">Download recovery file</button></div>');
          DB.settings.lastBackupNudgeAt = now; saveDB(true);
          return;
        }
        toast(days ? 'It has been ' + days + ' days since your last backup: download a fresh copy in Manage & setup.' : 'You have never downloaded a backup: keep a copy of your classes in Manage & setup.');
        DB.settings.lastBackupNudgeAt = now; saveDB(true);
      })();
    }
    maybeJoin();
  }
  /* test/debug hooks (read-only; used by the jsdom smoke suite) */
  window.SPR_DEBUG_GET_DB = function () { return DB; };
  /* round5: sync internals for the mock-PostgREST regression suite */
  window.SPR_SYNC_TEST = { push: function (interactive) { return dsPushNow(interactive); }, cfg: function () { return dsCfg(); }, canPush: function () { return dsCanPush(); }, hold: function () { return !!dsHoldPush; }, enrol: sbEnrol, write: sbWrite, ping: sbPing, sha256Hex: sha256Hex };
  window.SPR_DEBUG_UNWRAP = async function (username, pw) { try { const u = (getAuth().users || []).find(function (x) { return x.username === username; }); if (!u || !u.keyring) return 'no-keyring'; const cid = Object.keys(u.keyring)[0]; try { await CS.unwrapKey(u.keyring[cid], pw); return 'unwraps'; } catch (e) { return 'fails: ' + (e && e.message); } } catch (e) { return 'err: ' + e.message; } };
  window.SPR_DEBUG_AUTH = { get: getAuth, save: saveAuth, provision: provisionUser };
  window.SPR_DEBUG_SET_DB = function (d) { DB = d; try { if (SESSION.dk) persistNow(true); else saveDB(true); } catch (e) {} };
  window.SPR_DEBUG_MAYBE_JOIN = function () { maybeJoin(); };
  /* support/test hook for the sync engine (no secrets — the cfg already sits
     in this browser's localStorage): lets diagnostics and tests force one
     push/pull cycle deterministically instead of waiting on timers */
  window.SPR_DEBUG_DS = { cfg: dsCfg, canPush: dsCanPush, hold: function () { return dsHoldPush; }, push: dsPushNow };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
