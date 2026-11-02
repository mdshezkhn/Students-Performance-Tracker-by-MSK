/* =========================================================================
   SPR Live Board — a real-time class dashboard view (#/live)

   Design language: "Fitness Dashboard" (light wellness board, blue hero cards,
   lime accents) reverse-engineered from the motionsites.ai fitness-dashboard
   preview (2026-11-01, see workspace/fitness-dashboard/SPEC.md) and re-skinned
   for the markbook: hydration glasses -> per-student skill tracking, calories
   ticks -> final-score distribution, weight wave -> monthly class average,
   sleep card -> watchlist. Trial feature: additive view, no other app surface
   depends on it. All data read-only via the live in-memory DB.
   ========================================================================= */
(function () {
  'use strict';
  if (window.SPRLiveBoard) return;                 /* idempotent */

  var CSS = [
    '.fdb{--bg:#EAF1FA;--ink:#0B0B0C;--ink2:#6B7280;--blue1:#1E6BF2;--blue2:#3D87F7;',
    '  --lime:#C8DC3C;--lime-d:#9DB022;--chip:#F2F4F6;--r:28px;',
    '  font-family:Inter,\'Segoe UI\',system-ui,-apple-system,sans-serif;',
    '  background:var(--bg);border-radius:var(--r);padding:26px 30px 30px;margin:14px 0 8px;',
    '  color:var(--ink);-webkit-font-smoothing:antialiased}',
    '.fdb *,.fdb *::before,.fdb *::after{box-sizing:border-box}',
    '.fdb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}',
    '.fdb-hi{font-size:clamp(26px,3vw,40px);font-weight:800;letter-spacing:-.5px;margin:0}',
    '.fdb-sub{color:var(--ink2);font-size:15px;margin-top:4px}',
    '.fdb-head-r{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    '.fdb-live{display:inline-flex;align-items:center;gap:8px;background:#fff;border-radius:999px;',
    '  padding:8px 16px;font-size:13px;font-weight:600;color:var(--ink);box-shadow:0 1px 2px rgba(16,24,40,.06)}',
    '.fdb-dot{width:9px;height:9px;border-radius:50%;background:var(--lime-d);flex:none;',
    '  box-shadow:0 0 0 0 rgba(157,176,34,.5);animation:fdbpulse 2s infinite}',
    '@keyframes fdbpulse{0%{box-shadow:0 0 0 0 rgba(157,176,34,.45)}70%{box-shadow:0 0 0 9px rgba(157,176,34,0)}100%{box-shadow:0 0 0 0 rgba(157,176,34,0)}}',
    '.fdb-sempill{display:inline-flex;align-items:center;gap:8px;background:#fff;border-radius:999px;',
    '  padding:0 10px 0 16px;height:52px;box-shadow:0 1px 2px rgba(16,24,40,.06);font-size:14px}',
    '.fdb-sempill svg{flex:none;color:#9AA3AF}',
    '.fdb-sempill select{border:0;background:transparent;font:inherit;font-weight:600;color:var(--ink);',
    '  padding:0 6px;height:100%;outline:none;cursor:pointer;max-width:220px}',
    '.fdb-cta{display:inline-flex;align-items:center;gap:9px;background:#0B0B0C;color:#fff;border-radius:999px;',
    '  height:52px;padding:0 20px;font-size:15px;font-weight:600;text-decoration:none;',
    '  box-shadow:0 6px 16px rgba(11,11,12,.18);transition:transform .15s}',
    '.fdb-cta:hover{transform:translateY(-1px);color:#fff}',
    '.fdb-cta .fdb-limedot{width:10px;height:10px;border-radius:50%;background:var(--lime);flex:none}',
    '.fdb-cta.fdb-lg{height:56px;padding:0 8px 0 24px;font-size:16px}',
    '.fdb-cta .fdb-arw{width:40px;height:40px;border-radius:50%;background:#fff;color:#0B0B0C;',
    '  display:inline-flex;align-items:center;justify-content:center;margin-left:10px}',
    '.fdb-row1{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:22px}',
    '.fdb-row2{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:22px}',
    '.fdb-card{border-radius:var(--r);padding:26px 28px;min-width:0}',
    '.fdb-hero{background:linear-gradient(160deg,#2E7EF0 0%,var(--blue1) 55%);color:#fff;',
    '  display:flex;flex-direction:column;min-height:480px;position:relative;overflow:hidden}',
    '.fdb-hero h2{font-size:clamp(26px,2.4vw,42px);font-weight:700;line-height:1.08;margin:6px 0 0;max-width:9ch;letter-spacing:-.4px}',
    '.fdb-eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.75}',
    '.fdb-playwrap{position:absolute;right:26px;top:50%;transform:translateY(-56%);text-align:center;width:190px}',
    '.fdb-play{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.18);',
    '  backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.35);display:inline-flex;',
    '  align-items:center;justify-content:center;color:#fff;text-decoration:none;transition:transform .15s,background .15s}',
    '.fdb-play:hover{transform:scale(1.06);background:rgba(255,255,255,.3)}',
    '.fdb-playcap{font-size:15px;font-weight:600;margin-top:10px;color:#fff;text-decoration:none;white-space:nowrap}',
    '.fdb-hero-foot{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}',
    '.fdb-join{font-size:13px;opacity:.8}',
    '.fdb-avs{display:flex;align-items:center;margin:8px 0 2px}',
    '.fdb-av{width:36px;height:36px;border-radius:50%;background:#fff;color:var(--blue1);font-weight:800;font-size:13px;',
    '  display:flex;align-items:center;justify-content:center;border:2px solid var(--blue1);margin-right:-9px}',
    '.fdb-av.fdb-more{background:#0B0B0C;color:#fff;border-color:#0B0B0C;font-size:11px}',
    '.fdb-n{font-size:20px;font-weight:800;line-height:1.1}',
    '.fdb-nsmall{font-size:13px;opacity:.8}',
    '.fdb-hydro{background:linear-gradient(165deg,#4E97F2 0%,var(--blue2) 60%);color:#fff;display:flex;flex-direction:column;min-height:480px}',
    '.fdb-hydro h3{margin:0;font-size:20px;font-weight:700}',
    '.fdb-hydro .fdb-hcopy{font-size:13.5px;line-height:1.45;opacity:.88;margin:8px 0 10px;max-width:30ch}',
    '.fdb-welldone{display:inline-flex;align-items:center;gap:6px;background:var(--lime);color:#0B0B0C;',
    '  border-radius:999px;padding:6px 14px;font-size:13px;font-weight:700}',
    '.fdb-glasses{display:grid;grid-template-columns:repeat(6,34px);gap:10px;justify-content:end;margin:6px 0 4px}',
    '.fdb-glass{width:34px;height:34px;color:rgba(255,255,255,.45)}',
    '.fdb-glass.on{color:#1C4060}',
    '.fdb-glass svg{width:100%;height:100%}',
    '.fdb-glass.on svg path:first-child{fill:#fff;opacity:.28}',
    '.fdb-hydro-foot{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;gap:10px;flex-wrap:wrap}',
    '.fdb-seg{display:flex;gap:10px}',
    '.fdb-seg button{width:48px;height:48px;border-radius:50%;border:0;cursor:pointer;font:inherit;font-size:15px;',
    '  font-weight:700;background:rgba(255,255,255,.25);color:#fff;transition:background .15s}',
    '.fdb-seg button.on{background:#fff;color:#0B0B0C}',
    '.fdb-bignum{font-size:clamp(46px,4.4vw,72px);font-weight:800;line-height:.95;letter-spacing:-2px}',
    '.fdb-bigunit{font-size:19px;opacity:.75;margin-top:4px}',
    '.fdb-white{background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.05);display:flex;flex-direction:column;min-height:430px}',
    '.fdb-whead{display:flex;align-items:center;gap:12px;margin-bottom:4px}',
    '.fdb-chip{width:44px;height:44px;border-radius:14px;background:var(--chip);display:flex;align-items:center;',
    '  justify-content:center;color:var(--ink);flex:none}',
    '.fdb-whead h3{margin:0;font-size:21px;font-weight:700;flex:1;min-width:0}',
    '.fdb-whead .fdb-right{text-align:right;font-weight:800;font-size:17px;line-height:1.15}',
    '.fdb-whead .fdb-right small{display:block;font-weight:500;font-size:11.5px;color:var(--ink2)}',
    '.fdb-subrow{color:var(--ink2);font-size:12.5px;margin:2px 0 12px}',
    '.fdb-cal-big{font-size:clamp(44px,4vw,62px);font-weight:800;letter-spacing:-2px;line-height:1;margin:4px 0 2px}',
    '.fdb-cal-big small{font-size:18px;font-weight:600;color:var(--ink2);letter-spacing:0}',
    '.fdb-ticks{display:flex;align-items:flex-end;gap:6px;height:76px;margin:18px 0 4px}',
    '.fdb-tick{width:6px;border-radius:4px;background:var(--tc,#EDE9A3);height:var(--h,8px);',
    '  animation:fdbgrow .5s cubic-bezier(.2,.7,.3,1) backwards;animation-delay:var(--d,0ms)}',
    '@keyframes fdbgrow{from{height:4px;opacity:.2}}',
    '.fdb-ticklbl{display:flex;justify-content:space-between;color:#9AA3AF;font-size:11px;margin-top:6px}',
    '.fdb-macros{margin-top:auto;display:flex;gap:18px;padding-top:14px;border-top:1px solid #EEF1F4;flex-wrap:wrap}',
    '.fdb-macro b{display:block;font-size:19px;font-weight:800}',
    '.fdb-macro small{color:var(--ink2);font-size:11.5px}',
    '.fdb-wave{flex:1;display:flex;align-items:center;min-height:120px;margin:6px 0}',
    '.fdb-wave svg{width:100%;height:130px;overflow:visible}',
    '.fdb-weight-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;flex-wrap:wrap}',
    '.fdb-kg{font-size:clamp(56px,5vw,88px);font-weight:800;letter-spacing:-3px;line-height:.9}',
    '.fdb-kg small{font-size:20px;font-weight:600;color:var(--ink2);letter-spacing:0}',
    '.fdb-keep{font-size:12.5px;color:var(--ink2);text-align:right;max-width:18ch}',
    '.fdb-keep b{display:block;color:var(--ink);font-size:15px;margin-top:2px}',
    '.fdb-tips{border:1px solid #E3E8EF;border-radius:18px;padding:14px 16px;font-size:13px;color:var(--ink2);',
    '  line-height:1.5;background:#FBFCFE;flex:1;display:flex;gap:10px;align-items:flex-start}',
    '.fdb-tips .fdb-pill{border:1px solid #E3E8EF;border-radius:999px;padding:4px 12px;font-size:12px;',
    '  font-weight:600;color:var(--ink);white-space:nowrap;flex:none}',
    '.fdb-wl-foot{display:flex;align-items:center;justify-content:space-between;margin-top:14px}',
    '.fdb-count{font-size:24px;font-weight:800}',
    '.fdb-count small{font-size:12.5px;font-weight:500;color:var(--ink2)}',
    '.fdb-nav{display:flex;gap:10px}',
    '.fdb-nav button{width:40px;height:40px;border-radius:50%;border:1px solid #E3E8EF;background:#fff;cursor:pointer;',
    '  color:var(--ink);display:flex;align-items:center;justify-content:center;transition:background .15s}',
    '.fdb-nav button:hover{background:var(--chip)}',
    '.fdb-risk{display:flex;flex-direction:column;gap:8px;margin:10px 0 4px;overflow:hidden}',
    '.fdb-riskrow{display:flex;align-items:center;gap:10px;background:#F7F9FC;border-radius:14px;padding:8px 12px}',
    '.fdb-riskrow .fdb-rav{width:34px;height:34px;border-radius:50%;background:var(--ink);color:#fff;font-weight:700;',
    '  font-size:12px;display:flex;align-items:center;justify-content:center;flex:none}',
    '.fdb-riskrow b{font-size:13.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.fdb-riskrow small{color:#c4453c;font-weight:600;font-size:11.5px;white-space:nowrap}',
    '.fdb-empty{text-align:center;padding:50px 20px;color:var(--ink2);font-size:15px}',
    '.fdb-empty b{display:block;color:var(--ink);font-size:20px;margin-bottom:6px}',
    '@media(max-width:1080px){.fdb-row1,.fdb-row2{grid-template-columns:1fr}.fdb-hero,.fdb-hydro{min-height:0}',
    '  .fdb-playwrap{position:static;transform:none;margin:18px auto 0}}',
    '@media(prefers-reduced-motion:reduce){.fdb *{animation:none!important;transition:none!important}}'
  ].join('\n');

  var GLASS_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3h10l-1.2 8.2a4 4 0 0 1-7.6 0L7 3z" opacity=".35"/><path d="M8.05 11.6a3.4 3.4 0 0 0 5.9 1.5 3.9 3.9 0 0 1-6.4-1.1l-.07-.5a3.4 3.4 0 0 0 .57.1zM7 3h10l-1.2 8.2a4 4 0 0 1-3.8 3.3 4 4 0 0 1-3.8-3.3L7 3z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 17.5v2.2a1.5 1.5 0 0 0 3 0v-2.2h-1v2.2a.5.5 0 0 1-1 0v-2.2h-1z"/></svg>';

  var ICON = {
    play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg>',
    arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/></svg>',
    drop: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3s6.5 7 6.5 11.2A6.5 6.5 0 0 1 5.5 14.2C5.5 10 12 3 12 3z"/></svg>',
    swap: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v13M7 4L4 7M7 4l3 3M17 20V7M17 20l3-3M17 20l-3-3"/></svg>',
    left: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
    chart: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>'
  };

  /* ---- module state ---- */
  var skill = 'Listening';        /* hydration-card segmented selector */
  var wlPage = 0;                 /* watchlist pager */
  var timer = null, tick = null, lastSavedAt = 0, lastSig = '';

  function esc(s) { var d = document.createElement('i'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function pct1(v) { return (v === null || v === undefined || isNaN(v)) ? '\u2013' : (Math.round(v * 10) / 10); }
  function initial(name) { return String(name || '?').trim().charAt(0).toUpperCase() || '?'; }
  /* atRisk reasons carry raw floats ('final 41.0111…', 'Spelling 38.666…') — tidy for display */
  function fmtReason(r) {
    return String(r || '').replace(/(\d+\.\d{2,})/g, function (_, n) { return String(Math.round(Number(n))); });
  }

  /* smooth wave path (catmull-rom -> cubic bezier); y-window auto-fits the data
     (pct values cluster, so the view spans [min-8, max+8] for an honest but
     visible curve) — circles carry the real values, big number shows the latest */
  function wavePath(pts, w, h) {
    if (!pts.length) return '';
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    if (hi - lo < 1) { hi = lo + 1; }
    var span = hi - lo, min = Math.max(0, lo - span * 0.8 - 2), max = Math.min(100, hi + span * 0.8 + 2);
    var mapY = function (p) { return h - 12 - (h - 26) * (Math.max(min, Math.min(max, p)) - min) / (max - min || 1); };
    var pad = 14, xs = pts.map(function (p, i) { return pts.length === 1 ? w / 2 : pad + (w - 2 * pad) * i / (pts.length - 1); });
    var ys = pts.map(mapY);
    var d = 'M' + xs[0].toFixed(1) + ',' + ys[0].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var x0 = xs[Math.max(0, i - 1)], y0 = ys[Math.max(0, i - 1)];
      var x1 = xs[i], y1 = ys[i], x2 = xs[i + 1], y2 = ys[i + 1];
      var x3 = xs[Math.min(pts.length - 1, i + 2)], y3 = ys[Math.min(pts.length - 1, i + 2)];
      d += 'C' + (x1 + (x2 - x0) / 6).toFixed(1) + ',' + (y1 + (y2 - y0) / 6).toFixed(1) + ' '
                + (x2 - (x3 - x1) / 6).toFixed(1) + ',' + (y2 - (y3 - y1) / 6).toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1);
    }
    return { d: d, pts: xs.map(function (x, i) { return { x: x, y: ys[i] }; }) };
  }

  function relTime(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    return h + 'h ' + (m % 60) + 'm ago';
  }

  /* animate a number between values (respects reduced motion) */
  function tween(el, to, suffix) {
    var from = Number(el.dataset.v || 0) || 0;
    el.dataset.v = to;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = String(to) + (suffix || ''); return; }
    var t0 = null, dur = 650;
    function step(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (Math.round((from + (to - from) * e) * 10) / 10) + (suffix || '');
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ================= render ================= */
  function render(mount, ctx) {
    var L = ctx.live;                                   /* window.SPR_LIVE from app.js */
    var U = window.Util, C = window.Calc;
    if (!U || !C || !L) { mount.innerHTML = '<div class="panel">Live board unavailable.</div>'; return; }

    if (!document.getElementById('fdb-style')) {
      var st = document.createElement('style'); st.id = 'fdb-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    if (timer) clearInterval(timer); if (tick) clearInterval(tick);

    var db = L.getDB();
    var sem = L.cur();
    var me = L.user() || { name: 'Teacher' };
    var root = document.createElement('div');
    root.className = 'fdb';
    mount.innerHTML = ''; mount.appendChild(root);

    if (!db || !db.semesters || !db.semesters.length || !sem || !sem.students || !sem.students.length) {
      root.innerHTML =
        '<div class="fdb-empty"><b>No class data yet</b>' +
        'Open a class and enter a few scores \u2014 the live board lights up with real numbers.' +
        '<div style="margin-top:16px"><a class="fdb-cta" href="#/students">' + ICON.arrow.replace('width="18"', 'width="15"').replace('height="18"', 'height="15"') + 'Go to Students</a></div></div>';
      return;
    }

    var gAll = C.gradeAll(sem);
    var SK = C.SKILLS;                                  /* ['Listening','Speaking','Writing','Reading'] */
    var students = sem.students.slice();
    var nameOf = function (sid) { var s = students.find(function (x) { return x.id === sid; }); return (s && (s.nameEn || s.nameCn)) || sid; };

    /* --- aggregates --- */
    var skillAvg = {}, skillBySid = {};
    SK.forEach(function (k) {
      var vals = [], per = {};
      gAll.forEach(function (g) { var v = g.skills[k]; per[g.sid] = v; if (v !== null && v !== undefined) vals.push(v); });
      skillAvg[k] = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
      skillBySid[k] = per;
    });
    var finals = gAll.filter(function (g) { return g.final !== null && C.assessedCount(g) >= C.FINAL_MIN_ASSESSED; })
                     .map(function (g) { return g.final; }).sort(function (a, b) { return a - b; });
    var classAvg = finals.length ? finals.reduce(function (a, b) { return a + b; }, 0) / finals.length : null;
    var risk = C.atRisk(sem) || [];
    var gated = gAll.filter(function (g) { return C.assessedCount(g) >= C.FINAL_MIN_ASSESSED; }).length;
    var months = sem.months || [];
    var wavePts = months.map(function (m) { return C.classMonthPct(sem, 'obs', m); });
    var assessedPct = (function () {
      var tot = 0; gAll.forEach(function (g) { tot += Math.min(9, C.assessedCount(g)); });
      return gAll.length ? Math.round(100 * tot / (gAll.length * 9)) : 0;
    })();

    /* ============ HTML ============ */
    var avHtml = students.slice(0, 3).map(function (s) { return '<span class="fdb-av">' + esc(initial(s.nameEn || s.nameCn)) + '</span>'; }).join('')
      + (students.length > 3 ? '<span class="fdb-av fdb-more">+' + (students.length - 3) + '</span>' : '');

    var glasses = students.slice(0, 30).map(function (s) {
      var v = skillBySid[skill][s.id];
      return '<span class="fdb-glass' + (v !== null && v !== undefined && v >= 50 ? ' on' : '') + '" title="' + esc(nameOf(s.id)) + ': ' + pct1(v) + '%">' + GLASS_SVG + '</span>';
    }).join('');

    var seg = SK.map(function (k) {
      return '<button class="' + (k === skill ? 'on' : '') + '" data-fdbskill="' + esc(k) + '" title="' + esc(k) + ' \u2014 class avg ' + pct1(skillAvg[k]) + '%">' + esc(k.charAt(0)) + '</button>';
    }).join('');

    var ticks = finals.map(function (v, i) {
      var h = 8 + 68 * (v / 100), t = Math.round(v) >= 75 ? '#9DB022' : Math.round(v) >= 55 ? '#C6D36A' : '#EDE9A3';
      return '<span class="fdb-tick" style="--h:' + h.toFixed(0) + 'px;--tc:' + t + ';--d:' + (i * 8) + 'ms" title="' + Math.round(v) + '%"></span>';
    }).join('');

    var wsvg = (function () {
      if (!wavePts.length) return '';
      var valid = [], lbl = [];
      months.forEach(function (m, i) { if (wavePts[i] !== null) { valid.push(wavePts[i]); lbl.push(U.MONTH_ABBR && U.MONTH_ABBR[m] ? U.MONTH_ABBR[m] : m); } });
      if (valid.length < 2) return '<div class="fdb-subrow" style="margin:0">Not enough monthly data for a trend yet \u2014 ' + esc(lbl[0] || '') + ': ' + pct1(valid[0]) + '%</div>';
      var wave = wavePath(valid, 320, 130);
      return '<svg viewBox="0 0 320 130" preserveAspectRatio="none" role="img" aria-label="Class average by month">' +
        '<defs><linearGradient id="fdbwave" x1="0" x2="1"><stop offset="0" stop-color="#57C6C0" stop-opacity=".15"/><stop offset=".5" stop-color="#57C6C0"/><stop offset="1" stop-color="#BFE3F5"/></linearGradient></defs>' +
        '<path d="' + wave.d + '" fill="none" stroke="url(#fdbwave)" stroke-width="3" stroke-linecap="round"/>' +
        wave.pts.map(function (pt) {
          return '<circle cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="4" fill="#fff" stroke="#57C6C0" stroke-width="2.5"/>';
        }).join('') + '</svg>';
    })();

    var PER = 4, pages = Math.max(1, Math.ceil(risk.length / PER));
    if (wlPage >= pages) wlPage = 0;
    var riskRows = risk.slice(wlPage * PER, wlPage * PER + PER).map(function (r) {
      return '<div class="fdb-riskrow"><span class="fdb-rav">' + esc(initial(nameOf(r.sid))) + '</span>' +
        '<b>' + esc(nameOf(r.sid)) + '</b><small>' + esc(fmtReason(r.reasons[0])) + '</small></div>';
    }).join('') || '<div class="fdb-subrow" style="margin:0">No flagged students \u2014 the whole class is on track.</div>';

    root.innerHTML =
      '<div class="fdb-head">' +
        '<div><h1 class="fdb-hi">Hi, ' + esc(me.name || 'Teacher') + '!</h1>' +
          '<div class="fdb-sub">Here\u2019s your class, live \u2014 every save updates this board.</div></div>' +
        '<div class="fdb-head-r">' +
          '<span class="fdb-live"><span class="fdb-dot"></span>LIVE \u00b7 <span id="fdbSaved">saved \u2026</span></span>' +
          '<label class="fdb-sempill">' + ICON.search +
            '<select id="fdbSem" aria-label="Semester">' + db.semesters.map(function (s) {
              return '<option value="' + esc(s.id) + '"' + (s.id === db.currentSemesterId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
          '<a class="fdb-cta" href="#/dashboard"><span class="fdb-limedot"></span>Open Markbook</a></div>' +
      '</div>' +

      '<div class="fdb-row1">' +
        '<div class="fdb-card fdb-hero">' +
          '<div class="fdb-eyebrow">' + esc(sem.className || sem.school || 'Class') + ' \u00b7 ' + esc(sem.name) + '</div>' +
          '<h2>Your Class Progress Starts Here!</h2>' +
          '<div class="fdb-playwrap"><a class="fdb-play" href="#/analysis/class" title="Class analysis">' + ICON.play + '</a>' +
            '<a class="fdb-playcap" href="#/analysis/class">Explore Analysis</a></div>' +
          '<div class="fdb-hero-foot">' +
            '<div class="fdb-join">Working with:' +
              '<div class="fdb-avs">' + avHtml + '</div>' +
              '<span class="fdb-n">' + students.length + '</span> <span class="fdb-nsmall">students \u00b7 ' + months.length + ' months</span></div>' +
            '<a class="fdb-cta fdb-lg" href="#/entry/sp">Enter Scores<span class="fdb-arw">' + ICON.arrow + '</span></a>' +
          '</div>' +
        '</div>' +
        '<div class="fdb-card fdb-hydro">' +
          '<h3>Skill Status</h3>' +
          '<div class="fdb-hcopy">Track how the class holds each core skill. Filled cups are students at or above 50%.</div>' +
          (skillAvg[skill] !== null && skillAvg[skill] >= 85 ? '<span class="fdb-welldone">Well Done \ud83d\udc4d</span>' : '') +
          '<div class="fdb-glasses">' + glasses + '</div>' +
          '<div class="fdb-hydro-foot">' +
            '<div class="fdb-seg">' + seg + '</div>' +
            '<div style="text-align:right"><div class="fdb-bignum" id="fdbSkill">' + pct1(skillAvg[skill]) + '%</div>' +
              '<div class="fdb-bigunit">class avg \u00b7 ' + esc(skill) + '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="fdb-row2">' +
        '<div class="fdb-card fdb-white">' +
          '<div class="fdb-whead"><span class="fdb-chip">' + ICON.moon + '</span><h3>Watchlist</h3></div>' +
          '<div class="fdb-subrow">students flagged by the attainment rules</div>' +
          '<div class="fdb-risk">' + riskRows + '</div>' +
          '<div class="fdb-tips"><span class="fdb-pill">\ud83c\udf19 Focus time</span>' +
            '<span>Pair watchlist students with your strongest readers for short peer-reading sessions \u2014 two of the flagged areas respond fastest to weekly 1:1 reading.</span></div>' +
          '<div class="fdb-wl-foot">' +
            '<span class="fdb-count">' + risk.length + '<small> / ' + gated + ' to review</small></span>' +
            '<div class="fdb-nav">' +
              '<button id="fdbWlPrev" aria-label="Previous watchlist page"' + (pages < 2 ? ' disabled' : '') + '>' + ICON.left + '</button>' +
              '<button id="fdbWlNext" aria-label="Next watchlist page"' + (pages < 2 ? ' disabled' : '') + '>' + ICON.right + '</button></div>' +
          '</div>' +
        '</div>' +
        '<div class="fdb-card fdb-white">' +
          '<div class="fdb-whead"><span class="fdb-chip">' + ICON.drop + '</span><h3>Class Average</h3>' +
            '<span class="fdb-right"><span id="fdbGraded">' + finals.length + '</span><small>fully graded</small></span></div>' +
          '<div class="fdb-subrow">weighted final score per student, low \u2192 high</div>' +
          '<div class="fdb-cal-big"><span id="fdbAvg">' + pct1(classAvg) + '</span><small> %</small></div>' +
          '<div class="fdb-ticks">' + ticks + '</div>' +
          '<div class="fdb-ticklbl"><span>0</span><span>100</span></div>' +
          '<div class="fdb-macros">' +
            '<span class="fdb-macro"><b id="fdbSp">' + pct1(C.classComponentAvg(sem, 'Spelling')) + '%</b><small>Spelling</small></span>' +
            '<span class="fdb-macro"><b id="fdbDa">' + pct1(C.classComponentAvg(sem, 'Daily Assignments')) + '%</b><small>Daily work</small></span>' +
            '<span class="fdb-macro"><b id="fdbTs">' + pct1((function (a) { return a === null ? null : a; })(
              (function () { var t = [C.classTestAvg(sem, 'midterm'), C.classTestAvg(sem, 'oral'), C.classTestAvg(sem, 'written')].filter(function (v) { return v !== null; }); return t.length ? t.reduce(function (x, y) { return x + y; }, 0) / t.length : null; })()
            )) + '%</b><small>Tests</small></span>' +
          '</div>' +
        '</div>' +
        '<div class="fdb-card fdb-white">' +
          '<div class="fdb-whead"><span class="fdb-chip">' + ICON.swap + '</span><h3>Progress Wave</h3>' +
            '<span class="fdb-right">80%<small>target</small></span></div>' +
          '<div class="fdb-subrow">class observation average by month</div>' +
          '<div class="fdb-wave">' + wsvg + '</div>' +
          '<div class="fdb-weight-foot">' +
            '<div class="fdb-kg"><span id="fdbLatest">' + pct1(wavePts.length ? wavePts[wavePts.length - 1] : null) + '</span><small> %</small></div>' +
            '<div class="fdb-keep">of components assessed<b>' + (assessedPct >= 60 ? 'Keep it up!' : assessedPct >= 30 ? 'Good start!' : 'Early days') + '</b></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    /* ---- interactions ---- */
    var semSel = root.querySelector('#fdbSem');
    if (semSel) semSel.onchange = function () { try { L.setSem(semSel.value); } catch (e) {} };
    root.querySelectorAll('[data-fdbskill]').forEach(function (b) {
      b.onclick = function () { skill = b.dataset.fdbskill; render(mount, ctx); };
    });
    var prev = root.querySelector('#fdbWlPrev'), next = root.querySelector('#fdbWlNext');
    if (prev) prev.onclick = function () { wlPage = (wlPage - 1 + pages) % pages; render(mount, ctx); };
    if (next) next.onclick = function () { wlPage = (wlPage + 1) % pages; render(mount, ctx); };

    /* ---- live updates ---- */
    function savedTxt() {
      var el = root.querySelector('#fdbSaved'); if (!el || !el.isConnected) return false;
      var at = 0; try { at = Number(localStorage.getItem('spr-last-save-at') || 0); } catch (e) {}
      el.textContent = at ? 'saved ' + relTime(at) : 'no saves yet';
      return true;
    }
    savedTxt();
    tick = setInterval(function () { if (!savedTxt()) clearInterval(tick); }, 4000);

    function sig() {
      try { return [localStorage.getItem('spr-last-save-at'), db.currentSemesterId, location.hash].join('|'); } catch (e) { return ''; }
    }
    lastSig = sig();
    timer = setInterval(function () {
      if (!root.isConnected) { clearInterval(timer); return; }   /* view switched away — self-clean */
      if (sig() !== lastSig && location.hash.replace(/^#\/?/, '').split('/')[0] === 'live') {
        try { render(mount, ctx); } catch (e) { clearInterval(timer); }
      }
    }, 2500);
  }

  window.SPRLiveBoard = { render: render };
})();
