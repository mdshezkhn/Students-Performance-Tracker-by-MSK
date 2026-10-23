/* Excel import validation tests (pure Node, synthetic workbook, no DOM).
   Run: node tests/excel-import.test.js
   Covers: gender normalisation (D7), teacher-name scan (D8), out-of-range
   score rejection with warnings (D5), ghost-row skipping, month detection,
   and export -> import round-trip stability. */
const EB = require('../source/excel.js');
const Calc = require('../source/calc.js');
const XLSX = require('../source/libs/xlsx.full.min.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log('FAIL', label, '\n  expected:', e, '\n  actual:  ', a); }
}
function ok(v, label) { if (v) pass++; else { fail++; console.log('FAIL', label); } }

/* ---------- build a synthetic SPR workbook (exported-layout clone) ---------- */
function mkWorkbook(opts) {
  opts = opts || {};
  const wb = XLSX.utils.book_new();
  const teachersRow = opts.teachersCell || ['Class', 'P4C4', null, 'Teachers', 'Mo, Lisa'];

  const obs = [
    ['Sunshine School', ...[]].slice(0, 0), // placeholder replaced below
  ];
  // Classroom Observations: months March (col5) + May (col13), 8-col blocks
  const obsRows = [];
  obsRows[0] = ['School', 'Sunshine School', null, null, null, 'March', null, null, null, null, null, null, null, 'May'];
  obsRows[1] = teachersRow.slice();
  obsRows[2] = []; obsRows[3] = ['Index Number', 'ID Number', "Student's Name (Chinese)", "Student's Name (English)", 'Gender',
    'Listening', null, 'Speaking', null, 'Writing', null, 'Reading', null,
    'Listening', null, 'Speaking', null, 'Writing', null, 'Reading', null];
  const stu = [
    ['1', 'STU-01', '学生01', 'Pupil One', '男', 8, 7, 6, 5, 9, 8, 7, 6, 7, 6, 5, 4, 8, 7, 6, 5],
    ['2', 'STU-02', '学生02', 'Pupil Two', '女', 12, 5, -1, 4, 8, 7, 6, 5, null, null, null, null, null, null, null, null],
    ['3', 'STU-03', '学生03', 'Pupil Three', 'M', 9, 9, 8, 8, 9, 9, 8, 8, 9, 9, 8, 8, 9, 9, 8, 8],
  ];
  stu.forEach((r, i) => { obsRows[4 + i] = r; });
  obsRows[4 + stu.length] = ['0', '0', '0', '0', '0', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // ghost row
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(obsRows), 'Classroom Observations');

  // Spelling + Daily Assignment: 11-col month blocks (March col5, May col16)
  for (const [sheet, key] of [['Spelling', 'sp'], ['Daily Assignment', 'da']]) {
    const rows = [];
    rows[0] = ['School', 'Sunshine School', null, null, null, 'March', null, null, null, null, null, null, null, null, null, null, 'May'];
    rows[1] = ['Class', 'P4C4'];
    rows[3] = ['Index Number', 'ID Number', "Student's Name (Chinese)", "Student's Name (English)", 'Gender'];
    const mk = (id, cn, en, g, march, may) => {
      const r = ['x', id, cn, en, g];
      for (let w = 0; w < 5; w++) { r[5 + w * 2] = march[w] ? march[w][0] : null; r[5 + w * 2 + 1] = march[w] ? march[w][1] : null; }
      for (let w = 0; w < 5; w++) { r[16 + w * 2] = may[w] ? may[w][0] : null; r[16 + w * 2 + 1] = may[w] ? may[w][1] : null; }
      return r;
    };
    if (key === 'sp') {
      rows[4] = mk('STU-01', '学生01', 'Pupil One', '男', [[18, 20], [19, 20], [null, 20]], []);
      rows[5] = mk('STU-02', '学生02', 'Pupil Two', '女', [[25, 20], [10, 20]], [[16, 20]]);
      rows[6] = mk('STU-03', '学生03', 'Pupil Three', 'M', [[20, 20], [20, 20], [20, 20], [20, 20], [20, 20]], [[20, 20]]);
    } else {
      rows[4] = mk('STU-01', '学生01', 'Pupil One', '男', [[9, 10], [8, 10]], [[10, 10]]);
      rows[5] = mk('STU-02', '学生02', 'Pupil Two', '女', [[5, 10]], [[4, 10], [6, 10]]);
      rows[6] = mk('STU-03', '学生03', 'Pupil Three', 'M', [[10, 10]], [[10, 10]]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  }

  // Tests: midterm F/G, oral I/J, written L/M
  const tRows = [];
  tRows[0] = ['School', 'Sunshine School'];
  tRows[1] = ['Class', 'P4C4'];
  tRows[3] = ['Index Number', 'ID Number', "Student's Name (Chinese)", "Student's Name (English)", 'Gender'];
  tRows[4] = ['1', 'STU-01', '学生01', 'Pupil One', '男', 40, 50, null, 30, 50, null, 45, null]; // written: score without total
  tRows[5] = ['2', 'STU-02', '学生02', 'Pupil Two', '女', 60, 50, null, 35, 50, null, 47, 50];  // midterm 60/50 -> dropped
  tRows[6] = ['3', 'STU-03', '学生03', 'Pupil Three', 'M', 45, 50, null, 45, 50, null, 48, 50];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tRows), 'Tests');
  return wb;
}

