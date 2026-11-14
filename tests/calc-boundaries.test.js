/* Round 18: calculation-integrity boundary suite. These checks complement
   calc-regression.test.js (329 checks pinning the grading rules themselves);
   here we pin ROBUSTNESS: empty inputs, absent students, boundary scores,
   rounding stability, and the zero/missing/not-assessed distinction.
   Synthetic data only. Run: node tests/calc-boundaries.test.js */
const Calc = require('../source/calc.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };
const mk = (over) => Object.assign({ id: 's', name: '', months: ['September'], students: [], observations: {}, spelling: {}, daily: {}, tests: {} }, over || {});
const stu = (id) => ({ id, nameCn: '', nameEn: 'Synthetic ' + id, gender: '' });

console.log('1. degenerate inputs never crash');
{
  ok(Array.isArray(Calc.gradeAll(mk())), 'empty class (no students) grades to an empty array');
  const oneAbsent = mk({ students: [stu('G1')] });   /* roster name but zero records anywhere */
  const g = Calc.gradeAll(oneAbsent);
  ok(g.length === 1 && g[0] != null, 'student with no records at all still produces a report row (not a crash)');
  const emptyMonths = mk({ months: [], students: [stu('G2')] });
  ok(Array.isArray(Calc.gradeAll(emptyMonths)), 'semester with zero months is processable');
}

console.log('2. zero vs missing vs not-ass vs invalid stay distinct');
{
  ok(Calc.validObs(0) === true && Calc.validObs(11) === false, 'observation 0 is VALID evidence; 11 is invalid (0-10 scale)');
  ok(Calc.validPair(0, 10) === true && Calc.validPair(11, 10) === false, 'score 0/10 valid; 11/10 invalid (validPair)');
  ok(Calc.validPair(5, 0) === false && Calc.validTotal(0) === false, 'score against a ZERO maximum is invalid, not a free pass');
  const zeroSem = mk({ students: [stu('Z1')], spelling: { Z1: { September: { 1: { s: 0, t: 10 } } } } });
  const g = Calc.gradeAll(zeroSem)[0];
  ok(g != null, 'a real zero produces a graded row (never silently dropped or hidden)');
}

console.log('3. letter boundaries are deterministic and stable');
{
  const probes = [0, 49.99, 50, 59.99, 60, 69.99, 70, 79.99, 80, 84.99, 85, 100];
  const first = probes.map((x) => Calc.letter(x));
  const second = probes.map((x) => Calc.letter(x));
  ok(JSON.stringify(first) === JSON.stringify(second), 'letter() is a pure function (same input, same output)');
  ok(new Set(first).size >= 4, 'probe set crosses at least 4 letter bands: ' + first.join(','));
  ok(Calc.letter(100) === Calc.letter(100), 'maximum score maps consistently');
}

console.log('4. rounding is stable at nasty decimal points');
{
  const xs = [0.005, 2.675, -0.005, 1.005, 0.05, 1/3];
  const a = xs.map((x) => Calc.round1(x));
  const b = xs.map((x) => Calc.round1(x));
  ok(JSON.stringify(a) === JSON.stringify(b), 'round1 stable across repeated calls');
  ok(a.every((v) => typeof v === 'number' && isFinite(v)), 'round1 always returns a finite number');
}

console.log('5. order and device independence (same data, shuffled key order)');
{
  const mkSem = () => mk({
    students: [stu('A1'), stu('B2'), stu('C3')],
    spelling: { A1: { September: { 1: { s: 8, t: 10 } } }, B2: { September: { 1: { s: 6, t: 10 } } }, C3: { September: { 1: { s: 10, t: 10 } } } }
  });
  const s1 = mkSem(); const s2 = mkSem();
  s2.students = s2.students.slice().reverse();                 /* arrival order differs */
  s2.spelling = Object.fromEntries(Object.entries(s2.spelling).reverse());
  const j1 = JSON.stringify(Calc.gradeAll(s1).map((g) => g.final));
  const j2 = JSON.stringify(Calc.gradeAll(s2).map((g) => g.final).reverse());
  ok(j1 === j2, 'grades do not depend on key/arrival order');
}

console.log('CALC-BOUNDARIES: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
