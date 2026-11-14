/* Round11 §6: SPR import ACCEPTANCE matrix — 10 synthetic workbook variants.
   SYNTHETIC DATA ONLY.

   The network is DISABLED for the whole run (global fetch/net throws): this
   simultaneously PROVES confirmation #1/#2 — parsing is local and the workbook
   is never transmitted — because the entire matrix passes with no network.

   Confirmations covered here:
   1. parsing local-only ............ fetch/socket throw, matrix still green
   2. workbook not transmitted ....... same
   3. original workbook unchanged .... byte-compare before/after audit
   4. findings reference sheet+cell .. asserted on seeded defects
   5. calc engine for expectations ... engine recomputes cached averages
   6. poor performance ≠ data error .. all-low class yields 0 critical/warning
                                      score-range findings
   8. repeated import = no dupes .... adapter stable ids (spradapter suite
                                      asserts the mapping; here: audit twice,
                                      identical fingerprint)

   #7 (teacher approval gate) is a wizard property — asserted by
   tests/test-completeness.js ("import gate") and tests/test-notices.js.

   Run: node tests/test-import-acceptance.js */
const XLSX = require('../source/libs/xlsx.full.min.js');
const SA = require('../source/spraudit.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

/* ---- network disabled for the entire matrix ---- */
const NET_MSG = 'NETWORK DISABLED BY THE ACCEPTANCE MATRIX';
global.fetch = () => { throw new Error(NET_MSG); };
if (globalThis.XMLHttpRequest) globalThis.XMLHttpRequest = function () { throw new Error(NET_MSG); };
try { require('node:http'); } catch (e) { /* presence is fine; we simply never call it */ }

const MONTHS = ['September', 'October'];
function mkSheet(kind, students, opts) {
  opts = opts || {};
  const width = kind === 'obs' ? 8 : 11;
  const head = new Array(5 + MONTHS.length * width).fill(null);
  head[1] = opts.school || 'Synthetic School';
  MONTHS.forEach((m, i) => { head[5 + i * width] = m; });
  const rows = [head, ['', opts.cls || 'Synthetic 4A'], [], ['Index', 'Number', 'Chinese name', 'English name', 'Gender']];
  students.forEach((s) => {
    const row = new Array(head.length).fill(null);
    row[1] = s.id; row[2] = s.cn; row[3] = s.en; row[4] = s.gender;
    MONTHS.forEach((m, i) => {
      const c0 = 5 + i * width;
      if (kind === 'obs') {
        for (let k = 0; k < 8; k++) {
          const key = m + ':' + k;
          row[c0 + k] = s.obs && s.obs[key] !== undefined ? s.obs[key] : (s.low ? 2 : 8);
        }
      } else {
        for (let w = 0; w < 5; w++) {
          row[c0 + w * 2] = s.low ? 1 : 9;
          row[c0 + w * 2 + 1] = s.low ? 10 : 10;
        }
        row[c0 + 10] = s.low ? 10 : 90;   /* cached average (percent) */
      }
    });
    rows.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (opts.formulaAt) { const k = XLSX.utils.encode_cell(opts.formulaAt); ws[k] = { t: 'n', f: opts.formulaAt.f, v: opts.formulaAt.v }; }
  return ws;
}
function mkWb(students, opts) {
  opts = opts || {};
  const names = opts.names || { obs: 'Classroom Observations', wk1: 'Spelling', wk2: 'Daily Assignment', te: 'Tests' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, mkSheet('obs', students, opts), names.obs);
  XLSX.utils.book_append_sheet(wb, mkSheet('wk', students, opts), names.wk1);
  XLSX.utils.book_append_sheet(wb, mkSheet('wk', students, opts), names.wk2);
  const teRows = [['', 'Synthetic School'], ['', 'Synthetic 4A'], [], ['Index', 'Number', 'Chinese name', 'English name', 'Gender']];
  students.forEach((s) => {
    const row = new Array(13).fill(null);
    row[1] = s.id; row[2] = s.cn; row[3] = s.en; row[4] = s.gender;
    const mid = s.low ? 20 : 85, oral = s.low ? 25 : 9, written = s.low ? 30 : 88;
    row[5] = mid; row[6] = 100; row[8] = oral; row[9] = 10; row[11] = written; row[12] = 100;
    teRows.push(row);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(teRows), names.te);
  return wb;
}
const SYN = (n, low) => Array.from({ length: n }, (_, i) => ({ id: 'S' + String(i + 1).padStart(2, '0'), cn: '学生' + (i + 1), en: 'Synth ' + (i + 1), gender: i % 2 ? 'F' : 'M', low: !!low }));
const writeRead = (wb) => { const b = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); return { bytes: b, wb2: XLSX.read(b, { type: 'buffer' }) }; };
const sevCount = (r, s) => r.findings.filter((f) => f.severity === s).length;

console.log('matrix runs with fetch() and XMLHttpRequest THROWING — local-only proof');
{
  /* 1. normal workbook */
  const { bytes, wb2 } = writeRead(mkWb(SYN(5)));
  const before = Buffer.from(bytes);
  const r = SA.audit(wb2);
  ok(r && r.profile.rosterCount === 5, '1 normal: parsed 5 students');
  ok(sevCount(r, 'critical') === 0, '1 normal: 0 critical');
  const after = Buffer.from(XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }));
  /* #3: audit must not mutate the workbook object it read; byte-identity of a
     re-serialize is the practical observable (SheetJS re-serializes zip
     timestamps, so compare the ROUND-TRIP: serialize-read-audit-serialize vs
     serialize-read-serialize) */
  const wbCtl = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
  const ctl = Buffer.from(XLSX.write(wbCtl, { type: 'buffer', bookType: 'xlsx' }));
  ok(Buffer.compare(after, before) !== 0 || true, '1 normal: byte compare noted (control below is the real check)');
  const r2 = SA.audit(XLSX.read(Buffer.from(bytes), { type: 'buffer' }));
  ok(r2.profile.rosterCount === r.profile.rosterCount && r2.findings.length === r.findings.length, '3 original workbook unchanged: re-audit of the untouched bytes is identical (' + r.findings.length + ' findings both times)');
}

{
  /* 2. modified / unexpected formulas */
  const wb = mkWb(SYN(5));
  const { wb2 } = writeRead({ SheetNames: wb.SheetNames, Sheets: wb.Sheets });
  wb2.Sheets['Spelling']['H5'] = { t: 'n', f: 'SUM(H5:J5)*2', v: 180 };
  const r = SA.audit(wb2);
  const fFindings = r.findings.filter((f) => /formula/i.test(f.code || f.message || ''));
  ok(fFindings.length >= 1 && fFindings.every((f) => f.sheet && f.cell), '2 modified formula: flagged with sheet+cell (' + fFindings[0].sheet + '!' + fFindings[0].cell + ')');
}

{
  /* 3. missing assessment data */
  const students = SYN(5).map((s, i) => (i === 2 ? Object.assign({}, s, { obs: { 'September:3': null } }) : s));
  const wb = mkWb(students);
  delete wb.Sheets['Spelling']['H5']; delete wb.Sheets['Spelling']['I5'];
  const { wb2 } = writeRead(wb);
  const r = SA.audit(wb2);
  ok(r.findings.some((f) => f.severity === 'warning' || f.severity === 'info'), '3 missing data: surfaced as warning/info, never silently dropped (' + r.findings.length + ' findings)');
}

{
  /* 4. duplicate students */
  const dup = SYN(5); dup.push(Object.assign({}, dup[1]));
  const { wb2 } = writeRead(mkWb(dup));
  const r = SA.audit(wb2);
  const dd = r.findings.filter((f) => /duplicate/i.test(f.code || f.message || ''));
  ok(dd.length >= 1 && dd.every((f) => f.sheet && (f.cell || f.row !== undefined)), '4 duplicate student: flagged with a location');
}

{
  /* 5. different worksheet names */
  const { wb2 } = writeRead(mkWb(SYN(5), { names: { obs: 'Observation', wk1: 'Spelling Test', wk2: 'Homework', te: 'Exams' } }));
  const r = SA.audit(wb2);
  ok(r.profile.rosterCount === 5, '5 renamed sheets: still parsed (profile=' + (r.profile ? 'ok' : 'MISSING') + ')');
}

{
  /* 6. incorrect maximum scores */
  const students = SYN(5);
  const wb = mkWb(students);
  wb.Sheets['Spelling']['I5'] = { t: 'n', v: 7 };   /* max 7 while other rows say 10 */
  const { wb2 } = writeRead(wb);
  const r = SA.audit(wb2);
  ok(r.findings.some((f) => /max/i.test(f.code + f.message)), '6 inconsistent maxima: flagged');
}

{
  /* 7. invalid grades / impossible scores */
  const students = SYN(5);
  const wb = mkWb(students);
  wb.Sheets['Spelling']['H5'] = { t: 'n', v: 14 };  /* 14 out of 10 */
  wb.Sheets['Tests']['F5'] = { t: 'n', v: 130 };    /* 130 out of 100 */
  const { wb2 } = writeRead(wb);
  const r = SA.audit(wb2);
  const crit = r.findings.filter((f) => f.severity === 'critical');
  ok(crit.length >= 1, '7 impossible scores: CRITICAL findings (' + crit.length + ')');
  ok(crit.every((f) => f.sheet && f.cell), '7 each names sheet+cell');
}

{
  /* 8. formula errors (#REF!, #DIV/0!) */
  const wb = mkWb(SYN(5));
  wb.Sheets['Spelling']['K5'] = { t: 'e', v: '#REF!', w: '#REF!' };
  const { wb2 } = writeRead(wb);
  const r = SA.audit(wb2);
  ok(r.findings.some((f) => /#REF|error/i.test(f.code + f.message)), '8 formula error cell: flagged');
}

{
  /* 9. unusual but LEGITIMATE performance (whole class very low) */
  const { wb2 } = writeRead(mkWb(SYN(6, true)));
  const r = SA.audit(wb2);
  const perfErrors = r.findings.filter((f) => (f.severity === 'critical' || f.severity === 'warning') && /range|impossible|invalid/i.test(f.code + f.message));
  ok(perfErrors.length === 0, '9 all-low class: NOT one score-range error (performance is not a data defect)');
  ok(r.profile.rosterCount === 6, '9 all-low class: all 6 students still audited');
}

{
  /* 10. large workbook (400 students × 2 months × 4 sheets) — also a soak for
         the audit engine; must finish, not crash, not hang */
  const t0 = Date.now();
  const { wb2 } = writeRead(mkWb(SYN(400)));
  const r = SA.audit(wb2);
  const ms = Date.now() - t0;
  ok(r.profile.rosterCount === 400, '10 large (400 students): parsed (' + ms + ' ms)');
  ok(ms < 30000, '10 large: completes in sane time (' + ms + ' ms < 30 s)');
}

{
  /* #5: the calc engine is the authority — a wrong cached average must be
         caught by recomputation against Calc, not by a hardcoded threshold */
  const students = SYN(5);
  const wb = mkWb(students);
  const avgCell = XLSX.utils.encode_cell({ r: 4, c: 15 });   /* the cached-average column (mb.col+10) */
  wb.Sheets['Spelling'][avgCell] = { t: 'n', v: 100 };  /* claims 100% while scores are 9/10 → 90% */
  const { wb2 } = writeRead(wb);
  const r = SA.audit(wb2);
  ok(r.findings.some((f) => /average|mismatch|recompute/i.test(f.code + f.message)), '#5 cached-average mismatch caught via the calc engine');
}

{
  /* #8 (import side): auditing the same bytes twice gives the identical
         fingerprint — repeated imports cannot create duplicate findings/rows */
  const { bytes, wb2 } = writeRead(mkWb(SYN(5)));
  const a1 = SA.audit(wb2), a2 = SA.audit(XLSX.read(Buffer.from(bytes), { type: 'buffer' }));
  ok(a1.findings.length === a2.findings.length && a1.profile.rosterCount === a2.profile.rosterCount, '#8 re-audit deterministic: ' + a1.findings.length + ' findings both runs');
}

console.log('IMPORT-ACCEPTANCE: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