/* ---------------- import: roster, gender, months, ghost rows ---------------- */
{
  const warnings = [];
  const sem = EB.importWorkbook(mkWorkbook(), { warnings });
  eq(sem.months, ['March', 'May'], 'months detected + academic order');
  eq(sem.students.map((s) => s.id), ['STU-01', 'STU-02', 'STU-03'], 'roster parsed, ghost row skipped');
  eq(sem.students.map((s) => s.gender), ['M', 'F', 'M'], 'gender 男/女 -> M/F (D7)');
  eq(sem.teachers, ['Mo', 'Lisa'], 'teachers from labelled cell (D8)');

  /* ---------------- D5: invalid scores dropped + warned ---------------- */
  const o2 = sem.observations['STU-02'].March;
  eq(o2['Listening-LO1'], undefined, 'obs 12 not stored (D5)');
  eq(o2['Speaking-LO1'], undefined, 'obs -1 not stored (D5)');
  eq(o2['Speaking-LO2'], 4, 'valid obs neighbour kept');
  ok(warnings.some((w) => /out-of-range/.test(w) && /Pupil Two/.test(w)), 'obs warning names student');
  ok(warnings.some((w) => /impossible/.test(w) && /Spelling/.test(w)), 'spelling s>t warning');
  ok(warnings.some((w) => /impossible/.test(w) && /Tests/.test(w)), 'tests s>t warning');

  // total-only week (no score) must NOT count as a zero score
  const sp1 = sem.spelling['STU-01'].March;
  eq(sp1['3'], { s: null, t: 20 }, 'total-only week kept as marker');
  eq(Calc.weeklyMonthPct(sem, 'STU-01', 'spelling', 'March'), 92.5, 'month pct ignores total-only week (18+19 of 40)');
  // dropped s>t week leaves a total-only marker that also does not count
  eq(Calc.weeklyMonthPct(sem, 'STU-02', 'spelling', 'March'), 50, '25/20 dropped -> March = 10/20 only');
  // score without total in Tests -> no %
  eq(Calc.testPct(sem, 'STU-01', 'written'), null, 'written score-without-total -> null %');
  eq(Calc.testPct(sem, 'STU-02', 'midterm'), null, 'midterm 60/50 dropped -> null %');
  eq(Calc.testPct(sem, 'STU-02', 'oral'), 70, 'oral 35/50 -> 70%');

  /* ---------------- calc smoke on imported data ---------------- */
  const g3 = Calc.gradeStudent(sem, 'STU-03');
  eq(g3.parts.Listening, 90, 'STU-03 listening 90');
  eq(g3.parts.Spelling, 100, 'STU-03 spelling 100');
  eq(g3.letter, 'A*', 'STU-03 final letter');
}

/* ---------------- D8: teachers from a different layout ---------------- */
{
  const wb = mkWorkbook({ teachersCell: ['Class', 'P4C4', null, null, null, null, 'Class Teachers', 'An Li, Wang Wei'] });
  const sem = EB.importWorkbook(wb, {});
  eq(sem.teachers, ['An Li', 'Wang Wei'], 'teachers found by label scan in another position (D8)');
}

/* ---------------- round trip: export -> import keeps the numbers ---------------- */
{
  const sem1 = EB.importWorkbook(mkWorkbook(), {});
  const wb2 = EB.exportWorkbook(sem1);
  const sem2 = EB.importWorkbook(wb2, {});
  const g1 = Calc.gradeStudent(sem1, 'STU-01'), g2 = Calc.gradeStudent(sem2, 'STU-01');
  eq(g2.final, g1.final, 'round-trip final equal');
  eq(g2.parts, g1.parts, 'round-trip components equal');
  eq(sem2.students.map((s) => s.gender), ['M', 'F', 'M'], 'round-trip gender stays M/F');
  eq(sem2.months, sem1.months, 'round-trip months');
}

console.log(fail ? ('\n' + fail + ' FAILED, ' + pass + ' passed') : ('\n' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
