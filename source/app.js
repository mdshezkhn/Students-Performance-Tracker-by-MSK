/* =========================================================================
   P4C4 Markbook — UI application (requires: Calc, Util, ExcelBridge, XLSX,
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
  const fmt = (v, d) => (v === null || v === undefined || isNaN(v)) ? '–' : Number(v).toFixed(d === undefined ? 1 : d);
  const r1x = (v) => (v === null ? null : Math.round(v * 10) / 10);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  /* ================================ state ================================ */
  const LS_KEY = 'p4c4-markbook-v1';
  const V2_KEY = 'p4c4-markbook-v2';
  const CORRUPT_PREFIX = 'p4c4-markbook-corrupt-';
  let DB = null, saveTimer = null;
  let SESSION = { user: null, dk: null };   // raw 256-bit master key, memory only (online mode)
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
    sem.observations = sem.observations || {};
    sem.spelling = sem.spelling || {};
    sem.daily = sem.daily || {};
    sem.tests = sem.tests || {};
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
       NEVER wipes on failure — a broken payload is preserved for recovery. */
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
    clearTimeout(saveTimer);
    if (cryptoOK() && SESSION.dk) saveTimer = setTimeout(() => persistNow(silent), 300);
    else saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) { toast('Could not save — storage full?', true); }
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
  async function persistNow(silent) {
    try {
      const v2 = readV2() || { fmt: 2, wraps: {} };
      v2.fmt = 2;
      v2.data = await sealDB(DB, SESSION.dk);
      v2.ts = Date.now();
      localStorage.setItem(V2_KEY, JSON.stringify(v2));
      flashSaved(silent);
    } catch (e) { toast('Could not save — storage full?', true); }
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
      a.download = 'SPR-backup-before-replace.json';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {}
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
  async function deriveKeyBits(password, saltBytes) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: 310000, hash: 'SHA-256' }, base, 256));
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
    return { salt: b64uFromBytes(salt), iv: b64uFromBytes(iv), ct: b64uFromBytes(ct) };
  }
  async function unwrapWrap(w, password) {
    const kb = await deriveKeyBits(password, bytesFromB64u(w.salt));
    const k = await aesKeyRaw(kb);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytesFromB64u(w.iv) }, k, bytesFromB64u(w.ct)));
  }
  function cur() { return DB.semesters.find((s) => s.id === DB.currentSemesterId) || DB.semesters[0] || null; }

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
    const root = $('#toast-root'); if (!root) return;
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => t.remove(), err ? 5200 : 2600);
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
  const NAV = [['dashboard', 'Dashboard'], ['students', 'Students'], ['entry', 'Enter scores'], ['grading', 'Grading'], ['analysis', 'Analysis'], ['reports', 'Report Cards'], ['manage', 'Manage & setup']];
  function buildShell() {
    const sem = cur();
    $('#app').innerHTML =
      '<div class="app">' +
        '<nav class="rail">' +
          '<div class="wordmark"><div class="wm-class">Student\'s Performance Report</div>' +
          '<div class="wm-sub">' + U.esc((sem && sem.school) || 'ESL') + (sem && sem.className ? ' · ' + U.esc(sem.className) : '') + '</div></div>' +
          '<div class="nav">' + NAV.map((n) => '<a href="#/' + n[0] + '" data-nav="' + n[0] + '">' + n[1] + '</a>').join('') + '</div>' +
          '<div class="rail-foot"><label for="semSelect">Semester</label>' +
            '<select id="semSelect">' + DB.semesters.map((s) => '<option value="' + U.esc(s.id) + '"' + (s.id === DB.currentSemesterId ? ' selected' : '') + '>' + U.esc(s.name) + '</option>').join('') + '</select>' +
            '<div class="saved-dot" id="savedDot"></div>' +
            (function() { var u = currentUser(); if (!u) return '';
              var ini = (u.name || u.username).charAt(0).toUpperCase();
              return '<div class="user-chip"><span class="uc-avatar">' + U.esc(ini) + '</span>' +
                '<span class="uc-info"><b>' + U.esc(u.name || u.username) + '</b><small>' + (u.role === 'admin' ? 'Admin' : 'Teacher') + '</small></span>' +
                '<button class="uc-out" data-action="logout" title="Sign out">Sign out</button></div>'; })() +
            '<span class="conf-tag">Confidential — student data</span>' +
            '<div class="rail-privacy"><a href="#" data-action="privacy-open">Privacy &amp; data notice</a></div>' +
            '<div class="quote">Designed for teachers, by a teacher<br>— Mohammed Shehzad Khan (Teacher Mo)</div></div>' +
        '</nav>' +
        '<main class="page"><div id="content"></div></main>' +
      '</div>' +
      '<div class="print-credit print-only">Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)</div>';
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
    killCharts(); closeDlg();
    if (!DB.semesters.length) { renderWelcome(); return; }
    if (!cur()) DB.currentSemesterId = DB.semesters[0].id;
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const view = parts[0] || 'dashboard';
    switch (view) {
      case 'students': renderStudents(); break;
      case 'student': renderStudent(decodeURIComponent(parts[1] || '')); break;
      case 'entry': renderEntry(parts[1] || 'sp'); break;
      case 'grading': renderGrading(); break;
      case 'analysis': ui.anMode = parts[1] === 'student' ? 'student' : 'class'; renderAnalysis(); break;
      case 'reports': ui.rptMode = parts[1] === 'student' ? 'student' : 'class'; renderReports(); break;
      case 'report': renderReportCard(decodeURIComponent(parts[1] || '')); break;
      case 'manage': renderManage(); break;
      default: renderDashboard();
    }
    railActive(view);
    window.scrollTo(0, 0);
  }

  /* ================================ welcome ================================ */
  function renderWelcome() {
    $('#app').innerHTML =
      '<div class="app"><main class="page" style="max-width:860px;margin:0 auto;width:100%">' +
        pageHead('Student\'s Performance Report', 'Track classroom observations, spelling, daily assignments, tests and grades — with live charts, cross-semester analysis and auto-generated RAG / SWOT remarks for every student.') +
        '<div class="empty" style="padding:56px 30px">' +
          '<div class="big" style="font-family:var(--font-display);font-size:24px">Set up your first class</div>' +
          '<p>School and class details, students, then weekly scores — the app does all the averaging and grading.</p>' +
          '<div class="flex" style="justify-content:center;margin-top:18px">' +
            '<button class="btn primary" data-action="wiz-open">New class (guided setup)</button>' +
            '<button class="btn" data-action="import-xlsx">Import SPR Excel file</button>' +
            '<button class="btn" data-action="load-sample">Load sample data</button>' +
          '</div>' +
          '<p class="small muted" style="margin-top:22px">Everything stays in this browser and works offline — nothing is sent to any server. Use “Download backup” in Manage to move data between computers.</p>' +
          '<div class="quote-inline">Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)</div>' +
          '<div class="rail-privacy" style="margin-top:14px;text-align:center"><a href="#" data-action="privacy-open">Privacy &amp; data notice</a></div>' +
        '</div>' +
        '<input type="file" id="file-xlsx" accept=".xlsx,.xls" hidden>' +
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
  function renderDashboard() {
    const sem = cur();
    const gAll = C.gradeAll(sem);
    const dist = C.gradeDistribution(sem);
    const risk = C.atRisk(sem);
    const comp = C.completeness(sem);
    const stars = gAll.filter((g) => g.final !== null).sort((a, b) => b.final - a.final).slice(0, 5);
    const now = new Date();
    const monthName = U.MONTHS[now.getMonth()];
    const inTerm = sem.months.includes(monthName);

    $('#content').innerHTML = pageHead('Class dashboard', U.esc(sem.name) + ' · ' + sem.students.length + ' students',
      '<a class="btn primary" href="#/entry/sp">Enter scores</a>' +
      '<a class="btn" href="#/grading">Grading</a>' +
      '<button class="btn" data-action="export-xlsx">Export SPR Excel</button>') +

      '<section class="cover">' +
        '<div class="cover-main">' +
          '<div class="cover-school">' + U.esc(sem.school) + '</div>' +
          '<div class="cover-line"><b>' + U.esc(sem.className || 'Class') + '</b> · ' + U.esc(sem.name) +
            (sem.months.length ? ' · ' + U.esc(U.MONTH_ABBR[sem.months[0]] || sem.months[0]) + '–' + U.esc(U.MONTH_ABBR[sem.months[sem.months.length - 1]] || sem.months[sem.months.length - 1]) : '') + '</div>' +
          '<div class="cover-teachers">Teachers: <b>' + (sem.teachers.length ? U.esc(sem.teachers.join(' · ')) : '–') + '</b></div>' +
        '</div>' +
        '<div class="cover-date">' +
          '<div class="cover-month">' + monthName + ' ' + now.getFullYear() + '</div>' +
          '<div class="cover-ym">today</div>' +
          (inTerm ? '<span class="in-term">current month of the term</span>' : '') +
        '</div>' +
      '</section>' +

      '<div class="kpi-strip">' +
        kpi(fmt(C.classFinalAvg(sem), 1), 'class final average') +
        kpi(dist['A*'] + ' / ' + sem.students.length, 'final grade A*') +
        kpi(risk.length, 'students need attention', risk.length > 0) +
        compKpi('observations', comp.obs) +
        compKpi('spelling', comp.spelling) +
        compKpi('daily assignments', comp.daily) +
      '</div>' +

      '<div class="grid-2">' +
        '<div class="panel"><h3>Class average by month</h3><div class="panel-sub">observations (monthly) · spelling · daily assignments (weekly)</div>' +
          '<div class="chart-box" style="height:250px"><canvas id="ch-trend"></canvas></div></div>' +
        '<div class="panel"><h3>Final grade distribution</h3><div class="panel-sub">weighted final score per student</div>' +
          '<div class="chart-box" style="height:250px"><canvas id="ch-dist"></canvas></div></div>' +
      '</div>' +

      '<div class="panel mt"><h3>Final score by student</h3><div class="panel-sub">sorted high to low — click a bar to open the student profile</div>' +
        '<div class="chart-box" style="height:' + Math.max(220, sem.students.length * 20) + 'px"><canvas id="ch-byStu"></canvas></div></div>' +

      '<div class="grid-2 mt">' +
        '<div class="panel"><h3>Needs attention</h3><div class="panel-sub">final below 50, ungraded parts, or core parts under 50</div>' +
          '<table class="tbl"><tbody>' +
          (risk.length
            ? risk.map((r) => {
                const stu = sem.students.find((s) => s.id === r.sid);
                return '<tr><td><a class="stu-link" href="#/student/' + U.esc(r.sid) + '">' + U.esc((stu && (stu.nameEn || stu.nameCn)) || r.sid) + '</a></td>' +
                  '<td class="small red-pen">' + U.esc(r.reasons.join(' · ')) + '</td></tr>';
              }).join('')
            : '<tr><td class="muted">No one needs attention right now.</td></tr>') +
          '</tbody></table></div>' +
        '<div class="panel"><h3>Top of the class</h3><div class="panel-sub">highest weighted final scores</div>' +
          '<table class="tbl"><tbody>' +
          stars.map((g, i) => {
            const stu = sem.students.find((s) => s.id === g.sid);
            return '<tr><td class="muted">' + (i + 1) + '</td>' +
              '<td><a class="stu-link" href="#/student/' + U.esc(g.sid) + '">' + U.esc((stu && (stu.nameEn || stu.nameCn)) || g.sid) + '</a></td>' +
              '<td class="num">' + fmt(g.final, 1) + '</td><td class="c">' + gBadge(g.letter) + '</td></tr>';
          }).join('') +
          '</tbody></table></div>' +
      '</div>';

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
    const sorted = gAll.filter((g) => g.final !== null).sort((a, b) => a.final - b.final);
    const sids = sorted.map((g) => g.sid);
    mkChart('ch-byStu', { type: 'bar',
      data: { labels: sorted.map((g) => { const s = sem.students.find((x) => x.id === g.sid); return (s && s.nameEn) || (s && s.nameCn) || g.sid; }),
        datasets: [{ data: sorted.map((g) => r1x(g.final)),
          backgroundColor: sorted.map((g) => GRADE_HEX[g.letter] || '#9aa0a0'), borderRadius: 3 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.parsed.x + '%' } } },
        onClick: (e, els) => { if (els.length) location.hash = '#/student/' + sids[els[0].index]; },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } } });
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
      (sem.students.length ? 'No students match your search.' : 'No students yet.') + '</div>' +
      (sem.students.length ? '' : '<p><a href="#/manage" class="stu-link">Add students in Manage & setup</a></p>') + '</div>';
    return list.map((s) => {
      const g = C.gradeStudent(sem, s.id);
      return '<a class="stu-card" href="#/student/' + U.esc(s.id) + '">' +
        '<div class="avatar">' + U.esc(avatarChar(s)) + '</div>' +
        '<div style="min-width:0;padding-right:56px"><div class="s-name">' + U.esc(s.nameEn || s.nameCn) + '</div>' +
        '<div class="s-meta">' + U.esc(s.nameCn || '') + (s.nameCn ? ' · ' : '') + U.esc(s.id) + '</div></div>' +
        gBadge(g.letter) + spark(sem, s.id) + '</a>';
    }).join('');
  }
  function renderStudents() {
    const sem = cur();
    $('#content').innerHTML = pageHead('Students', 'click a student for the full performance profile',
      '<input class="inp" id="stuSearch" placeholder="Search name or ID…" value="' + U.esc(ui.q) + '">') +
      '<div class="stu-grid" id="stuList">' + stuCards(sem) + '</div>';
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
        U.esc(s.name) + ' · ' + fmt(gg.final, 1) + '</button>';
    }).join('');
    return chips ? '<div class="month-pills" style="margin-top:8px">' + chips + '</div>' : '';
  }
  function contribTable(g) {
    const rows = Object.keys(g.parts).map((k) => {
      const p = g.parts[k], w = k === 'Written' ? 20 : 10;
      return '<tr><td>' + k + '</td><td class="num">' + fmt(p, 1) + '%</td><td class="c">' + gBadge(p === null ? null : C.letter(p)) + '</td>' +
        '<td class="num">' + w + '%</td><td class="num">' + (p === null ? '–' : fmt((p * w) / 100, 2)) + '</td></tr>';
    }).join('');
    return '<table class="tbl"><thead><tr><th>Component</th><th class="num">Score</th><th class="c">Grade</th><th class="num">Weight</th><th class="num">Contribution</th></tr></thead><tbody>' + rows +
      '<tr><td><b>Final</b></td><td class="num"><b>' + fmt(g.final, 1) + '%</b></td><td class="c">' + gBadge(g.letter) + '</td><td class="num">100%</td><td></td></tr></tbody></table>';
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
          '<div class="right"><div class="final-num">' + fmt(g.final, 1) + '</div><div class="small muted">weighted final · ' + completenessCount(g) + ' assessments in</div></div>' +
          '<div class="stamp" style="color:' + (GRADE_HEX[g.letter] || '#9aa0a0') + '"><small>FINAL GRADE</small>' + U.esc(g.letter || '–') + '</div>' +
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
      '<div class="panel"><h3>How the final grade adds up</h3><div class="panel-sub">component % × weight — same formula as the SPR Excel</div>' + contribTable(g) + '</div>';

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
    return '<div class="sheet-toolbar"><div class="month-pills">' +
      sem.months.map((m) => '<button class="month-pill' + (m === sel ? ' on' : '') + '" data-action="entry-month" data-metric="' + metric + '" data-month="' + U.esc(m) + '">' +
        '<span class="dot ' + monthDot(sem, metric, m) + '"></span>' + (U.MONTH_ABBR[m] || m) + '</button>').join('') +
      '</div></div>';
  }
  function tdAvg(id, v, cls) {
    return '<td class="avg' + (cls ? ' ' + cls : '') + (v !== null && v < 50 ? ' low' : '') + '" id="' + id + '"><strong>' + fmt(v, 1) + '</strong></td>';
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
        tds += '<td><input class="cell" data-kind="obs" data-sid="' + U.esc(s.id) + '" data-month="' + U.esc(month) + '" data-key="' + sk + '-LO' + lo + '" data-ri="' + ri + '" data-ci="' + ci + '" inputmode="decimal" value="' + (v === null ? '' : v) + '"></td>';
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
        tds += '<td><input class="cell" data-kind="week" data-sid="' + U.esc(s.id) + '" data-met="' + metKey + '" data-w="' + w + '" data-f="' + f + '" data-ri="' + ri + '" data-ci="' + ci + '" inputmode="decimal" value="' + (v === null || v === undefined ? '' : v) + '"></td>';
        ci++;
      }
      tds += tdAvg('mavg-' + U.esc(s.id), C.weeklyMonthPct(sem, s.id, metKey, month), 'sep');
      tds += tdAvg('savg-' + s.id, C.weeklySemesterPct(sem, s.id, metKey));
      return '<tr>' + tds + '</tr>';
    }).join('');

    let foot = '<tr><td class="stu">Class average</td>';
    for (let w = 1; w <= 5; w++) foot += '<td colspan="2" id="f-w' + w + '"></td>';
    foot += '<td id="f-mavg" class="sep"></td><td id="f-savg"></td></tr>';

    const defTot = metKey === 'spelling' ? DB.settings.spTotal : DB.settings.daTotal;
    return monthPills(sem, metric) +
      '<div class="sheet"><table class="grid"><thead>' + h1 + h2 + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      '<div class="legend"><span class="small muted">Enter score and total (usually out of ' + defTot + ') — month and semester averages compute automatically. Paste a block copied from Excel straight into the grid.</span></div>';
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
        tds += '<td><input class="cell" data-kind="test" data-sid="' + U.esc(s.id) + '" data-tp="' + b[0] + '" data-f="' + f + '" data-ri="' + ri + '" data-ci="' + ci + '" inputmode="decimal" value="' + (v === null || v === undefined ? '' : v) + '"></td>';
        ci++;
      }
      const g = C.gradeStudent(sem, s.id);
      for (const b of TEST_BLOCKS) tds += tdAvg('tp-' + b[0] + '-' + s.id, C.testPct(sem, s.id, b[0]));
      tds += '<td class="avg sep" id="tfin-' + U.esc(s.id) + '"><strong>' + fmt(g.final, 1) + '</strong></td>';
      tds += '<td class="avg" id="tgl-' + s.id + '">' + gBadge(g.letter) + '</td>';
      return '<tr>' + tds + '</tr>';
    }).join('');

    let foot = '<tr><td class="stu">Class average</td>';
    for (const b of TEST_BLOCKS) foot += '<td colspan="2"></td><td id="f-tp-' + b[0] + '"></td>';
    foot += '<td id="f-fin" class="sep"></td><td></td></tr>';

    return '<div class="sheet" style="margin-top:14px"><table class="grid" style="min-width:900px"><thead>' + h1 + h2 + '</thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      '<div class="legend"><span class="small muted">The final grade here already includes observations, spelling and daily assignments — Written counts 20%, every other part 10%.</span></div>';
  }
  function updateTestRow(sem, sid) {
    for (const b of TEST_BLOCKS) setAvgCell('tp-' + b[0] + '-' + sid, C.testPct(sem, sid, b[0]));
    const g = C.gradeStudent(sem, sid);
    const fin = document.getElementById('tfin-' + sid);
    if (fin) fin.innerHTML = '<strong>' + fmt(g.final, 1) + '</strong>';
    const gl = document.getElementById('tgl-' + sid);
    if (gl) gl.innerHTML = gBadge(g.letter);
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

    if (kind === 'obs') {
      const sid = el.dataset.sid, month = el.dataset.month, key = el.dataset.key;
      setObsCell(sem, sid, month, key, v);
      if (v !== null && (v < 0 || v > 10)) el.classList.add('invalid');
      updateObsRow(sem, sid);
      updateObsFooters(sem);
    } else if (kind === 'week') {
      const sid = el.dataset.sid, met = el.dataset.met, w = el.dataset.w, f = el.dataset.f;
      const metric = met === 'spelling' ? 'sp' : 'da';
      const month = ui.entryMonth[metric];
      setWeekCell(sem, sid, met, month, w, f, v);
      if (f === 's' && v !== null && DB.settings.autoTotal) {
        const rec = getWeek(sem, sid, met, month, w);
        if (!rec || rec.t === null) {
          const def = met === 'spelling' ? Number(DB.settings.spTotal) : Number(DB.settings.daTotal);
          setWeekCell(sem, sid, met, month, w, 't', def);
          const ti = weekInputs(sid, met, w).find((x) => x.dataset.f === 't');
          if (ti) ti.value = def;
        }
      }
      const rec = getWeek(sem, sid, met, month, w);
      const bad = rec && rec.s !== null && rec.t !== null && rec.s > rec.t;
      weekInputs(sid, met, w).forEach((x) => x.classList.toggle('invalid', !!bad));
      updateWeekRow(sem, sid, met);
      updateWeekFooters(sem, met);
    } else if (kind === 'test') {
      const sid = el.dataset.sid, tp = el.dataset.tp, f = el.dataset.f;
      setTestCell(sem, sid, tp, f, v);
      const rec = sem.tests[sid] && sem.tests[sid][tp];
      const bad = rec && rec.s !== null && rec.t !== null && rec.s > rec.t;
      $$('input[data-kind="test"]').filter((x) => x.dataset.sid === sid && x.dataset.tp === tp).forEach((x) => x.classList.toggle('invalid', !!bad));
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
      if (s2.students.some((x) => x.id === sid)) return C.gradeStudent(s2, sid).final;
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
      const av = a.g.final === null ? -1 : a.g.final, bv = b.g.final === null ? -1 : b.g.final;
      return d * (av - bv);
    });
    return rows.map((r) => {
      const g = r.g, s = r.s;
      const L = (p) => '<td class="c">' + gBadge(p === null ? null : C.letter(p)) + '</td>';
      const pf = prevFinal(sem, s.id);
      let trend = '<span class="muted">–</span>';
      if (pf !== null && g.final !== null) {
        const dd = g.final - pf;
        if (dd > 0.5) trend = '<span style="color:#1d7a4a">↑ ' + fmt(dd, 1) + '</span>';
        else if (dd < -0.5) trend = '<span style="color:#c4453c">↓ ' + fmt(-dd, 1) + '</span>';
        else trend = '<span class="muted">·</span>';
      }
      return '<tr><td><a class="stu-link" href="#/student/' + U.esc(s.id) + '">' + U.esc(s.nameEn || s.nameCn) +
        '</a> <span class="muted small">' + U.esc(s.nameCn || '') + '</span></td>' +
        L(g.parts.Listening) + L(g.parts.Speaking) + L(g.parts.Writing) + L(g.parts.Reading) +
        L(g.parts.Spelling) + L(g.parts['Daily Assignments']) + L(g.parts['Mid-Term']) + L(g.parts.Oral) + L(g.parts.Written) +
        '<td class="num"><b>' + fmt(g.final, 1) + '</b></td><td class="c">' + gBadge(g.letter) + '</td>' +
        '<td class="num small">' + trend + '</td></tr>';
    }).join('');
  }
  function renderGrading() {
    const sem = cur();
    const arrow = (k) => ui.gsort.k === k ? (ui.gsort.d < 0 ? ' ↓' : ' ↑') : '';
    $('#content').innerHTML = pageHead('Grading', 'computed live from every score — the same formula as the SPR Excel',
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
      '<div class="legend"><span class="small muted">Final = Listening 10% + Speaking 10% + Writing 10% + Reading 10% + Spelling 10% + Daily 10% + Mid-Term 10% + Oral 10% + Written 20%. Grades: A* &gt; 84, A &gt; 74, B &gt; 64, C &gt; 54, D &gt; 49, otherwise U.</span></div>';
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
      if (g === '男') g = 'M'; else if (g === '女') g = 'F';
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
  function renderManage() {
    const sem = cur();
    const st = DB.settings;
    $('#content').innerHTML = pageHead('Manage & setup', 'classes, students and data') +
      '<div class="flex mb">' +
        '<button class="btn primary" data-action="wiz-open">New class / semester</button>' +
        '<button class="btn" data-action="import-xlsx">Import SPR Excel</button>' +
        '<button class="btn" data-action="export-xlsx">Export current semester to Excel</button>' +
        '<button class="btn" data-action="backup">Download backup (JSON)</button>' +
        '<button class="btn" data-action="restore">Restore backup</button>' +
      '</div>' +
      '<h3 style="font-family:var(--font-display);margin:6px 0 12px">Semesters</h3>' +
      DB.semesters.map(semCard).join('') +
      '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Students — ' + U.esc(sem.name) + '</h3>' +
      '<div class="sheet"><table class="tbl"><thead><tr><th>#</th><th>ID</th><th>Chinese name</th><th>English name</th><th>Gender</th><th></th></tr></thead><tbody>' +
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
        '<div class="mt"><button class="btn" data-action="roster-paste">Add list</button></div></details>' +
      '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Settings</h3>' +
      '<div class="panel"><div class="flex">' +
        '<label><input type="checkbox" data-setf="autoTotal"' + (st.autoTotal ? ' checked' : '') + '> auto-fill totals when entering a score</label>' +
        '<label>spelling total <input class="inp" type="number" data-setf="spTotal" value="' + st.spTotal + '" style="width:64px"></label>' +
        '<label>daily total <input class="inp" type="number" data-setf="daTotal" value="' + st.daTotal + '" style="width:64px"></label>' +
      '</div></div>' +
      '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Security — password</h3>' +
      (cryptoOK() && SESSION.dk ?
        '<div class="panel"><p class="small" style="margin-bottom:10px">Your password derives the key that encrypts the class data in this browser. Changing it re-keys your unlock key — use the new password on every device (each device signs in again with it).</p>' +
        '<div class="flex">' +
          '<input type="password" class="inp" id="cpCur" placeholder="Current password" autocomplete="current-password" style="width:180px">' +
          '<input type="password" class="inp" id="cpNew" placeholder="New password (8+ chars)" autocomplete="new-password" style="width:180px">' +
          '<input type="password" class="inp" id="cpConf" placeholder="Repeat new password" autocomplete="new-password" style="width:180px">' +
          '<button class="btn primary" data-action="change-pass-save">Change password</button>' +
        '</div><div class="login-err" id="cpErr"></div></div>'
        : '') +
      '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Share &amp; sync — two teachers, one dataset</h3>' +
      (function () {
        var c = getShare();
        var canCrypto = !!subtle();
        var status = [];
        if (c.bin) status.push('bin <code>' + U.esc(c.bin) + '</code>');
        if (c.lastPush) status.push('pushed by ' + U.esc(c.lastPushBy || '?') + ' · ' + new Date(c.lastPush).toLocaleString());
        if (c.lastPull) status.push('pulled ' + new Date(c.lastPull).toLocaleString());
        var link = shareLink();
        return '<div class="panel">' +
          '<p class="small" style="margin-bottom:10px">Create one free bin at <b>npoint.io</b> (New JSON bin — content can stay <code>{}</code>), then paste its ID here. Data is <b>encrypted (AES-GCM)</b> before upload; the key travels only inside the share link, so the cloud never sees your data. Push after editing; your co-teacher presses Pull (or re-opens their link). Last save wins.</p>' +
          '<div class="flex">' +
            '<input class="inp" id="shareBin" placeholder="npoint bin ID (e.g. a1b2c3d4)" style="width:230px" value="' + U.esc(c.bin || '') + '">' +
            '<button class="btn" data-action="share-save">Save bin ID</button>' +
            '<button class="btn primary" data-action="share-push"' + (canCrypto ? '' : ' disabled title="Needs the online (https) version"') + '>Push to cloud</button>' +
            '<button class="btn" data-action="share-pull"' + (canCrypto ? '' : ' disabled title="Needs the online (https) version"') + '>Pull from cloud</button>' +
          '</div>' +
          (link ? '<div class="flex mt" style="align-items:center"><input class="inp" id="shareLink" readonly style="flex:1;min-width:260px;font-size:12px" value="' + U.esc(link) + '"><button class="btn" data-action="share-copy">Copy share link</button></div>' +
            '<p class="small" style="margin-top:6px">Anyone with this link can read and edit the class data — send it only to your co-teacher.</p>' : '') +
          (status.length ? '<p class="small" style="margin-top:8px">' + status.join(' · ') + '</p>' : '') +
          (!canCrypto ? '<p class="small" style="margin-top:8px;color:#b45309">Share &amp; sync needs the online version (https). Open the website in a browser to use it.</p>' : '') +
          '</div>';
      })() +
      '<h3 style="font-family:var(--font-display);margin:22px 0 12px">Data</h3>' +
      '<div class="flex">' +
        '<button class="btn" data-action="load-sample">Reset to sample data</button>' +
        (window.__SPR_CORRUPT ? '<button class="btn" data-action="dl-corrupt">Download damaged data file</button>' : '') +
        '<button class="btn danger" data-action="wipe">Erase everything</button>' +
      '</div>' +
      '<input type="file" id="file-xlsx" accept=".xlsx,.xls" hidden>' +
      '<input type="file" id="file-json" accept=".json" hidden>';
  }
  function rosterAdd() {
    const sem = cur();
    const id = $('#ro-id').value.trim() || ('STU-' + String(sem.students.length + 1).padStart(3, '0'));
    const cn = $('#ro-cn').value.trim(), en = $('#ro-en').value.trim();
    if (!cn && !en) { toast('Enter at least one name', true); return; }
    if (sem.students.some((s) => s.id === id)) { toast('ID already used: ' + id, true); return; }
    sem.students.push({ id: id, nameCn: cn, nameEn: en, gender: $('#ro-g').value });
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
    return '<div class="panel mb"><h3>Findings — RAG &amp; SWOT (auto-generated)</h3>' +
      '<div class="panel-sub">' + U.esc(sw.last.semName) + ' · overall ' + ragChip(sw.overallRag) +
      ' · trend vs ' + U.esc(sw.prev ? sw.prev.semName : '—') + ' ' + dSpan(sw.delta) + '</div>' +
      '<div class="swot-grid" style="margin-top:10px">' +
        '<div class="swot-cell s"><h4>Strengths</h4><ul>' + sw.strengths.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
        '<div class="swot-cell w"><h4>Weaknesses</h4><ul>' + sw.weaknesses.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
        '<div class="swot-cell o"><h4>Opportunities</h4><ul>' + (sw.opportunities.length ? sw.opportunities.map((x) => '<li>' + U.esc(x) + '</li>').join('') : '<li>Close to the next band in several parts — keep pushing.</li>') + '</ul></div>' +
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
      (n > 1 ? ' — comparing ' + U.esc(DB.semesters[0].name) + ' → ' + U.esc(DB.semesters[n - 1].name) : ' — import a second SPR to compare progress'),
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
      '<div class="panel mt"><h3>Movers — ' + (mv ? U.esc(mv.from) + ' → ' + U.esc(mv.to) : '') + '</h3>' +
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
        (DB.semesters.length > 1 && c.cnt > 1 ? ' — ' + c.cnt + ' semesters' : '') + '</option>').join('') + '</select></label></div></div>';
    return stuSel +
      '<div class="profile-head"><div class="stu-id-block"><div class="avatar">' + U.esc((stu.nameCn || stu.nameEn || '?').charAt(0)) + '</div>' +
      '<div><div class="stu-name">' + U.esc(stu.nameEn || stu.nameCn) + '</div>' +
      '<div class="stu-meta">' + U.esc(stu.nameCn || '') + ' · ID ' + U.esc(sid) + ' · ' + rows.length + ' ' + (rows.length === 1 ? 'semester' : 'semesters') + ' of data</div></div></div>' +
      '<div class="flex" style="align-items:center;gap:22px">' +
        '<div class="right"><div class="final-num">' + A.f1(last.final) + '</div><div class="small muted">' + U.esc(last.semName) + ' final</div></div>' +
        (rows.length > 1 ? '<div class="right"><div class="final-num" style="font-size:26px">' + dSpan(sw.delta) + '</div><div class="small muted">vs ' + U.esc(sw.prev.semName) + '</div></div>' : '') +
        (last.rank ? '<div class="right"><div class="final-num" style="font-size:26px">' + last.rank + '<span class="small muted">/' + last.total + '</span></div><div class="small muted">rank</div></div>' : '') +
        '<div class="stamp" style="color:' + (RAG_HEX[sw.overallRag] || '#9aa0a0') + '"><small>' + (sw.ragName || 'RAG').toUpperCase() + '</small>' + (sw.ragName || '–') + '</div>' +
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
    $('#content').innerHTML = pageHead('Report Cards', 'download, print or share — every card carries your credit',
      '<button class="btn" data-action="print">Print</button>') + tabs + body;
  }

  function rptClassView(sem) {
    const dist = C.gradeDistribution(sem);
    const comp = C.completeness(sem);
    const risk = C.atRisk(sem);
    const gAll = C.gradeAll(sem);
    const top = gAll.filter((g) => g.final !== null).sort((a, b) => b.final - a.final).slice(0, 5);
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
        top.map((g, i) => { const s = sem.students.find((x) => x.id === g.sid);
          return '<tr><td>' + (i + 1) + '</td>' +
            '<td><a class="stu-link" href="#/report/' + U.esc(g.sid) + '">' + U.esc(s ? (s.nameEn || s.nameCn) : g.sid) + '</a></td>' +
            '<td class="num">' + fmt(g.final, 1) + '</td><td class="c">' + gBadge(g.letter) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' +
      '<div class="panel mt"><h3>All students</h3>' +
        '<table class="tbl"><thead><tr><th>Student</th><th class="c">Final</th><th class="c">Grade</th><th class="c">Report Card</th></tr></thead><tbody>' +
        sem.students.map((s) => { const g = C.gradeStudent(sem, s.id);
          return '<tr><td>' + U.esc(s.nameEn || s.nameCn) + ' <span class="muted small">' + U.esc(s.nameCn || '') + '</span></td>' +
            '<td class="num">' + fmt(g.final, 1) + '</td><td class="c">' + gBadge(g.letter) + '</td>' +
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

  function renderReportCard(sid) {
    const sem = cur();
    const stu = sem.students.find((s) => s.id === sid);
    if (!stu) { location.hash = '#/reports/student'; return; }
    const g = C.gradeStudent(sem, sid);
    const sw = A.swot(DB, sid);
    const clsAvg = C.classFinalAvg(sem);
    const ragCode = g.final >= 75 ? 'G' : g.final >= 55 ? 'A' : 'R';
    const ragName = ragCode === 'G' ? 'Green' : ragCode === 'A' ? 'Amber' : 'Red';
    const rank = (function () {
      const sorted = C.gradeAll(sem).filter((x) => x.final !== null).sort((a, b) => b.final - a.final);
      const i = sorted.findIndex((x) => x.sid === sid);
      return i >= 0 ? (i + 1) + ' / ' + sorted.length : '—';
    })();

    const componentRows = [
      ['Listening', g.skills.Listening], ['Speaking', g.skills.Speaking],
      ['Writing', g.skills.Writing], ['Reading', g.skills.Reading],
      ['Spelling', g.spelling], ['Daily Assignments', g.daily],
      ['Mid-Term', g.midterm], ['Oral', g.oral], ['Written', g.written],
    ].map(([name, val]) => {
      const w = name === 'Written' ? 20 : 10;
      return '<tr><td>' + name + '</td><td class="num">' + fmt(val, 1) + '%</td>' +
        '<td class="c">' + gBadge(val === null ? null : C.letter(val)) + '</td>' +
        '<td class="num">' + w + '%</td>' +
        '<td class="num">' + (val === null ? '—' : fmt(val * w / 100, 2)) + '</td></tr>';
    }).join('');

    $('#content').innerHTML = pageHead('Report Card', U.esc(stu.nameEn || stu.nameCn || '') + ' · ' + U.esc(sem.name),
      '<button class="btn primary" data-action="print">Print / Save PDF</button>' +
      '<button class="btn" data-action="dl-card" data-sid="' + U.esc(sid) + '">Download (Excel)</button>' +
      '<a class="btn" href="#/student/' + U.esc(sid) + '">Full profile</a>') +

      '<div class="report-card">' +
        '<div class="rc-header">' +
          '<div class="rc-school">' + U.esc(sem.school) + '</div>' +
          '<div class="rc-title">STUDENT PERFORMANCE REPORT CARD</div>' +
          '<div class="rc-meta">' + U.esc(sem.className) + ' · ' + U.esc(sem.name) + '</div>' +
        '</div>' +
        '<div class="rc-stu">' +
          '<table class="tbl"><tbody>' +
            '<tr><th>Student Name</th><td>' + U.esc(stu.nameEn || '') + ' ' + U.esc(stu.nameCn || '') + '</td>' +
                '<th>Student ID</th><td>' + U.esc(stu.id) + '</td></tr>' +
            '<tr><th>Gender</th><td>' + U.esc(stu.gender || '') + '</td>' +
                '<th>Class Rank</th><td>' + rank + '</td></tr>' +
          '</tbody></table>' +
        '</div>' +
        '<div class="rc-scores">' +
          '<table class="tbl"><thead><tr><th>Component</th><th class="num">Score</th><th class="c">Grade</th><th class="num">Weight</th><th class="num">Contribution</th></tr></thead>' +
          '<tbody>' + componentRows +
          '<tr style="border-top:2px solid var(--rule-strong)"><td><b>FINAL SCORE</b></td>' +
            '<td class="num"><b>' + fmt(g.final, 1) + '%</b></td>' +
            '<td class="c">' + gBadge(g.letter) + '</td><td class="num">100%</td><td></td></tr>' +
          '</tbody></table>' +
        '</div>' +
        '<div class="rc-rag">' +
          '<table class="tbl"><tr>' +
            '<th>RAG Status</th><td>' + ragChip(ragCode, ragName) + '</td>' +
            '<th>Class Average</th><td>' + fmt(clsAvg, 1) + '%</td>' +
            '<th>vs Class</th><td>' + (g.final >= clsAvg ? '<span class="delta-up">+' : '<span class="delta-down">') + fmt(Math.abs(g.final - clsAvg), 1) + '</span></td>' +
          '</tr></table>' +
        '</div>' +
        (sw ? '<div class="rc-swot">' +
          '<h3>SWOT Analysis</h3>' +
          '<div class="swot-grid">' +
            '<div class="swot-cell s"><h4>Strengths</h4><ul>' + sw.strengths.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
            '<div class="swot-cell w"><h4>Weaknesses</h4><ul>' + sw.weaknesses.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
            '<div class="swot-cell o"><h4>Opportunities</h4><ul>' + (sw.opportunities.length ? sw.opportunities.map((x) => '<li>' + U.esc(x) + '</li>').join('') : '<li>Maintain current approach</li>') + '</ul></div>' +
            '<div class="swot-cell t"><h4>Threats</h4><ul>' + sw.threats.map((x) => '<li>' + U.esc(x) + '</li>').join('') + '</ul></div>' +
          '</div>' +
        '</div>' : '') +
        (sw ? '<div class="rc-remark"><h3>Teacher Remark</h3><div class="remark-box">' + U.esc(sw.remark) + '</div></div>' : '') +
        '<div class="rc-sign">' +
          '<div>Teacher Signature: ____________________</div>' +
          '<div>Date: ____________</div>' +
          '<div>Parent Signature: ____________________</div>' +
        '</div>' +
        '<div class="rc-credit">Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)</div>' +
      '</div>';
  }

  /* ============================ report download helpers ============================ */
  function dlClassReport() {
    const sem = cur(); if (!sem) return;
    const ws = EB.exportClassReport(sem);
    const wb = EB.stampProps(XLSX.utils.book_new(), {
      Title: [sem.className, 'class-report', sem.name].filter(Boolean).join(' - '),
      Company: sem.school || 'SPR — by Teacher Mo'
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
      Title: ['report-card', (stu.nameEn || stu.nameCn), sem.name].filter(Boolean).join(' - '),
      Company: sem.school || 'SPR — by Teacher Mo'
    });
    XLSX.utils.book_append_sheet(wb, ws, 'Report Card');
    XLSX.writeFile(wb, sanitizeFn('report-card-' + (stu.nameEn || stu.nameCn) + '-' + sem.name + '-by-Teacher-Mo') + '.xlsx');
    toast('Report card downloaded for ' + (stu.nameEn || stu.nameCn));
  }

  function privacyHtml() {
    return '<h3>Privacy &amp; data protection notice</h3>' +
      '<div class="privacy-body"><p>This app handles <b>real student data</b> — names, IDs and grades. Please read carefully:</p>' +
      '<h4>Where the data lives</h4><ul>' +
      '<li>Data lives in this browser — online, stored <b>encrypted</b> (your password unlocks it); the offline file version stores it unencrypted.</li>' +
      '<li><b>Nothing leaves this device unless you use Share &amp; sync</b>, which uploads an <b>encrypted</b> copy to npoint.io (a free third-party bin service). The key stays in your share link, never on the server. Anyone with that full link can open the data — send it only to your co-teacher.</li>' +
      '<li>Exported files (Excel / JSON backups) are <b>not encrypted</b>. Store them only on school-approved storage, and delete them when no longer needed.</li>' +
      '<li>This website is a static page — no server, no database, no tracking, no internet needed after loading.</li></ul>' +
      '<h4>Your responsibilities</h4><ul>' +
      '<li>This browser profile contains confidential student information — protect the device (screen lock, no shared accounts).</li>' +
      '<li>Backup files (JSON / Excel exports) contain full student data. Store them only on encrypted or school-approved storage, and delete them when no longer needed.</li>' +
      '<li>Avoid entering student data on shared or public computers. If unavoidable, use “Erase everything” in Manage &amp; setup before leaving.</li>' +
      '<li>Sharing student performance outside school (parents, other staff) should follow your school’s policy and applicable law (e.g. PIPL in China, GDPR elsewhere).</li></ul>' +
      '<h4>Removing data</h4><ul>' +
      '<li>“Erase everything” deletes all data from this browser, including the encryption keys. It does <b>not</b> delete a copy already pushed to the cloud — overwrite it by pushing fresh data, or delete the bin at npoint.io.</li></ul>' +
      '<p class="small muted">Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)</p></div>' +
      '<div class="dlg-actions"><button class="btn primary" data-action="privacy-ack">' +
      (DB.settings.privacyAck ? 'Close' : 'I understand') + '</button></div>';
  }
  function openPrivacy() { openDlg(privacyHtml()); }
  function privacyAck() {
    if (!DB.settings.privacyAck) { DB.settings.privacyAck = true; saveDB(true); }
    closeDlg();
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
      if (src) students = src.students.map((s) => ({ id: s.id, nameCn: s.nameCn, nameEn: s.nameEn, gender: s.gender }));
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
    openDlg('<h3>Months — ' + U.esc(sem.name) + '</h3>' +
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
  function importXlsxFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
        const sem = normalizeSemester(EB.importWorkbook(wb, { id: U.uid('sem'), name: EB.suggestNameFromFilename(file.name) }));
        sem.students.forEach((st) => { st.id = String(st.id == null ? '' : st.id).replace(/[^A-Za-z0-9_\-]/g, '-').slice(0, 40) || U.uid('stu'); });
        const dup = sem.students.filter((st, i) => sem.students.findIndex((x) => x.id === st.id) !== i);
        if (dup.length) throw new Error('duplicate student IDs after sanitising: ' + dup[0].id);
        validateDB({ semesters: [sem], settings: {} });
        const tm = String(file.name).match(/\(([^)]+)\)/);
        if (tm && !sem.teachers.length) sem.teachers = tm[1].split(/\s*[&,、]\s*/).map((t) => t.trim()).filter((t) => t && t.length <= 40);
        DB.semesters.push(sem);
        DB.currentSemesterId = sem.id;
        saveDB(); buildShell();
        toast('Imported ' + sem.students.length + ' students · ' + sem.months.join(', '));
        if (location.hash === '#/dashboard') route();
        else location.hash = '#/dashboard';
      } catch (err) { toast('Import failed: ' + err.message, true); }
    };
    reader.readAsArrayBuffer(file);
  }
  function exportXlsx() {
    const sem = cur();
    if (!sem) return;
    const wb = EB.exportWorkbook(sem);
    XLSX.writeFile(wb, sanitizeFn(sem.school + '-' + (sem.className || 'class') + '-SPR-' + sem.name + '-by-Teacher-Mo') + '.xlsx');
    toast('Excel exported — check your downloads');
  }
  function backupJSON() {
    const out = Object.assign({}, DB, {
      credit: 'Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)',
      author: 'Mohammed Shehzad Khan (Teacher Mo)',
    });
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'SPR-backup-by-Teacher-Mo-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('Backup downloaded');
  }
  function restoreJSONFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || !Array.isArray(d.semesters)) throw new Error('not a markbook backup file');
        validateDB(d);
        downloadBackup();
        d.semesters.forEach(normalizeSemester);
        d.settings = Object.assign({ autoTotal: true, spTotal: 20, daTotal: 10 }, d.settings || {});
        d.credit = d.credit || 'Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)';
        d.author = d.author || 'Mohammed Shehzad Khan (Teacher Mo)';
        DB = d;
        if (!DB.semesters.find((s) => s.id === DB.currentSemesterId)) DB.currentSemesterId = DB.semesters[0] ? DB.semesters[0].id : null;
        saveDB(true); buildShell(); location.hash = '#/dashboard'; route(); toast('Backup restored');
      } catch (err) { toast('Restore failed: ' + err.message, true); }
    };
    reader.readAsText(file);
  }

  /* ============================ global listeners ============================ */
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const sem = cur();
    if (a === 'reset-auth') {
      localStorage.removeItem(AUTH_KEY);
      getAuth(); // re-initialize with default admin
      location.reload();
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
          if (res.error) { $('#loginErr').textContent = res.error; return; }
          closeDlg(); document.body.classList.remove('auth-gate'); buildShell(); route(); toast('Welcome back, ' + res.user.name); maybeJoin();
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
        const err = $('#cpErr');
        const cur = ($('#cpCur') || {}).value || '';
        const nw = ($('#cpNew') || {}).value || '';
        const cf = ($('#cpConf') || {}).value || '';
        if (!cryptoOK() || !SESSION.dk) { if (err) err.textContent = 'Password change needs the online (https) version.'; return; }
        const auth = getAuth();
        const me = auth.users.find((u) => u.username === SESSION.user);
        if (!me || me.hash !== hashPassword(cur)) { if (err) err.textContent = 'Current password is wrong.'; return; }
        if (!nw || nw.length < 8) { if (err) err.textContent = 'New password must be at least 8 characters.'; return; }
        if (nw !== cf) { if (err) err.textContent = 'New passwords do not match.'; return; }
        const v2 = readV2();
        if (!v2 || !v2.wraps) { if (err) err.textContent = 'No encrypted storage found — sign out and in once first.'; return; }
        try {
          v2.wraps[me.username] = await makeWrap(SESSION.dk, nw);   // re-key under the new password
        } catch (e) { if (err) err.textContent = 'Re-keying failed: ' + e.message; return; }
        me.hash = hashPassword(nw);
        saveAuth(auth);
        localStorage.setItem(V2_KEY, JSON.stringify(v2));
        try { sessionStorage.setItem('spr-session', JSON.stringify({ user: me.username, dk: b64uFromBytes(SESSION.dk) })); } catch (e) {}
        closeDlg(); toast('Password updated — use it next time you sign in.');
        if (location.hash === '#/manage') renderManage();
      })();
      return;
    }
    if (a === 'share-save') {
      const v = ($('#shareBin') ? $('#shareBin').value : '').trim();
      if (!v) { toast('Enter the npoint bin ID first', true); return; }
      const c = getShare(); c.bin = v; setShare(c);
      toast('Bin saved — you can Push to cloud now');
      renderManage(); return;
    }
    if (a === 'share-push') { sharePush(); return; }
    if (a === 'share-pull') { sharePull(); return; }
    if (a === 'share-copy') {
      const inp = $('#shareLink');
      if (!inp) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inp.value).then(() => toast('Share link copied'), () => { inp.select(); document.execCommand('copy'); toast('Share link copied'); });
      } else { inp.select(); document.execCommand('copy'); toast('Share link copied'); }
      return;
    }
    if (a === 'privacy-open') { openPrivacy(); return; }
    if (a === 'privacy-ack') { privacyAck(); return; }
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
          'All scores for this semester will be removed. Export Excel or download a backup first if you need a copy.', 'Delete semester');
        if (!okGo) return;
        DB.semesters = DB.semesters.filter((x) => x.id !== s.id);
        if (DB.currentSemesterId === s.id) DB.currentSemesterId = DB.semesters[0] ? DB.semesters[0].id : null;
        saveDB(); buildShell(); route(); toast('Semester deleted');
      })();
      return;
    }
    if (a === 'stu-del') {
      (async () => {
        const sid = el.dataset.sid;
        const stu = sem && sem.students.find((s) => s.id === sid);
        if (!stu) return;
        const okGo = await confirmDlg('Remove ' + U.esc(stu.nameEn || stu.nameCn || sid) + '?',
          'Their scores in ' + U.esc(sem.name) + ' will be deleted.', 'Remove student');
        if (!okGo) return;
        sem.students = sem.students.filter((s) => s.id !== sid);
        delete sem.observations[sid]; delete sem.spelling[sid]; delete sem.daily[sid]; delete sem.tests[sid];
        saveDB(); route(); toast('Student removed');
      })();
      return;
    }
    if (a === 'roster-add') { rosterAdd(); return; }
    if (a === 'roster-paste') { rosterBulk(); return; }
    if (a === 'import-xlsx') { const f = $('#file-xlsx'); if (f) f.click(); return; }
    if (a === 'export-xlsx') { exportXlsx(); return; }
    if (a === 'backup') { backupJSON(); return; }
    if (a === 'restore') { const f = $('#file-json'); if (f) f.click(); return; }
    if (a === 'load-sample') {
      (async () => {
        if (DB.semesters.length) {
          const okGo = await confirmDlg('Reset to sample data?', 'Your current classes and scores will be replaced by the sample semester.', 'Reset');
          if (!okGo) return;
        }
        DB = seedFromWindow();
        if (cryptoOK() && SESSION.dk) { await persistNow(true); }
        else { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch (e) {} }
        location.reload();
      })();
      return;
    }
    if (a === 'wipe') {
      (async () => {
        const okGo = await confirmDlg('Erase everything?', 'All classes, students and scores will be deleted <b>from this browser</b>, including the encryption keys. A copy already pushed to the cloud is <b>not</b> deleted — overwrite it by pushing fresh data, or delete the bin at npoint.io.', 'Erase all data');
        if (!okGo) return;
        DB = emptyDB();
        [LS_KEY, V2_KEY, 'spr-share-v1', 'spr-auth-v1', 'spr-session', 'spr-session-db'].forEach((k) => {
          try { localStorage.removeItem(k); } catch (e) {} try { sessionStorage.removeItem(k); } catch (e) {}
        });
        Object.keys(localStorage).filter((k) => k.indexOf(CORRUPT_PREFIX) === 0).forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
        SESSION = { user: null, dk: null };
        location.reload();
      })();
      return;
    }
    if (a === 'dl-corrupt') {
      const raw = (window.__SPR_CORRUPT && window.__SPR_CORRUPT.raw) || '';
      const blob = new Blob([raw], { type: 'application/json' });
      const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = 'SPR-damaged-data.json';
      document.body.appendChild(a2); a2.click(); a2.remove(); return;
    }
    if (a === 'print') { window.print(); return; }
  });

  document.addEventListener('input', function (e) {
    const t = e.target;
    if (t.classList && t.classList.contains('cell')) { onGridInput(t); return; }
    if (t.id === 'stuSearch') { ui.q = t.value; const el = $('#stuList'); if (el && cur()) el.innerHTML = stuCards(cur()); return; }
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
    if (t.id === 'semSelect') { DB.currentSemesterId = t.value; saveDB(true); buildShell(); route(); return; }
    if (t.id === 'file-xlsx') { if (t.files && t.files[0]) importXlsxFile(t.files[0]); t.value = ''; return; }
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
    if (DB) { try { localStorage.setItem(LS_KEY, JSON.stringify(DB)); } catch(e) {} }
  });
  document.addEventListener('paste', onGridPaste);

  /* =================================== init =================================== */

  /* ============================ CREDENTIALS ============================ */
  /* ============================ share & sync (npoint.io) ============================
     Two teachers, one dataset. The class data is AES-GCM encrypted with a random
     key; only the ciphertext goes to the cloud bin. The key travels exclusively
     inside the share link (#join=<bin>&k=<key>), so the server never sees it.
     Manual Push/Pull (last-save-wins). */
  const SHARE_KEY = 'spr-share-v1';
  const NP_API = 'https://api.npoint.io/';
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
      if (!keyB64) throw new Error('this cloud copy is encrypted — open the share link that contains its key');
      return cloudDecrypt(env, keyB64);
    } else if (env && env.spr === 1) {
      if (getShare().key) throw new Error('refusing an UNENCRYPTED cloud copy while a key is configured (possible tampering)');
      obj = env;
    } else throw new Error('not an SPR cloud copy');
    return Promise.resolve(obj);
  }
  function shareLink() {
    const c = getShare();
    if (!c.bin || !c.key) return null;
    return location.origin + location.pathname + '#join=' + encodeURIComponent(c.bin) + '&k=' + encodeURIComponent(c.key);
  }
  async function sharePush() {
    if (!subtle()) { toast('Share & sync needs the online (https) version of the app', true); return; }
    const c = getShare();
    if (!c.bin) { toast('Save a npoint bin ID first (Manage → Share & sync)', true); return; }
    try {
      toast('Pushing…');
      const out = await cloudEnvelope(c);
      const res = await fetch(NP_API + encodeURIComponent(c.bin), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out.env) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      c.key = b64uFromBytes(out.keyBytes); c.lastPush = out.env.pushedAt; c.lastPushBy = out.env.pushedBy; setShare(c);
      toast('Pushed — copy the share link to your co-teacher');
      if (location.hash === '#/manage') renderManage();
    } catch (e) { toast('Push failed: ' + e.message, true); }
  }
  async function sharePull() {
    const c = getShare();
    if (!c.bin) { toast('Save a npoint bin ID first', true); return; }
    try {
      toast('Checking cloud…');
      const res = await fetch(NP_API + encodeURIComponent(c.bin));
      if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 404 ? ' (bin not found)' : ''));
      const env = await res.json();
      const obj = await applyCloudObj(env, c.key);
      if (!obj.db || !Array.isArray(obj.db.semesters)) throw new Error('cloud copy has no class data');
      validateDB(obj.db);
      const when = (obj.pushedAt || env.pushedAt) ? new Date(obj.pushedAt || env.pushedAt).toLocaleString() : 'unknown time';
      const okGo = await confirmDlg('Pull from cloud?',
        'This will <b>REPLACE all data in this browser</b> with the cloud copy pushed by <b>' + U.esc(env.pushedBy || 'someone') + '</b> at ' + when + '. A backup of your current data downloads first.', 'Pull & replace');
      if (!okGo) return;
      downloadBackup();
      c.lastPull = new Date().toISOString(); setShare(c);
      persistReplaced(obj.db);
    } catch (e) { toast('Pull failed: ' + e.message, true); }
  }
  async function shareJoin(binId, keyB64) {
    try {
      toast('Joining shared workbook…');
      const res = await fetch(NP_API + encodeURIComponent(binId));
      if (!res.ok) throw new Error('HTTP ' + res.status + (res.status === 404 ? ' (bin not found)' : ''));
      const env = await res.json();
      const obj = await applyCloudObj(env, keyB64);
      if (!obj.db || !Array.isArray(obj.db.semesters)) throw new Error('cloud copy has no class data');
      validateDB(obj.db);
      const okGo = await confirmDlg('Join shared workbook?',
        'This will <b>REPLACE all data in this browser</b> with the cloud copy' + (env.pushedBy ? ' pushed by <b>' + U.esc(env.pushedBy) + '</b>' : '') + '. A backup of your current data downloads first. Future Push/Pull uses this bin.', 'Join');
      if (!okGo) { history.replaceState(null, '', location.pathname + location.search); return; }
      downloadBackup();
      setShare({ bin: binId, key: keyB64 || null, lastPull: new Date().toISOString() });
      history.replaceState(null, '', location.pathname + location.search);
      persistReplaced(obj.db);
    } catch (e) {
      toast('Join failed: ' + e.message, true);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
  function maybeJoin() {
    const m = (location.hash || '').match(/^#join=([^&]+)(?:&k=([^&]+))?/);
    if (!m) return;
    shareJoin(decodeURIComponent(m[1]), m[2] ? decodeURIComponent(m[2]) : null);
  }

  const AUTH_KEY = 'spr-auth-v1';

  function hashPassword(pw) {
    let h = 0x811c9dc5;
    for (let i = 0; i < pw.length; i++) {
      h ^= pw.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function getAuth() {
    const ADMIN_HASH = hashPassword('spr2026');
    /* built-in teacher accounts — added if missing; existing entries are never overwritten */
    const BUILTIN = [
      { username: 'ZFYBLS', hash: hashPassword('spr2026'), name: 'ZFYBLS', role: 'teacher' },
      { username: 'XFLS', hash: hashPassword('spr2026'), name: 'XFLS', role: 'teacher' }
    ];
    let d = null;
    try { d = JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) {}
    if (!d || !Array.isArray(d.users)) d = { users: [], session: null };
    let changed = false;
    /* ensure admin 'mo' exists. No forced hash reset: passwords are now real —
       each user's password derives the key that unwraps the encrypted data
       (see the wraps in p4c4-markbook-v2), so changing it must stick. */
    const admin = d.users.find(function(u) { return u.username === 'mo'; });
    if (!admin) {
      d.users.unshift({ username: 'mo', hash: ADMIN_HASH, name: 'Mohammed Shehzad Khan (Teacher Mo)', role: 'admin' });
      changed = true;
    }
    /* ensure built-in teacher accounts exist */
    BUILTIN.forEach(function(b) {
      if (!d.users.some(function(u) { return u.username === b.username; })) {
        d.users.push({ username: b.username, hash: b.hash, name: b.name, role: b.role });
        changed = true;
      }
    });
    if (changed) localStorage.setItem(AUTH_KEY, JSON.stringify(d));
    return d;
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
  const SEEDED_PASSWORDS = { mo: 'spr2026', ZFYBLS: 'spr2026', XFLS: 'spr2026' };
  async function doLoginFull(username, password) {
    const auth = getAuth();
    const user = auth.users.find((u) => u.username === username && u.hash === hashPassword(password));
    if (!user) return { error: 'Invalid username or password.' };
    if (!cryptoOK()) {
      auth.session = { username: user.username, name: user.name, role: user.role };
      saveAuth(auth);
      return { user: auth.session };
    }
    let v2 = readV2();
    let dk;
    if (!v2) {
      /* first encrypted run: seal the current workbook and issue data keys to
         every account still on its seeded password */
      dk = crypto.getRandomValues(new Uint8Array(32));
      v2 = { fmt: 2, wraps: {}, ts: Date.now() };
      for (const u of auth.users) {
        const seeded = SEEDED_PASSWORDS[u.username];
        if (seeded && u.hash === hashPassword(seeded)) v2.wraps[u.username] = await makeWrap(dk, seeded);
      }
      v2.wraps[username] = await makeWrap(dk, password);   // the signer always gets a key
      DB = DB || emptyDB();
      v2.data = await sealDB(DB, dk);
      localStorage.setItem(V2_KEY, JSON.stringify(v2));
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
    } else {
      const w = v2.wraps && v2.wraps[username];
      if (!w) return { error: 'No data key is stored for this account. Sign in as admin mo once, then sign in again with this account.' };
      try { dk = await unwrapWrap(w, password); }
      catch (e) { return { error: 'Invalid username or password.' }; }
      try { DB = normalizeDB(await unsealDB(v2.data, dk)); }
      catch (e) { return { error: 'Could not open the encrypted workbook.' }; }
    }
    SESSION = { user: user.username, dk: dk };
    auth.session = { username: user.username, name: user.name, role: user.role };
    saveAuth(auth);
    try { sessionStorage.setItem('spr-session', JSON.stringify({ user: user.username, dk: b64uFromBytes(dk) })); } catch (e) {}
    await persistNow(true);
    return { user: auth.session };
  }
  function doLogout() {
    const auth = getAuth();
    auth.session = null;
    saveAuth(auth);
    try { sessionStorage.removeItem('spr-session'); sessionStorage.removeItem('spr-session-db'); } catch (e) {}
    SESSION = { user: null, dk: null };
    location.reload();
  }
  function addUser(username, password, name, role) {
    const auth = getAuth();
    if (auth.users.some((u) => u.username === username)) return 'username taken';
    auth.users.push({ username, hash: hashPassword(password), name, role: role || 'teacher' });
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

  function renderLogin() {
    openDlg(
      '<div class="login-card">' +
        '<div class="login-logo">SPR</div>' +
        '<h2>Students Performance Report</h2>' +
        '<p>' + (cryptoOK() ? 'Sign in — your password unlocks the encrypted class data in this browser. Closing the browser locks it again.' : 'Sign in to access student data. Offline mode: data is stored unencrypted in this browser.') + '</p>' +
        '<div class="login-field"><label>Username</label><input type="text" id="loginUser" autocomplete="username"></div>' +
        '<div class="login-field"><label>Password</label><input type="password" id="loginPass" autocomplete="current-password"></div>' +
        '<div class="login-err" id="loginErr"></div>' +
        '<button class="login-btn" data-action="do-login">Sign In</button>' +
        '<div class="login-foot"><a href="#" data-action="reset-auth" style="color:var(--pri);font-size:11px;">Reset admin access</a><br>Designed for teachers, by a teacher<br>— Mohammed Shehzad Khan (Teacher Mo)</div>' +
      '</div>'
    );
    setTimeout(function() { var u = document.getElementById('loginUser'); if (u) u.focus(); }, 50);
  }


  async function init() {
    chartTheme();
    DB = emptyDB();
    buildShell();
    document.title = "Student's Performance Report";
    window.addEventListener('hashchange', route);
    window.addEventListener('storage', function (e) {
      if (e.key === V2_KEY || e.key === LS_KEY) toast('Data changed in another tab — reload this tab to see it.', true);
    });
    route();
    let ready = false;
    if (cryptoOK()) {
      try {
        const sess = JSON.parse(sessionStorage.getItem('spr-session') || 'null');
        const v2 = readV2();
        if (sess && sess.user && sess.dk && v2) {
          SESSION = { user: sess.user, dk: bytesFromB64u(sess.dk) };
          DB = normalizeDB(await unsealDB(v2.data, SESSION.dk));
          const auth = getAuth();
          if (!auth.session || auth.session.username !== sess.user) {
            const u = (auth.users || []).find((x) => x.username === sess.user);
            auth.session = { username: sess.user, name: (u && u.name) || sess.user, role: (u && u.role) || 'teacher' };
            saveAuth(auth);
          }
          ready = true;
        }
      } catch (e) { try { sessionStorage.removeItem('spr-session'); } catch (e2) {} }
      if (!ready) {
        const legacy = loadDBLegacy();
        DB = legacy || seedFromWindow();   // shown behind the gate; sealed on first sign-in
      }
    } else {
      const legacy = loadDBLegacy();
      DB = legacy || seedFromWindow();
      ready = isLoggedIn();
    }
    if (!ready) { document.body.classList.add('auth-gate'); renderLogin(); }
    else {
      if (window.__SPR_CORRUPT) toast('A damaged data file was found and preserved — Manage → Data can download it.', true);
      if (!DB.settings.privacyAck) openPrivacy();
    }
    maybeJoin();
  }
  /* test/debug hooks (read-only; used by the jsdom smoke suite) */
  window.SPR_DEBUG_GET_DB = function () { return DB; };
  window.SPR_DEBUG_SET_DB = function (d) { DB = d; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
