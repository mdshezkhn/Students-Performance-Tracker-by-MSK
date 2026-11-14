/* =========================================================================
   SPR Import Audit — data-quality engine for imported SPR workbooks.
   Node-safe: no DOM. In browser: window.SPRAudit; in node: module.exports.

   The engine is deliberately SEPARATE from the import path (excel.js
   imports best-effort and drops bad cells with warnings): this module
   inspects the SAME workbook BEFORE anything is imported and produces a
   reviewable findings list (CRITICAL / WARNING / INFORMATION) with the
   student, sheet and cell involved. Findings never mutate the workbook.

   Reference implementation for all average/grade expectations is the real
   calculation engine (calc.js) — never a re-implementation.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPRAudit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const Calc = (typeof window !== 'undefined' && window.Calc) || (typeof require === 'function' ? require('./calc.js') : null);
  const Util = (typeof window !== 'undefined' && window.Util) || (typeof require === 'function' ? require('./util.js') : null);
  const XLSX = (typeof window !== 'undefined' && window.XLSX) || (typeof require === 'function' ? require('./libs/xlsx.full.min.js') : null);

  const MONTH_ORDER = Util.MONTHS;
  const monthIdx = (m) => MONTH_ORDER.indexOf(m);
  const acadRank = (m) => ((monthIdx(m) - 8 + 12) % 12) + 1;

  /* -------- low-level readers (mirror excel.js but formula-aware) -------- */
  function rowsOf(wb, wanted) {
    const name = (wb.SheetNames || []).find((n) => wanted.some((w) => n.toLowerCase().includes(w)));
    if (!name) return null;
    return { name, ws: wb.Sheets[name], rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) };
  }
  const cell = (rows, r, c) => (rows[r] && rows[r][c] !== undefined ? rows[r][c] : null);
  const numOrNull = (v) => (v === null || v === undefined || v === '' || typeof v === 'string' && !v.trim() || isNaN(Number(v)) ? null : Number(v));
  const addr = (r, c) => XLSX.utils.encode_cell({ r, c });

  /* formulas: SheetJS keeps .f on cells; row/col arrays lose it, so we walk
     the sheet's cell objects directly for the data region */
  function formulasInRange(ws, r0, r1, c0, c1) {
    const out = [];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let r = Math.max(r0, range.s.r); r <= Math.min(r1, range.e.r); r++) {
      for (let c = Math.max(c0, range.s.c); c <= Math.min(c1, range.e.c); c++) {
        const k = XLSX.utils.encode_cell({ r, c });
        const cel = ws[k];
        if (cel && cel.t === 'n' && typeof cel.f === 'string') out.push({ ref: k, f: cel.f, v: cel.v });
      }
    }
    return out;
  }

  function monthBlocks(rows, blockWidth) {
    const months = [];
    let c = 5;
    const width = Math.max((rows[0] || []).length, (rows[2] || []).length);
    while (c < width + 2) {
      const m = Util.canonMonth(cell(rows, 0, c));
      if (m) { months.push({ name: m, col: c }); c += blockWidth; }
      else c += 1;
    }
    return months;
  }

  /* ---------------- profile: what is in this workbook ---------------- */
  function profile(wb) {
    const obs = rowsOf(wb, ['observation']);
    const sp = rowsOf(wb, ['spelling']);
    const da = rowsOf(wb, ['daily']);
    const te = rowsOf(wb, ['test']);
    const sheets = { obs, sp, da, te };
    const rosterSrc = te || sp || obs || da;
    const roster = rosterSrc ? studentRows(rosterSrc.rows) : [];
    const months = {};
    if (obs) months.obs = monthBlocks(obs.rows, 8).map((m) => m.name);
    if (sp) months.sp = monthBlocks(sp.rows, 11).map((m) => m.name);
    if (da) months.da = monthBlocks(da.rows, 11).map((m) => m.name);
    return {
      sheetsFound: { observations: !!obs, spelling: !!sp, daily: !!da, tests: !!te },
      sheetNames: { observations: obs && obs.name, spelling: sp && sp.name, daily: da && da.name, tests: te && te.name },
      rosterSource: rosterSrc && rosterSrc.name,
      rosterCount: roster.length,
      months,
      school: rosterSrc ? String(cell(rosterSrc.rows, 0, 1) ?? '').trim() : '',
      className: rosterSrc ? String(cell(rosterSrc.rows, 1, 1) ?? '').trim() : '',
    };
  }

  function studentRows(rows) {
    const out = [];
    for (let r = 4; rows && r < rows.length; r++) {
      if (!rows[r]) continue;
      const id = cell(rows, r, 1);
      if (id === null || id === undefined) continue;
      const idStr = String(id).trim();
      if (!idStr || /^0+$/.test(idStr)) continue;
      if (idStr.toLowerCase().includes('number')) continue;
      out.push({ row: r, id: idStr, nameCn: String(cell(rows, r, 2) ?? '').trim(), nameEn: String(cell(rows, r, 3) ?? '').trim(), gender: Util.normGender(cell(rows, r, 4)) });
    }
    return out;
  }

  /* ---------------- the audit ---------------- */
  function audit(wb, opts) {
    opts = opts || {};
    const F = [];   /* findings */
    const push = (severity, code, message, extra) => {
      F.push(Object.assign({ severity, code, message }, extra || {}));
    };
    const p = profile(wb);
    const obs = rowsOf(wb, ['observation']);
    const sp = rowsOf(wb, ['spelling']);
    const da = rowsOf(wb, ['daily']);
    const te = rowsOf(wb, ['test']);

    /* --- A. completeness of the workbook structure --- */
    const missingSheets = ['observations', 'spelling', 'daily', 'tests'].filter((k) => !p.sheetsFound[k]);
    if (missingSheets.length === 4) { push('critical', 'no-spr-sheets', 'No SPR sheets found (need Classroom Observations / Spelling / Daily Assignment / Tests).'); return { findings: F, profile: p, stats: stats(F, p) }; }
    if (missingSheets.length) push('warning', 'missing-sheet', 'Worksheet not found: ' + missingSheets.join(', ') + '. Its scores cannot be imported or checked.', { sheet: '' });
    if (!p.rosterCount) { push('critical', 'no-roster', 'No student rows found (columns: Index, ID, Chinese name, English name, Gender).'); return { findings: F, profile: p, stats: stats(F, p) }; }

    /* --- C1. roster consistency --- */
    const seen = new Map();
    for (const r of studentRows((te || sp || obs || da).rows)) {
      if (seen.has(r.id)) push('critical', 'duplicate-id', 'Student ID ' + r.id + ' appears more than once (rows ' + (seen.get(r.id) + 1) + ' and ' + (r.row + 1) + ').', { student: r.id, sheet: (te || sp || obs).name, cell: addr(r.row, 1), suggestion: 'Give the second student a unique ID, or remove the duplicated row.' });
      else seen.set(r.id, r.row);
      if (!r.nameCn && !r.nameEn) push('warning', 'missing-name', 'Student ' + r.id + ' has no Chinese or English name.', { student: r.id, sheet: (te || sp || obs).name, cell: addr(r.row, 2), suggestion: 'Add at least one name so reports can identify the student.' });
      if (r.gender === null) push('info', 'missing-gender', 'Gender is blank for ' + (r.nameEn || r.nameCn || r.id) + ' (optional).', { student: r.id, sheet: (te || sp || obs).name, cell: addr(r.row, 4) });
    }
    /* same id, different names between sheets */
    if (te && sp) {
      const a = new Map(studentRows(te.rows).map((r) => [r.id, r.nameEn + '|' + r.nameCn]));
      for (const r of studentRows(sp.rows)) {
        const other = a.get(r.id);
        if (other && other !== r.nameEn + '|' + r.nameCn) push('warning', 'inconsistent-name', 'Student ' + r.id + ' has different names on the Tests and Spelling sheets.', { student: r.id, sheet: sp.name, cell: addr(r.row, 2), suggestion: 'Make the names identical on every sheet.' });
      }
    }

    /* --- B3. impossible scores + D. distribution, category by category --- */
    function scanWeekly(sh, label) {
      if (!sh) return;
      for (const mb of monthBlocks(sh.rows, 11)) {
        for (const r of studentRows(sh.rows)) {
          for (let w = 1; w <= 5; w++) {
            const s = numOrNull(cell(sh.rows, r.row, mb.col + (w - 1) * 2));
            const t = numOrNull(cell(sh.rows, r.row, mb.col + (w - 1) * 2 + 1));
            const who = r.nameEn || r.nameCn || r.id;
            if (s !== null && s < 0) push('critical', 'negative-score', who + ' has a negative ' + label + ' score in ' + mb.name + ' week ' + w + '.', { student: r.id, sheet: sh.name, cell: addr(r.row, mb.col + (w - 1) * 2), expected: '0 or more', suggestion: 'Correct the score (or clear the cell if not assessed).' });
            if (s !== null && t !== null && t <= 0) push('critical', 'bad-total', who + ' has a total of ' + t + ' (must be above 0) in ' + mb.name + ' week ' + w + '.', { student: r.id, sheet: sh.name, cell: addr(r.row, mb.col + (w - 1) * 2 + 1), suggestion: 'Enter the real maximum for this assessment.' });
            if (s !== null && t !== null && s > t) push('critical', 'score-over-total', who + ' scored ' + s + ' of ' + t + ' in ' + mb.name + ' week ' + w + '.', { student: r.id, sheet: sh.name, cell: addr(r.row, mb.col + (w - 1) * 2), expected: 'at most ' + t, suggestion: 'Check the score and the total; one of them is wrong.' });
          }
        }
      }
    }
    scanWeekly(sp, 'spelling');
    scanWeekly(da, 'daily assignment');

    /* --- D3 (round11 §6): inconsistent assessment maxima. The class modal
       maximum per (sheet, month, week) is the expected value; a row whose
       total cell deviates is almost always a mistyped total. WARNING, not
       critical: a teacher may legitimately run a one-off different total. --- */
    function scanMaxConsistency(sh, label) {
      if (!sh) return;
      const rows_ = studentRows(sh.rows);
      for (const mb of monthBlocks(sh.rows, 11)) {
        for (let w = 1; w <= 5; w++) {
          const tally = {};
          for (const r of rows_) {
            const t = numOrNull(cell(sh.rows, r.row, mb.col + (w - 1) * 2 + 1));
            if (t !== null && t > 0) tally[t] = (tally[t] || 0) + 1;
          }
          const keys = Object.keys(tally);
          if (keys.length < 2) continue;   /* uniform (or empty): nothing to compare */
          let modal = keys[0];
          for (const k of keys) if (tally[k] > tally[modal]) modal = k;
          if (tally[modal] < 2) continue;  /* no stable majority to trust */
          for (const r of rows_) {
            const t = numOrNull(cell(sh.rows, r.row, mb.col + (w - 1) * 2 + 1));
            if (t !== null && t > 0 && String(t) !== modal) {
              push('warning', 'max-inconsistent', (r.nameEn || r.nameCn || r.id) + ': the ' + label + ' total for ' + mb.name + ' week ' + w + ' is ' + t + ' but the class uses ' + modal + '.', { student: r.id, sheet: sh.name, cell: addr(r.row, mb.col + (w - 1) * 2 + 1), expected: modal, suggestion: 'Check this total cell; one of the two values is a typo.' });
            }
          }
        }
      }
    }
    if (sp) scanMaxConsistency(sp, 'Spelling');
    if (da) scanMaxConsistency(da, 'Daily Assignment');
    if (obs) {
      for (const mb of monthBlocks(obs.rows, 8)) {
        for (const r of studentRows(obs.rows)) {
          Calc.SKILLS.forEach((sk, si) => {
            for (const lo of [1, 2]) {
              const v = numOrNull(cell(obs.rows, r.row, mb.col + si * 2 + lo - 1));
              if (v !== null && !Calc.validObs(v)) push('critical', 'obs-out-of-range', (r.nameEn || r.nameCn || r.id) + ' has an observation value of ' + v + ' (' + sk + ' LO' + lo + ', ' + mb.name + '). Observations are 0 to 10.', { student: r.id, sheet: obs.name, cell: addr(r.row, mb.col + si * 2 + lo - 1), expected: '0 to 10', suggestion: 'Observations use the 0 to 10 scale.' });
            }
          });
        }
      }
    }
    if (te) {
      for (const r of studentRows(te.rows)) {
        for (const [kind, c0] of [['Mid-Term', 5], ['Oral', 8], ['Written', 11]]) {
          const s = numOrNull(cell(te.rows, r.row, c0));
          const t = numOrNull(cell(te.rows, r.row, c0 + 1));
          if (s !== null && t !== null && t > 0 && s > t) push('critical', 'score-over-total', (r.nameEn || r.nameCn || r.id) + ' scored ' + s + ' of ' + t + ' on the ' + kind + ' test.', { student: r.id, sheet: te.name, cell: addr(r.row, c0), expected: 'at most ' + t, suggestion: 'Check the score and the total.' });
        }
      }
    }

    /* --- B1. formula cells inside data areas (SPR teachers type values;
       formulas here are usually broken copies of someone else's sheet) --- */
    function scanFormulas(sh, label) {
      if (!sh) return 0;
      const r0 = 4, r1 = 4 + studentRows(sh.rows).length + 2;
      const fs = formulasInRange(sh.ws, r0, r1, 5, Math.max(5, ((sh.rows[0] || []).length) - 1));
      for (const f of fs) {
        push('warning', 'formula-in-data', 'Cell ' + f.ref + ' on ' + sh.name + ' contains a formula (= ' + f.f + '). Imported scores must be plain numbers.', { sheet: sh.name, cell: f.ref, suggestion: 'Copy the column and Paste-Special as values, then check the numbers.' });
      }
      return fs.length;
    }
    /* --- B1b. error-typed cells (#REF!, #DIV/0!, #N/A ...) in the data
       region: whatever produced them, the cell cannot be a valid score and
       Excel shows it as a broken calculation. round11 §6. --- */
    function scanErrorCells(sh) {
      if (!sh || !sh.ws) return;
      const range = XLSX.utils.decode_range(sh.ws['!ref'] || 'A1');
      const r1 = Math.min(range.e.r, 4 + studentRows(sh.rows).length + 2);
      for (let r = Math.max(range.s.r, 4); r <= r1; r++) {
        for (let c = 5; c <= range.e.c; c++) {
          const cel = sh.ws[XLSX.utils.encode_cell({ r: r, c: c })];
          if (cel && cel.t === 'e') {
            push('critical', 'error-cell', 'Cell ' + XLSX.utils.encode_cell({ r: r, c: c }) + ' on ' + sh.name + ' shows the error ' + (cel.w || cel.v) + '. It cannot be a valid score.', { sheet: sh.name, cell: XLSX.utils.encode_cell({ r: r, c: c }), expected: 'a number or an empty cell', suggestion: 'Fix or clear the cell in Excel, then import again.' });
          }
        }
      }
    }
    const formulaCount = scanFormulas(obs); scanErrorCells(obs) + scanFormulas(sp); scanErrorCells(sp) + scanFormulas(da); scanErrorCells(da) + scanFormulas(te); scanErrorCells(te);

    /* --- B2. cached averages vs the real engine --- */
    if (sp || da) {
      const sem = buildSemesterForCalc(wb, p, { silent: true });
      const per = Calc.gradeAll(sem);
      const byId = new Map(studentRows((te || sp).rows).map((r) => [r.id, r]));
      for (const g of per) {
        const r = byId.get(g.sid);
        const who = (r && (r.nameEn || r.nameCn)) || g.sid;
        /* weekly avg columns in the workbook: col mb.col+10 per month */
        const sh = sp || da;
        for (const mb of monthBlocks(sh.rows, 11)) {
          const cached = numOrNull(cell(sh.rows, r ? r.row : -1, mb.col + 10));
          if (cached === null || r === undefined) continue;
          const recomputedKey = (sp ? 'Spelling' : 'Daily Assignments');
          const g2 = Calc.gradeStudent(sem, g.sid);
          const expect = g2.parts[recomputedKey];
          void expect;
          /* compare against the WEEKLY month percent, not the semester one */
          const monthPct = Calc.weeklyMonthPct(sem, g.sid, sp ? 'spelling' : 'daily', mb.name);
          if (monthPct !== null && Math.abs(Number(cached) - monthPct) > 0.51) {
            push('critical', 'avg-mismatch', who + ': the ' + (sp ? 'Spelling' : 'Daily') + ' average for ' + mb.name + ' shows ' + cached + '% but the scores give ' + Calc.round1(monthPct) + '%.', { student: g.sid, sheet: sh.name, cell: addr(r.row, mb.col + 10), expected: Calc.round1(monthPct) + '%', suggestion: 'Recalculate the sheet (Ctrl+Alt+F9) or fix the formula; SPR will use the scores, not this cell.' });
          }
        }
      }
    }

    /* --- E. FET/CET workflow completeness (informational by design) --- */
    const allMonths = [...new Set([].concat(p.months.obs || [], p.months.sp || [], p.months.da || []))].sort((a, b) => acadRank(a) - acadRank(b));
    if (obs && p.months.obs) {
      for (const m of p.months.obs) {
        let filled = 0;
        for (const r of studentRows(obs.rows)) {
          const mb = monthBlocks(obs.rows, 8).find((x) => x.name === m);
          if (!mb) break;
          let any = false;
          for (let c = mb.col; c < mb.col + 8; c++) { if (numOrNull(cell(obs.rows, r.row, c)) !== null) { any = true; break; } }
          if (any) filled++;
        }
        if (filled === 0) push('info', 'fet-observations-missing', 'No classroom observations recorded for ' + m + '. The foreign teacher (FET) normally records these.', { sheet: obs.name, suggestion: 'Not a data error: note it for the FET if observations were actually held.' });
      }
    }
    for (const [sh, label] of [[sp, 'Spelling'], [da, 'Daily assignments']]) {
      if (!sh || !p.months[sh === sp ? 'sp' : 'da']) continue;
      for (const m of p.months[sh === sp ? 'sp' : 'da']) {
        const mb = monthBlocks(sh.rows, 11).find((x) => x.name === m);
        if (!mb) continue;
        let filled = 0;
        for (const r of studentRows(sh.rows)) { for (let w = 0; w < 5; w++) { if (numOrNull(cell(sh.rows, r.row, mb.col + w * 2)) !== null) { filled++; break; } } }
        if (filled === 0) push('info', 'cet-scores-missing', 'No ' + label + ' scores recorded for ' + m + '. The Chinese teacher-assistant (CET) normally records these.', { sheet: sh.name, suggestion: 'Not a data error: note it for the CET if the assessment was actually held.' });
      }
    }

    /* --- D. statistical anomalies (review flags, never errors) --- */
    if (sp || da) {
      const sem = buildSemesterForCalc(wb, p, { silent: true });
      const per = Calc.gradeAll(sem).filter((g) => g.final !== null);
      if (per.length >= 5) {
        const finals = per.map((g) => g.final).sort((a, b) => a - b);
        const med = finals[Math.floor(finals.length / 2)];
        for (const g of per) {
          if (g.final <= 15 && med >= 50) push('info', 'low-performance-review', 'Student ' + g.sid + ' averages ' + Calc.round1(g.final) + '% while the class median is ' + Calc.round1(med) + '%. Review their assessed work.', { student: g.sid, suggestion: 'This is a performance signal, not a data error. Consider a teacher conversation.' });
        }
      }
      /* uniform rows: every assessed score identical */
      for (const s of sem.students) {
        const vals = [];
        ['spelling', 'daily'].forEach((k) => {
          const byM = sem[k][s.id] || {};
          Object.keys(byM).forEach((m) => Object.keys(byM[m]).forEach((w) => { const c = byM[m][w]; if (c && c.s !== null) vals.push(c.s / (c.t || 1)); }));
        });
        if (vals.length >= 8) {
          const first = vals[0];
          if (vals.every((v) => Math.abs(v - first) < 1e-9)) push('info', 'uniform-scores', 'Student ' + s.id + ' has the identical result on all ' + vals.length + ' assessed tasks. Possible copy-paste entry.', { student: s.id, suggestion: 'Not an error by itself: verify with the teacher who entered them.' });
        }
      }
    }

    return { findings: F, profile: p, stats: Object.assign(stats(F, p), { formulaCount: formulaCount, months: allMonths }) };
  }

  function stats(F, p) {
    const bySeverity = { critical: 0, warning: 0, info: 0 };
    F.forEach((f) => { if (bySeverity[f.severity] !== undefined) bySeverity[f.severity]++; });
    return { students: p.rosterCount, sheets: p.sheetsFound, bySeverity, total: F.length };
  }

  /* build a semester object exactly the way excel.js importWorkbook does,
     but SILENT (no warnings callback) — the engine reuses the same shape the
     calculation engine already understands */
  function buildSemesterForCalc(wb, p, opts) {
    const EB = (typeof window !== 'undefined' && window.ExcelBridge) || (typeof require === 'function' ? require('./excel.js') : null);
    const sem = EB.importWorkbook(wb, { id: 'audit-sem', name: 'Audit semester', warnings: null });
    return sem;
  }

  /* ---------------- reports ---------------- */
  function toCsv(findings) {
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['severity', 'code', 'student', 'sheet', 'cell', 'message', 'expected', 'suggestion'];
    return [head.join(',')]
      .concat(findings.map((f) => [f.severity, f.code, f.student || '', f.sheet || '', f.cell || '', f.message, f.expected || '', f.suggestion || ''].map(esc).join(',')))
      .join('\r\n');
  }
  function toWorkbook(findings, profileInfo) {
    const wb = XLSX.utils.book_new();
    const rows = [['SPR Import Audit'], ['Generated', new Date().toISOString()], ['School', (profileInfo && profileInfo.school) || ''], ['Class', (profileInfo && profileInfo.className) || ''], ['Students', (profileInfo && profileInfo.rosterCount) || 0], [],
      ['Severity', 'Code', 'Student', 'Sheet', 'Cell', 'Message', 'Expected', 'Suggestion']]
      .concat(findings.map((f) => [f.severity, f.code, f.student || '', f.sheet || '', f.cell || '', f.message, f.expected || '', f.suggestion || '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'SPR Audit');
    return wb;
  }

  return { profile: profile, audit: audit, toCsv: toCsv, toWorkbook: toWorkbook, studentRows: studentRows, monthBlocks: monthBlocks };
});
