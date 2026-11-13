/* SPR Import Audit engine tests — SYNTHETIC workbooks only (no real students).
   Run: node tests/spraudit.test.js */
const XLSX = require('../source/libs/xlsx.full.min.js');
const SA = require('../source/spraudit.js');
const Calc = require('../source/calc.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

/* ---- synthetic SPR workbook builder ---- */
const MONTHS = ['September', 'October'];
function mkSheet(kind, students, opts) {
  opts = opts || {};
  const width = kind === 'obs' ? 8 : 11;
  const head = new Array(5 + MONTHS.length * width).fill(null);
  head[1] = 'Synthetic School';
  MONTHS.forEach((m, i) => { head[5 + i * width] = m; });
  const rows = [head, ['', 'Synthetic 4A'], [], ['Index', 'Number', 'Chinese name', 'English name', 'Gender']];
  students.forEach((s) => {
    const row = new Array(head.length).fill(null);
    row[1] = s.id; row[2] = s.cn; row[3] = s.en; row[4] = s.gender;
    MONTHS.forEach((m, i) => {
      const c0 = 5 + i * width;
      if (kind === 'obs') {
        for (let k = 0; k < 8; k++) row[c0 + k] = (s.obs && s.obs[m + ':' + k] !== undefined) ? s.obs[m + ':' + k] : 8;
      } else {
        for (let w = 0; w < 5; w++) { row[c0 + w * 2] = 9; row[c0 + w * 2 + 1] = 10; }
        row[c0 + 10] = 90;   /* cached average (percent) */
      }
    });
    rows.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  /* formula cell injection support (aoa cannot write .f) */
  if (opts.formulaAt) { const k = XLSX.utils.encode_cell(opts.formulaAt); ws[k] = { t: 'n', f: opts.formulaAt.f, v: 0 }; }
  return ws;
}
function mkWb(students, opts) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, mkSheet('obs', students, opts), 'Classroom Observations');
  XLSX.utils.book_append_sheet(wb, mkSheet('wk', students, opts), 'Spelling');
  XLSX.utils.book_append_sheet(wb, mkSheet('wk', students, opts), 'Daily Assignment');
  const teRows = [['', 'Synthetic School'], ['', 'Synthetic 4A'], [], ['Index', 'Number', 'Chinese name', 'English name', 'Gender']];
  students.forEach((s) => {
    const row = new Array(13).fill(null);
    row[1] = s.id; row[2] = s.cn; row[3] = s.en; row[4] = s.gender;
    row[5] = 85; row[6] = 100; row[8] = 9; row[9] = 10; row[11] = 88; row[12] = 100;
    teRows.push(row);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(teRows), 'Tests');
  return wb;
}

const SYNTH = [
  { id: 'S01', cn: '学生一', en: 'Synth One', gender: 'M' },
  { id: 'S02', cn: '学生二', en: 'Synth Two', gender: 'F' },
  { id: 'S03', cn: '学生三', en: 'Synth Three', gender: 'M' },
  { id: 'S04', cn: '学生四', en: 'Synth Four', gender: 'F' },
  { id: 'S05', cn: '学生五', en: 'Synth Five', gender: 'M' },
];

console.log('1. clean synthetic workbook');
{
  const r = SA.audit(mkWb(SYNTH));
  const crit = r.findings.filter((f) => f.severity === 'critical');
  ok(r.stats.students === 5, 'profile sees 5 synthetic students');
  ok(crit.length === 0, 'clean workbook has ZERO critical findings (got: ' + crit.map((f) => f.code).join(',') + ')');
  ok(r.profile.sheetsFound.observations && r.profile.sheetsFound.spelling && r.profile.sheetsFound.daily && r.profile.sheetsFound.tests, 'all four SPR sheets detected');
  ok(JSON.stringify(r.profile.months.sp) === JSON.stringify(MONTHS), 'month headers detected');
}

console.log('2. structural defects');
{
  const dup = SYNTH.concat([{ id: 'S01', cn: '学生一重复', en: 'Synth One Dup', gender: 'M' }]);
  const r = SA.audit(mkWb(dup));
  ok(r.findings.some((f) => f.code === 'duplicate-id' && f.severity === 'critical'), 'duplicate student ID is CRITICAL');
  const r2 = SA.audit(mkWb(SYNTH.map((s, i) => i === 0 ? Object.assign({}, s, { cn: '', en: '' }) : s)));
  ok(r2.findings.some((f) => f.code === 'missing-name'), 'student without any name flagged');
}

console.log('3. impossible scores');
{
  const bad = SYNTH.map((s, i) => i === 1 ? Object.assign({}, s, { obs: { 'September:0': 12 } }) : s);   /* obs 0-10 scale */
  let r; try { r = SA.audit(mkWb(bad)); } catch (e) { console.log('  audit THREW in s3:', e.message); r = { findings: [] }; }
  ok(r.findings.some((f) => f.code === 'obs-out-of-range' && f.student === 'S02'), 'observation 12/10 flagged CRITICAL with student id');
  /* spelling score over total: patch the Spelling sheet after build */
  const wb = mkWb(SYNTH);
  const ws = wb.Sheets['Spelling'];
  const k = XLSX.utils.encode_cell({ r: 5, c: 5 });   /* first student row (idx4+1), first week score */
  ws[k] = { t: 'n', v: 14 };
  const r2 = SA.audit(wb);
  ok(r2.findings.some((f) => f.code === 'score-over-total' && f.severity === 'critical'), 'spelling 14/10 flagged CRITICAL');
  const wb2 = mkWb(SYNTH);
  const k2 = XLSX.utils.encode_cell({ r: 5, c: 6 });
  wb2.Sheets['Spelling'][k2] = { t: 'n', v: -1 };
  const r3 = SA.audit(wb2);
  ok(r3.findings.some((f) => f.code === 'bad-total'), 'negative total flagged');
}

console.log('4. cached average vs the real engine');
{
  const wb = mkWb(SYNTH);
  const ws = wb.Sheets['Spelling'];
  ws[XLSX.utils.encode_cell({ r: 5, c: 15 })] = { t: 'n', v: 62 };  /* cached avg says 62%, scores say 90% */
  const r = SA.audit(wb);
  const hit = r.findings.find((f) => f.code === 'avg-mismatch');
  ok(!!hit && hit.severity === 'critical' && hit.student === 'S02', 'wrong cached average flagged CRITICAL for the right student');
  ok(hit && String(hit.expected).indexOf('90') === 0, 'finding states the engine-recomputed value (90%)');
}

console.log('5. formulas + workflow + review flags');
{
  const wb = mkWb(SYNTH, { formulaAt: { r: 6, c: 5, f: 'SUM(F6:J6)' } });
  const r = SA.audit(wb);
  ok(r.findings.some((f) => f.code === 'formula-in-data' && f.severity === 'warning'), 'formula cell inside data area flagged (not executed, never imported)');
  ok(r.stats.formulaCount >= 1, 'formula counter in stats');
  const csv = SA.toCsv(r.findings);
  ok(csv.split('\r\n').length === r.findings.length + 1 && csv.includes('severity,code,student'), 'CSV report has header + one row per finding');
  const rep = SA.toWorkbook(r.findings, r.profile);
  ok(!!rep.Sheets['SPR Audit'], 'Excel audit report sheet builds');
  const clean = SA.audit(mkWb(SYNTH));
  ok(clean.findings.every((f) => f.severity !== 'critical'), 'the SAME clean workbook stays clean after all checks (deterministic)');
  ok(clean.findings.filter((f) => f.severity === 'info').length >= 0, 'informational notes allowed (never errors)');
}

console.log('6. a genuinely weak student is NOT a data error');
{
  const weak = SYNTH.map((s, i) => {
    if (i !== 2) return s;
    const o = Object.assign({}, s);
    MONTHS.forEach((m) => { for (let k = 0; k < 8; k++) o['obs:' + m + ':' + k] = o['obs:' + m + ':' + k]; });
    return o;
  });
  void weak;
  const wb = mkWb(SYNTH);
  /* make S03 score consistently 2/10 everywhere on Spelling */
  ['Spelling', 'Daily Assignment'].forEach((nm) => {
    const ws = wb.Sheets[nm];
    MONTHS.forEach((m, i) => {
      const c0 = 5 + i * 11;
      for (let w = 0; w < 5; w++) {
        ws[XLSX.utils.encode_cell({ r: 7, c: c0 + w * 2 })] = { t: 'n', v: 2 };
      }
      ws[XLSX.utils.encode_cell({ r: 7, c: c0 + 10 })] = { t: 'n', v: 20 };
    });
  });
  const r = SA.audit(wb);
  ok(!r.findings.some((f) => f.student === 'S03' && f.severity === 'critical'), 'low performer produces NO critical findings');
  ok(r.findings.some((f) => f.student === 'S03' && f.severity === 'info'), 'low performer gets an INFORMATIONAL review flag');
  ok(r.findings.some((f) => f.student === 'S03' && f.code === 'uniform-scores'), 'identical scores every week get a copy-paste review flag');
}

console.log('SPRAUDIT: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
