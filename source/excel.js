/* =========================================================================
   Excel bridge — import SPR workbooks, export SPR workbooks (SheetJS)
   Node-safe: no DOM. In browser: window.ExcelBridge; in node: module.exports.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExcelBridge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const Calc = (typeof window !== 'undefined' && window.Calc) || (typeof require === 'function' ? require('./calc.js') : null);
  const Util = (typeof window !== 'undefined' && window.Util) || (typeof require === 'function' ? require('./util.js') : null);
  const XLSX = (typeof window !== 'undefined' && window.XLSX) || (typeof require === 'function' ? require('../libs/xlsx.full.min.js') : null);

  const SKILLS = Calc.SKILLS;
  const MONTH_ORDER = Util.MONTHS;
  const monthIdx = (m) => MONTH_ORDER.indexOf(m);
  /* academic-year order: September first (Sep=1 … Aug=12) — right for both
     fall (Sep–Jan) and spring (Feb–Jun) semesters */
  const acadRank = (m) => ((monthIdx(m) - 8 + 12) % 12) + 1;

  /* ---------------- reading helpers ---------------- */
  function sheetRows(wb, wanted) {
    const name = (wb.SheetNames || []).find((n) =>
      wanted.some((w) => n.toLowerCase().includes(w))
    );
    if (!name) return null;
    return {
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }),
    };
  }

  const cell = (rows, r, c) => (rows[r] && rows[r][c] !== undefined ? rows[r][c] : null);
  const numOrNull = (v) => (v === null || v === undefined || v === '' || typeof v === 'string' && !v.trim() || isNaN(Number(v)) ? null : Number(v));

  /* find student rows: scan from row 5 (idx 4) where col B (idx1) has a real ID.
     (workbooks often carry trailing rows of zeros — skip them) */
  function studentRows(rows) {
    const out = [];
    for (let r = 4; r < rows.length + 10; r++) {
      if (!rows[r]) continue;
      const id = cell(rows, r, 1);
      if (id === null || id === undefined) continue;
      const idStr = String(id).trim();
      if (!idStr || /^0+$/.test(idStr)) continue;
      if (idStr.toLowerCase().includes('number')) continue;
      const nameCn = String(cell(rows, r, 2) ?? '').trim();
      const nameEn = String(cell(rows, r, 3) ?? '').trim();
      if (/^0*$/.test(nameCn) && /^0*$/.test(nameEn)) continue; // zero-filled ghost rows
      out.push({
        row: r,
        id: idStr,
        nameCn, nameEn,
        gender: String(cell(rows, r, 4) ?? '').trim(),
      });
    }
    return out;
  }

  /* months from row 1 (idx 0) starting col 6 (idx 5); block = cols per month */
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

  /* ---------------- IMPORT: workbook → semester ---------------- */
  function importWorkbook(wb, opts) {
    opts = opts || {};
    const obsS = sheetRows(wb, ['observation']);
    const spS = sheetRows(wb, ['spelling']);
    const daS = sheetRows(wb, ['daily']);
    const teS = sheetRows(wb, ['test']);
    if (!obsS && !spS && !daS && !teS) throw new Error('No SPR sheets found (need Classroom Observations / Spelling / Daily Assignment / Tests).');

    /* roster: prefer Tests, then Spelling, then Observations */
    const rosterSrc = teS || spS || obsS;
    const roster = studentRows(rosterSrc.rows);
    if (!roster.length) throw new Error('No student rows found (columns: Index, ID, Chinese name, English name, Gender).');

    /* school / class from first available sheet rows 1-2 col B */
    const metaSrc = obsS || spS || daS || teS;
    const school = String(cell(metaSrc.rows, 0, 1) ?? '').trim() || 'School';
    const className = String(cell(metaSrc.rows, 1, 1) ?? '').trim() || '';

    /* months: prefer Observations sheet (8-col blocks), else Spelling (11-col blocks) */
    let months = [];
    if (obsS) months = monthBlocks(obsS.rows, 8).map((m) => m.name);
    if (!months.length && spS) months = monthBlocks(spS.rows, 11).map((m) => m.name);
    if (!months.length) months = ['September', 'October', 'November', 'December', 'January'];
    months = [...new Set(months)].sort((a, b) => acadRank(a) - acadRank(b));

    const sem = {
      id: opts.id || Util.uid('sem'),
      name: opts.name || 'Imported semester',
      school, className, months,
      students: roster.map((r) => ({ id: r.id, nameCn: r.nameCn, nameEn: r.nameEn, gender: r.gender })),
      observations: {}, spelling: {}, daily: {}, tests: {},
    };
    const sidByRow = new Map(roster.map((r) => [r.row, r.id]));

    /* observations: per month block of 8: L-LO1, L-LO2, S-LO1, … */
    if (obsS) {
      for (const mb of monthBlocks(obsS.rows, 8)) {
        for (const r of roster) {
          const vals = {};
          let any = false;
          SKILLS.forEach((sk, si) => {
            for (const lo of [1, 2]) {
              const v = numOrNull(cell(obsS.rows, r.row, mb.col + si * 2 + lo - 1));
              if (v !== null) any = true;
              vals[sk + '-LO' + lo] = v;
            }
          });
          if (any) {
            sem.observations[r.id] = sem.observations[r.id] || {};
            sem.observations[r.id][mb.name] = vals;
          }
        }
      }
    }

    /* spelling & daily: per month block of 11: 5×(score,total) + avg col */
    for (const [sh, key] of [[spS, 'spelling'], [daS, 'daily']]) {
      if (!sh) continue;
      for (const mb of monthBlocks(sh.rows, 11)) {
        for (const r of roster) {
          const weeks = {};
          let any = false;
          for (let w = 1; w <= 5; w++) {
            const s = numOrNull(cell(sh.rows, r.row, mb.col + (w - 1) * 2));
            const t = numOrNull(cell(sh.rows, r.row, mb.col + (w - 1) * 2 + 1));
            if (s !== null || t !== null) { weeks[w] = { s, t }; any = true; }
          }
          if (any) {
            sem[key][r.id] = sem[key][r.id] || {};
            sem[key][r.id][mb.name] = weeks;
          }
        }
      }
    }

    /* tests: Mid-Term F/G, Oral I/J, Written L/M → idx 5/6, 8/9, 11/12 */
    if (teS) {
      for (const r of roster) {
        const t = {};
        for (const [kind, c0] of [['midterm', 5], ['oral', 8], ['written', 11]]) {
          const s = numOrNull(cell(teS.rows, r.row, c0));
          const tt = numOrNull(cell(teS.rows, r.row, c0 + 1));
          if (s !== null || tt !== null) t[kind] = { s, t: tt };
        }
        if (Object.keys(t).length) sem.tests[r.id] = t;
      }
    }

    /* strip empty week entries (e.g. total only) */
    for (const key of ['spelling', 'daily']) {
      for (const sid of Object.keys(sem[key])) {
        for (const m of Object.keys(sem[key][sid])) {
          for (const w of Object.keys(sem[key][sid][m])) {
            const e = sem[key][sid][m][w];
            if (e.s === null && e.t === null) delete sem[key][sid][m][w];
          }
          if (!Object.keys(sem[key][sid][m]).length) delete sem[key][sid][m];
        }
        if (!Object.keys(sem[key][sid]).length) delete sem[key][sid];
      }
    }
    return sem;
  }

  /* ---------------- EXPORT: semester → workbook ---------------- */
  const CREDIT = 'Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)';
  const CREDIT_LINE = ['', '', CREDIT];
  function addCreditRow(rows) { rows.push([], CREDIT_LINE); return rows; }

  /* Hardcoded document properties (live inside the .xlsx itself, so they survive
     file renames, copies and re-saves by SheetJS). Maps to Windows Properties:
     Author → core.xml dc:creator ("Authors"), LastAuthor → cp:lastModifiedBy
     ("Last saved by"), Manager → app.xml <Manager> ("Manager"). */
  const AUTHOR = 'Mohammed Shehzad Khan (Teacher Mo)';
  function stampProps(wb, extra) {
    wb.Props = Object.assign({
      Author: AUTHOR,
      LastAuthor: AUTHOR,
      Manager: AUTHOR,
      Company: 'SPR — by Teacher Mo'
    }, extra || {});
    return wb;
  }

  function exportWorkbook(sem) {
    const wb = stampProps(XLSX.utils.book_new(), {
      Title: [sem.school, sem.className, 'SPR', sem.name].filter(Boolean).join(' - '),
      Company: sem.school || 'SPR — by Teacher Mo'
    });
    const G = (sid) => Calc.gradeStudent(sem, sid);

    /* ---- Instructions ---- */
    const insRows = Util.INSTRUCTIONS_LINES.map((l) => [l]);
    insRows.push([], ['Learning Outcomes']);
    for (const sk of SKILLS) {
      insRows.push([null, sk]);
      insRows.push(['LO1', Util.LOS[sk + '-LO1']]);
      insRows.push(['LO2', Util.LOS[sk + '-LO2']]);
    }
    insRows.push([], [CREDIT]);
    const wsIns = XLSX.utils.aoa_to_sheet(insRows);
    wsIns['!cols'] = [{ wch: 8 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(wb, wsIns, 'Instructions');

    /* ---- Classroom Observations ---- */
    const nM = sem.months.length;
    const obsHead0 = ['School', sem.school, null, null, null];
    const obsHead1 = ['Class', sem.className, null, null, null];
    const obsHead2 = [], obsHead3 = ['Index Number', 'ID Number', "Student's Name (Chinese)", "Student's Name (English)", 'Gender'];
    const merges = [];
    sem.months.forEach((m, mi) => {
      const c0 = 5 + mi * 8;
      obsHead0[c0] = m;
      merges.push({ s: { r: 0, c: c0 }, e: { r: 0, c: c0 + 7 } });
      SKILLS.forEach((sk, si) => {
        obsHead2[c0 + si * 2] = sk;
        merges.push({ s: { r: 2, c: c0 + si * 2 }, e: { r: 2, c: c0 + si * 2 + 1 } });
        obsHead3[c0 + si * 2] = 'LO1'; obsHead3[c0 + si * 2 + 1] = 'LO2';
      });
    });
    const fsCol = 5 + nM * 8; // semester final score block
    obsHead0[fsCol] = 'Semester Final Score';
    merges.push({ s: { r: 0, c: fsCol }, e: { r: 0, c: fsCol + 3 } });
    SKILLS.forEach((sk, si) => { obsHead2[fsCol + si] = sk; });
    const obsRows = [obsHead0, obsHead1, obsHead2, obsHead3];
    sem.students.forEach((s, i) => {
      const row = [i + 1, s.id, s.nameCn, s.nameEn, s.gender];
      const g = G(s.id);
      sem.months.forEach((m, mi) => {
        SKILLS.forEach((sk, si) => {
          for (const lo of [1, 2]) {
            const v = Calc.obsValue(sem, s.id, m, sk, lo);
            row[5 + mi * 8 + si * 2 + lo - 1] = v === null ? null : v;
          }
        });
      });
      SKILLS.forEach((sk, si) => { row[fsCol + si] = g.skills[sk] === null ? null : Util.r1(g.skills[sk]); });
      obsRows.push(row);
    });
    addCreditRow(obsRows);
    const wsObs = XLSX.utils.aoa_to_sheet(obsRows);
    wsObs['!merges'] = merges;
    wsObs['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 7 }];
    XLSX.utils.book_append_sheet(wb, wsObs, 'Classroom Observations');

    /* ---- Spelling & Daily Assignment ---- */
    for (const [metric, sheetName] of [['spelling', 'Spelling'], ['daily', 'Daily Assignment']]) {
      const head0 = ['School', sem.school, null, null, null];
      const head1 = ['Class', sem.className, null, null, null];
      const head2 = [], head3 = ['Index Number', 'ID Number', "Student's Name (Chinese)", "Student's Name (English)", 'Gender'];
      const mrg = [];
      sem.months.forEach((m, mi) => {
        const c0 = 5 + mi * 11;
        head0[c0] = m;
        mrg.push({ s: { r: 0, c: c0 }, e: { r: 0, c: c0 + 10 } });
        for (let w = 0; w < 5; w++) {
          head2[c0 + w * 2] = 'Week ' + (w + 1);
          mrg.push({ s: { r: 2, c: c0 + w * 2 }, e: { r: 2, c: c0 + w * 2 + 1 } });
          head3[c0 + w * 2] = 'Score'; head3[c0 + w * 2 + 1] = 'Total';
        }
        head2[c0 + 10] = 'Month Avg (%)';
        mrg.push({ s: { r: 2, c: c0 + 10 }, e: { r: 3, c: c0 + 10 } });
      });
      const fs = 5 + nM * 11;
      head0[fs] = 'Semester Final Score';
      mrg.push({ s: { r: 0, c: fs }, e: { r: 3, c: fs } });
      const rows = [head0, head1, head2, head3];
      sem.students.forEach((s, i) => {
        const row = [i + 1, s.id, s.nameCn, s.nameEn, s.gender];
        sem.months.forEach((m, mi) => {
          const c0 = 5 + mi * 11;
          for (let w = 1; w <= 5; w++) {
            const e = sem[metric][s.id] && sem[metric][s.id][m] && sem[metric][s.id][m][w];
            row[c0 + (w - 1) * 2] = e ? e.s : null;
            row[c0 + (w - 1) * 2 + 1] = e ? e.t : null;
          }
          const p = Calc.weeklyMonthPct(sem, s.id, metric, m);
          row[c0 + 10] = p === null ? null : Util.r1(p);
        });
        const sp = Calc.weeklySemesterPct(sem, s.id, metric);
        row[fs] = sp === null ? null : Util.r1(sp);
        rows.push(row);
      });
      addCreditRow(rows);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!merges'] = mrg;
      ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 7 }];
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    /* ---- Tests ---- */
    const tHead2 = [], tHead3 = ['Index Number', 'ID Number', "Student's Name (Chinese)", "Student's Name (English)", 'Gender'];
    const tMrg = [];
    [['Mid-Term', 5], ['Oral', 8], ['Written', 11]].forEach(([label, c0]) => {
      tHead2[c0] = label;
      tMrg.push({ s: { r: 2, c: c0 }, e: { r: 2, c: c0 + 2 } });
      tHead3[c0] = 'Score'; tHead3[c0 + 1] = 'Total'; tHead3[c0 + 2] = '%';
    });
    const tRows = [['School', sem.school], ['Class', sem.className], tHead2, tHead3];
    sem.students.forEach((s, i) => {
      const row = [i + 1, s.id, s.nameCn, s.nameEn, s.gender];
      [['midterm', 5], ['oral', 8], ['written', 11]].forEach(([kind, c0]) => {
        const t = sem.tests[s.id] && sem.tests[s.id][kind];
        row[c0] = t ? t.s : null;
        row[c0 + 1] = t ? t.t : null;
        const p = Calc.testPct(sem, s.id, kind);
        row[c0 + 2] = p === null ? null : Math.round(p);
      });
      tRows.push(row);
    });
    addCreditRow(tRows);
    const wsT = XLSX.utils.aoa_to_sheet(tRows);
    wsT['!merges'] = tMrg;
    wsT['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 7 }];
    XLSX.utils.book_append_sheet(wb, wsT, 'Tests');

    /* ---- Grading ---- */
    const gHead = ['Index Number', 'ID Number', "Student's Name (Chinese)", "Student's Name (English)", 'Gender',
      'Listening', 'Speaking', 'Writing', 'Reading', 'Spelling', 'Daily Assignments',
      'Mid-Term', 'Oral', 'Written', 'Final Score', 'Final Grade', 'Assessed'];
    const gRows = [['School', sem.school], ['Class', sem.className], [], gHead];
    sem.students.forEach((s, i) => {
      const g = G(s.id);
      const n = Calc.assessedCount(g);                    /* completeness gate */
      const ok = n >= Calc.FINAL_MIN_ASSESSED;
      const L = (p) => (p === null ? '—' : Calc.letter(p)); /* ungraded is not a U */
      gRows.push([i + 1, s.id, s.nameCn, s.nameEn, s.gender,
        L(g.skills.Listening), L(g.skills.Speaking), L(g.skills.Writing), L(g.skills.Reading),
        L(g.spelling), L(g.daily), L(g.midterm), L(g.oral), L(g.written),
        ok ? Util.r2(g.final) : null,
        ok ? g.letter : null,
        n + '/9' + (n >= Calc.FINAL_MIN_ASSESSED && n < 9 ? ' (provisional)' : '')]);
    });
    addCreditRow(gRows);
    const wsG = XLSX.utils.aoa_to_sheet(gRows);
    wsG['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 7 }];
    XLSX.utils.book_append_sheet(wb, wsG, 'Grading');

    return wb;
  }

  /* ---------------- REPORT CARD: single student → formatted sheet ---------------- */
  function exportReportCard(sem, sid, analysis) {
    const stu = sem.students.find((s) => s.id === sid);
    if (!stu) throw new Error('Student not found: ' + sid);
    const g = Calc.gradeStudent(sem, sid);
    const sw = analysis ? analysis.swot({ semesters: [sem] }, sid) : null;
    const L = (p) => (p === null ? '—' : Calc.letter(p));
    const P = (p) => (p === null ? '—' : Math.round(p * 10) / 10 + '%');

    const rows = [
      [sem.school.toUpperCase() + ' — STUDENT PERFORMANCE REPORT CARD'],
      ['Class: ' + sem.className + '    Semester: ' + sem.name],
      [],
      ['Student Name', stu.nameEn || '', stu.nameCn || ''],
      ['Student ID', stu.id, stu.gender || ''],
      [],
      ['COMPONENT', 'SCORE', 'GRADE', 'WEIGHT', 'CONTRIBUTION'],
    ];
    const parts = [
      ['Listening', g.skills.Listening], ['Speaking', g.skills.Speaking],
      ['Writing', g.skills.Writing], ['Reading', g.skills.Reading],
      ['Spelling', g.spelling], ['Daily Assignments', g.daily],
      ['Mid-Term', g.midterm], ['Oral', g.oral], ['Written', g.written],
    ];
    for (const [name, val] of parts) {
      const w = name === 'Written' ? 20 : 10;
      rows.push([name, P(val), L(val), w + '%', val === null ? '—' : (Math.round(val * w) / 100).toFixed(2)]);
    }
    const nAssessed = Calc.assessedCount(g);
    const ok = nAssessed >= Calc.FINAL_MIN_ASSESSED;
    /* assessment status line (parent language, no RAG/rank in exports) */
    rows.push(['ASSESSMENT STATUS', ok
      ? (nAssessed >= 9 ? 'Final assessment complete' : 'Provisional — ' + nAssessed + ' of 9 components assessed')
      : 'Not yet assessed — ' + nAssessed + ' of 9 components assessed', '', '', '']);
    if (ok) {
      rows.push(['OVERALL', Math.round(g.final * 10) / 10 + '%' + (nAssessed < 9 ? ' (provisional)' : ''), g.letter, '', '']);
    } else {
      rows.push(['', 'Final grades appear when at least 6 of 9 grading components have recorded assessment data.', '', '', '']);
    }
    rows.push([]);

    /* child-centred sections — teacher-edited wording (sem.reportNotes) wins */
    const notes = (sem.reportNotes || {})[sid] || {};
    const sections = analysis && analysis.reportSections ? analysis.reportSections(sem, sid) : null;
    if (sections) {
      const take = (field, generated) => (notes[field] !== undefined && notes[field] !== '' ? [notes[field]] : generated);
      rows.push(['STRENGTHS']);
      take('strengths', (sections.strengths || []).map((x) => x.text + (x.evidence ? ' (' + x.evidence + ')' : ''))).forEach((x) => rows.push(['  • ' + x]));
      if (!sections.strengths || !sections.strengths.length) rows.push(['  • Not enough assessed work yet to identify a reliable strength.']);
      rows.push([]);
      rows.push(['NEXT LEARNING STEPS']);
      take('steps', (sections.steps || []).map((x) => x.text + (x.evidence ? ' (' + x.evidence + ')' : ''))).forEach((x) => rows.push(['  • ' + x]));
      if (!sections.steps || !sections.steps.length) rows.push(['  • To be added once more assessment evidence is recorded.']);
      rows.push([]);
      rows.push(['TEACHER SUPPORT']);
      rows.push([notes.support || sections.support || 'To be added once assessment is complete.']);
      rows.push([]);
      rows.push(['HOW HOME CAN HELP']);
      rows.push([notes.home || sections.home || 'Optional — added by the teacher.']);
      rows.push([]);
      rows.push(['OVERALL COMMENT']);
      rows.push([notes.overall || sections.overall || (sections.inProgress ? sections.note : '')]);
      rows.push([]);
    } else if (sw && sw.remark) {
      rows.push(['TEACHER REMARK']);
      rows.push([sw.remark]);
      rows.push([]);
    }

    rows.push(['', '', '']);
    rows.push(['Teacher Signature: ____________________', '', 'Date: ____________']);
    rows.push([]);
    rows.push([CREDIT]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 14 }];
    return ws;
  }

  /* ---------------- BATCH: all report cards → one workbook ---------------- */
  function exportAllReportCards(sem, analysis) {
    const wb = stampProps(XLSX.utils.book_new(), {
      Title: [sem.className, 'all-report-cards', sem.name].filter(Boolean).join(' - '),
      Company: sem.school || 'SPR — by Teacher Mo'
    });
    for (const s of sem.students) {
      const name = (s.nameEn || s.nameCn || s.id).replace(/[\\\/\?\*\[\]:]/g, '-');
      const ws = exportReportCard(sem, s.id, analysis);
      XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 28));
    }
    return wb;
  }

  /* ---------------- CLASS REPORT → summary sheet ---------------- */
  function exportClassReport(sem) {
    const gs = Calc.gradeAll(sem);
    const dist = Calc.gradeDistribution(sem);
    const comp = Calc.completeness(sem);
    const L = (p) => (p === null ? '—' : Calc.letter(p));
    const P = (p) => (p === null ? '—' : Math.round(p * 10) / 10 + '%');

    const rows = [
      [sem.school.toUpperCase() + ' — CLASS PERFORMANCE SUMMARY'],
      ['Class: ' + sem.className + '    Semester: ' + sem.name],
      ['Teachers: ' + (sem.teachers || []).join(', ')],
      [],
      ['CLASS STATISTICS'],
      ['Students', sem.students.length],
      ['Class Final Average', P(Calc.classFinalAvg(sem))],
      ['A* Count', dist['A*']],
      ['A Count', dist.A],
      ['B Count', dist.B],
      ['C Count', dist.C],
      ['D Count', dist.D],
      ['U Count', dist.U],
      ['Students Needing Attention', Calc.atRisk(sem).length],
      ['Observations Recorded', Math.round(comp.obs * 100) + '%'],
      ['Spelling Recorded', Math.round(comp.spelling * 100) + '%'],
      ['Daily Assignments Recorded', Math.round(comp.daily * 100) + '%'],
      ['Tests Recorded', Math.round(comp.tests * 100) + '%'],
      [],
      ['STUDENT RESULTS'],
      ['Index', 'ID', 'Name (English)', 'Name (Chinese)', 'Listen', 'Speak', 'Write', 'Read', 'Spell', 'Daily', 'Mid', 'Oral', 'Written', 'Final', 'Grade'],
    ];

    sem.students.forEach((s, i) => {
      const g = Calc.gradeStudent(sem, s.id);
      const n = Calc.assessedCount(g); /* completeness gate: never export a zero-based final */
      const ok = n >= Calc.FINAL_MIN_ASSESSED;
      rows.push([i + 1, s.id, s.nameEn || '', s.nameCn || '',
        L(g.skills.Listening), L(g.skills.Speaking), L(g.skills.Writing), L(g.skills.Reading),
        L(g.spelling), L(g.daily), L(g.midterm), L(g.oral), L(g.written),
        ok ? (Math.round(g.final * 10) / 10 + '%' + (n < 9 ? ' (provisional ' + n + '/9)' : '')) : 'Not yet assessed (' + n + '/9)',
        ok ? g.letter : null]);
    });

    rows.push([]);
    rows.push(['COMPONENT AVERAGES']);
    const components = ['Listening', 'Speaking', 'Writing', 'Reading', 'Spelling', 'Daily Assignments', 'Mid-Term', 'Oral', 'Written'];
    components.forEach((c) => {
      const avg = gs.map((g) => g.parts[c]).filter((v) => v !== null);
      rows.push([c, avg.length ? P(avg.reduce((a, b) => a + b, 0) / avg.length) : '—']);
    });

    rows.push([]);
    rows.push(['STUDENTS NEEDING ATTENTION']);
    const risk = Calc.atRisk(sem);
    if (risk.length === 0) rows.push(['All students on track']);
    risk.forEach((r) => {
      const stu = sem.students.find((s) => s.id === r.sid);
      rows.push([stu ? (stu.nameEn || stu.nameCn) : r.sid, r.reasons.join('; ')]);
    });

    rows.push([]);
    rows.push([CREDIT]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }];
    return ws;
  }

  function suggestNameFromFilename(fn, fallback) {
    const m = String(fn || '').match(/(20\d{2})[\s._-]*(fall|spring)/i);
    if (m) return m[1] + ' ' + (m[2][0].toUpperCase() + m[2].slice(1).toLowerCase());
    return fallback || 'Imported semester';
  }

  return { importWorkbook, exportWorkbook, suggestNameFromFilename, stampProps,
           exportReportCard, exportAllReportCards, exportClassReport };
});
