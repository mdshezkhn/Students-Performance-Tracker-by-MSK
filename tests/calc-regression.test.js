/* Calc regression suite (pure Node, synthetic fixture — no real students).
   Run: node tests/calc-regression.test.js

   tests/fixtures/calc-fixture.json holds a 23-pupil class plus expected
   parts/finals/letters/gates computed by an INDEPENDENT implementation of
   the workbook rules (tests/fixtures/generate_expected.py, Python). This
   test asserts source/calc.js agrees with that second implementation —
   a real cross-check, not calc verifying itself. */
const fs = require('fs');
const path = require('path');
const Calc = require('../source/calc.js');

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'calc-fixture.json'), 'utf8'));
if (!/SYNTHETIC/.test(fx.meta)) { console.log('FAIL fixture is not marked synthetic'); process.exit(1); }
const sem = fx.semester;

let pass = 0, fail = 0;
function ok(v, label) { if (v) pass++; else { fail++; console.log('FAIL', label); } }
function close(a, b, label) {
  const d = Math.abs(a - b);
  if (d < 1e-9) pass++;
  else { fail++; console.log('FAIL', label, '— expected', b, 'got', a, '(delta ' + d + ')'); }
}
function eqDeep(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log('FAIL', label, '\n  expected:', e, '\n  actual:  ', a); }
}

/* ---- every pupil: parts, gate, final, letter vs the Python engine ---- */
for (const [sid, exp] of Object.entries(fx.expected)) {
  const g = Calc.gradeStudent(sem, sid);
  for (const [k, v] of Object.entries(exp.parts)) {
    if (v === null) ok(g.parts[k] == null, sid + ' ' + k + ' missing');
    else close(g.parts[k], v, sid + ' ' + k);
  }
  close(g.final, exp.final, sid + ' final');
  /* gradeStudent().letter is ungated by design; the 6-of-9 gate is applied
     by callers (distribution below, exports, UI) — verified separately */
  const wantLetter = exp.letter !== null ? exp.letter : Calc.letter(exp.final);
  ok(g.letter === wantLetter, sid + ' letter ' + g.letter + ' (expected ' + wantLetter + ')');
  const c = Calc.getAssessmentCompleteness(sem, sid);
  ok(c.assessedComponentCount === exp.assessed, sid + ' assessed ' + c.assessedComponentCount + ' != ' + exp.assessed);
  ok(c.gate === exp.gate, sid + ' gate ' + c.gate + ' != ' + exp.gate);
}

/* ---- class aggregates ---- */
close(Calc.classFinalAvg(sem), fx.expectedClass.finalAvg, 'class final average');
eqDeep(Calc.gradeDistribution(sem), fx.expectedClass.distribution, 'grade distribution');

/* ---- letter boundaries, exactly as the Excel IF-chain reads them ---- */
const L = Calc.letter;
ok(L(100) === 'A*' && L(85) === 'A*' && L(84.5) === 'A*' && L(84.001) === 'A*', 'A* band >84');
ok(L(84) === 'A' && L(75) === 'A' && L(74.001) === 'A', 'A band 74<x<=84');
ok(L(74) === 'B' && L(65) === 'B' && L(64.001) === 'B', 'B band 64<x<=74');
ok(L(64) === 'C' && L(55) === 'C' && L(54.001) === 'C', 'C band 54<x<=64');
ok(L(54) === 'D' && L(50) === 'D' && L(49.001) === 'D', 'D band 49<x<=54');
ok(L(49) === 'U' && L(0) === 'U', 'U band <=49');
ok(L(null) === null && L(NaN) === null && L(undefined) === null, 'letter(null/NaN)');

/* ---- weights: Written 20%, others 10% — locked ---- */
{
  const g = Calc.gradeStudent(sem, 'P01');   // every component exactly 90
  close(g.final, 90, 'uniform-90 final is 90 (weights sum to 1)');
}

/* ---- D5 gates: invalid stored values never count (legacy data) ---- */
{
  const bad = { months: ['March'], students: [{ id: 'x' }],
    observations: { x: { March: { 'Listening-LO1': 12, 'Speaking-LO1': -1, 'Writing-LO1': 8.5 } } },
    spelling: { x: { March: { 1: { s: 25, t: 20 }, 2: { s: 18, t: 20 }, 3: { s: null, t: 20 } } } },
    daily: {}, tests: { x: { midterm: { s: 60, t: 50 }, oral: { s: null, t: 50 }, written: { s: 90, t: 100 } } } };
  const g = Calc.gradeStudent(bad, 'x');
  ok(g.parts.Listening === null, 'obs 12 ignored');
  ok(g.parts.Speaking === null, 'obs -1 ignored');
  close(g.parts.Writing, 85, 'obs 8.5 kept');
  close(g.parts.Spelling, 90, 'spelling: 18/20 only (25/20 and total-only ignored)');
  ok(g.parts['Mid-Term'] === null, 'test 60/50 ignored');
  ok(g.parts.Oral === null, 'total-only test ignored (NOT a zero)');
  close(g.parts.Written, 90, 'valid test kept');
  eqDeep(Calc.weeklyPctList(bad, 'x', 'spelling'), [{ label: 'Mar W1', pct: null }, { label: 'Mar W2', pct: 90 }, { label: 'Mar W3', pct: null }],
    'weeklyPctList invalid weeks -> null pct');

  const dropped = Calc.sanitizeSemester(bad);
  ok(dropped.length === 4, 'sanitize quarantines 4 invalid values (got ' + dropped.length + ')');
  ok(dropped.every((m) => typeof m.reason === 'string' && m.value !== undefined), 'each quarantined value carries value + reason');
  ok(dropped.some((m) => m.area === 'obs' && m.key === 'Listening-LO1' && m.value === 12), 'obs over-range recorded with cell key');
  ok(dropped.some((m) => m.area === 'spelling' && m.key === 'week 1:s' && m.value === 25), 'weekly over-total recorded');
  const again = Calc.sanitizeSemester(bad);
  ok(again.length === 0, 'second sanitize run moves nothing (idempotent)');
  ok(bad.observations.x.March['Listening-LO1'] === undefined, 'sanitize removed obs 12');
  ok(bad.spelling.x.March[1].s === null && bad.spelling.x.March[1].t === 20, 'sanitize kept the total, cleared the 25');
  ok(bad.tests.x.midterm.s === null && bad.tests.x.midterm.t === 50, 'sanitize kept midterm total');
  ok(Calc.validObs(0) && Calc.validObs(10) && !Calc.validObs(10.01) && !Calc.validObs(-0.5), 'validObs edges');
  ok(Calc.validPair(0, 1) && Calc.validPair(1, 1) && !Calc.validPair(1.01, 1) && !Calc.validPair(1, 0), 'validPair edges');
}

/* ---- zero is real evidence, never "missing" (P11: all zeros) ---- */
{
  const c = Calc.getAssessmentCompleteness(sem, 'P11');
  ok(c.assessedComponentCount === 9 && c.gate === 'final', 'zero-filled pupil is fully assessed');
  ok(Calc.gradeStudent(sem, 'P11').letter === 'U', 'zeros -> U (not hidden)');
}

console.log(fail ? ('\n' + fail + ' FAILED, ' + pass + ' passed') : ('\n' + pass + ' passed, 0 failed'));
process.exit(fail ? 1 : 0);
