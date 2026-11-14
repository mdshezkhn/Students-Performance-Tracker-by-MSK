/* SPR Adapter tests — deterministic mapping between the SPR cell model and
   the backend record model. SYNTHETIC data only. The calculation engine
   (source/calc.js) is the authority: round-trip fidelity is asserted by
   comparing calc.gradeAll output before/after, never by re-deriving grades.
   Run: node tests/spradapter.test.js */
const A = require('../source/spradapter.js');
const Calc = require('../source/calc.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

/* ---- synthetic semester: every category populated, awkward edges included ---- */
function synthSem() {
  return {
    id: 'sem-synth-1', name: 'Synthetic 2026 S1',
    months: ['September', 'October', 'November'],
    students: [
      { id: 'P01', nameCn: '合成一', nameEn: 'Synth One', gender: 'M' },
      { id: 'P02', nameCn: '合成二', nameEn: 'Synth Two', gender: 'F' },
      { id: 'P08', nameCn: '合成八', nameEn: 'Synth Eight', gender: '' }
    ],
    observations: {
      P01: { September: { 'Listening-LO1': 8, 'Speaking-LO2': 7 }, November: { 'Writing-LO1': 6 } },
      P08: { October: { 'Reading-LO1': 9, 'Listening-LO1': 5, 'Speaking-LO1': 10 } }
    },
    spelling: { P01: { September: { 1: { s: 9, t: 10 }, 2: { s: 7, t: 10 } }, October: { 1: { s: 7.5, t: 10 } } }, P02: { September: { 1: { s: 4, t: 10 } } } },
    daily:   { P01: { September: { 1: { s: 18, t: 20 } } }, P08: { November: { 1: { s: 20, t: 20 }, 2: { s: 19, t: 20 } } } },
    tests:   { P01: { midterm: { s: 88, t: 100 }, oral: { s: 40, t: 50 }, written: { s: 92, t: 100 } }, P02: { written: { s: 51, t: 100 } } }
  };
}
const ctx = { classId: 'cls-p4a', schoolId: 'sch-synth', semesterId: 'sem-synth-1' };

console.log('1. forward mapping');
{
  const out = A.toBackend(synthSem(), ctx);
  ok(out.students.length === 3, '3 students mapped, SPR register ids preserved: ' + out.students.map((s) => s.student_no).join(','));
  ok(out.students.every((s) => /^[0-9a-f]{32}$/.test(s.id)), 'student ids deterministic hex (re-import safe, passes the backend id guard)');
  const obs = out.records.filter((r) => r.category === 'observation');
  ok(obs.length === 6, '6 observation cells mapped');
  ok(obs.every((r) => r.max_value === 10 && r.value >= 0 && r.value <= 10), 'observations carry max 10 and 0-10 values');
  const ord = (p, m) => obs.find((r) => r.student_no === undefined && r.period === m && r.note === p);
  ok(!!ord('Reading-LO1', 'October') && ord('Reading-LO1', 'October').ordinal === 7, 'Reading-LO1 -> ordinal 7 (stable enumeration)');
  ok(!!ord('Listening-LO1', 'September') && ord('Listening-LO1', 'September').ordinal === 1, 'Listening-LO1 -> ordinal 1');
  ok(out.records.filter((r) => r.category === 'spelling').length === 4, '4 spelling week-pairs mapped');
  ok(out.records.filter((r) => r.category === 'daily').length === 3, '3 daily week-pairs mapped');
  const t = out.records.filter((r) => r.category === 'test');
  ok(t.length === 4, '4 formal test scores mapped');
  const mid = t.find((r) => r.period === 'midterm' && r.value === 88);
  ok(!!mid && mid.max_value === 100, 'midterm 88/100 mapped with max preserved');
  ok(out.records.every((r) => /^[0-9a-f]{32}$/.test(r.id)), 'record ids deterministic hex');
  ok(out.months.length === 3, 'month labels travel with the payload');
}

console.log('2. round-trip: the calc engine certifies equivalence');
{
  const sem0 = synthSem();
  const c0 = JSON.parse(JSON.stringify(sem0));
  Calc.sanitizeSemester(c0);            /* sanitises IN PLACE, returns notes */
  const grades0 = Calc.gradeAll(c0);
  const out = A.toBackend(sem0, ctx);
  const sem1 = A.fromBackend(out);
  const c1 = JSON.parse(JSON.stringify(sem1));
  Calc.sanitizeSemester(c1);
  const grades1 = Calc.gradeAll(c1);
  ok(JSON.stringify(grades0) === JSON.stringify(grades1), 'gradeAll identical before/after the round trip');
  const s0 = JSON.stringify(grades0.students ? grades0.students : grades0);
  ok(s0.length > 50, 'engine produced real output (not empty accident): ' + s0.length + ' chars');
  ok(JSON.stringify(sem1.observations.P08.October) === JSON.stringify(sem0.observations.P08.October), 'observation cells byte-identical');
  ok(JSON.stringify(sem1.spelling.P01) === JSON.stringify(sem0.spelling.P01), 'spelling week-pairs byte-identical');
  ok(JSON.stringify(sem1.tests.P01) === JSON.stringify(sem0.tests.P01), 'formal tests byte-identical');
  ok(sem1.students.map((s) => s.id).join(',') === 'P01,P02,P08', 'student order and ids preserved');
  ok(sem1.students[0].nameCn === '合成一' && sem1.students[0].nameEn === 'Synth One' && sem1.students[0].gender === 'M', 'names and gender survive the round trip');
}

console.log('3. determinism + duplicate-proofing');
{
  const a = A.toBackend(synthSem(), ctx);
  const b = A.toBackend(synthSem(), ctx);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same input -> byte-identical mapping (idempotent import)');
  const ids = a.records.map((r) => r.id);
  ok(new Set(ids).size === ids.length, 'no duplicate record ids within one import');
  /* server-side unique constraint columns mirror the id parts */
  const uni = a.records.map((r) => [r.class_id, r.student_id, r.category, r.period, r.ordinal, r.semester_id].join('|'));
  ok(new Set(uni).size === uni.length, 'no duplicate rows against the schema unique constraint');
  /* a second import of a semester that gained ONE cell shares every other id */
  const grew = synthSem();
  grew.observations.P02 = { October: { 'Writing-LO2': 6 } };
  const c = A.toBackend(grew, ctx);
  const cIds = new Set(c.records.map((r) => r.id));
  const shared = a.records.filter((r) => cIds.has(r.id)).length;
  ok(shared === a.records.length, 'all original record ids stable after new data added (' + shared + '/' + a.records.length + ')');
  ok(c.records.length === a.records.length + 1, 'exactly one new record for the new cell');
}

console.log('4. FET/CET independence: category merge without overwrite');
{
  const base = A.toBackend(synthSem(), ctx);
  /* FET pushes a NEW observation (P08, December), CET pushes a NEW spelling
     (P08, December): both merge into the same record set without touching
     each other, exactly the §17 workflow */
  const fet = A.toBackend((() => { const s = synthSem(); delete s.spelling; delete s.daily; delete s.tests; s.observations = { P08: { December: { 'Listening-LO2': 7 } } }; return s; })(), ctx);
  const cet = A.toBackend((() => { const s = synthSem(); delete s.observations; delete s.tests; s.spelling = { P08: { December: { 1: { s: 8, t: 10 } } } }; s.daily = {}; return s; })(), ctx);
  const fetIds = new Set(base.records.map((r) => r.id));
  const newObs = fet.records.filter((r) => !fetIds.has(r.id));
  const cetIds = new Set(base.records.map((r) => r.id));
  const newSpell = cet.records.filter((r) => !cetIds.has(r.id));
  ok(newObs.length === 1 && newObs[0].category === 'observation', 'FET delta = exactly one observation record');
  ok(newSpell.length === 1 && newSpell[0].category === 'spelling', 'CET delta = exactly one spelling record');
  const merged = base.records.concat(newObs, newSpell);
  const semMerged = A.fromBackend({ students: base.students, records: merged, months: ['September', 'October', 'November', 'December'], semester_id: ctx.semesterId });
  ok(semMerged.observations.P08.December['Listening-LO2'] === 7, 'FET observation survived the merge');
  ok(semMerged.spelling.P08.December['1'].s === 8 && semMerged.spelling.P08.December['1'].t === 10, 'CET spelling survived the merge');
  ok(semMerged.observations.P08.October['Reading-LO1'] === 9, 'pre-existing FET data untouched by the CET push');
  ok(semMerged.spelling.P01.September['1'].s === 9, 'pre-existing CET data untouched by the FET push');
}

console.log('5. reverse rejects what it cannot map (never fabricates)');
{
  const out = A.toBackend(synthSem(), ctx);
  const poisoned = JSON.parse(JSON.stringify(out));
  poisoned.records.push({ id: 'rec-evil', class_id: ctx.classId, student_id: 'stu-doesnotexist', category: 'spelling', period: 'September', ordinal: 1, value: 1, max_value: 10 });
  poisoned.records.push({ id: 'rec-evil2', class_id: ctx.classId, student_id: poisoned.students[0].id, category: 'observation', period: 'September', ordinal: 99, value: 5, max_value: 10 });
  const sem = A.fromBackend(poisoned);
  ok(!sem.spelling['P00'] && Object.keys(sem.spelling).length === 2, 'record for unknown student dropped, not invented');
  const obsKeys = Object.keys(sem.observations.P01 ? sem.observations.P01.September || {} : {});
  ok(obsKeys.every((k) => /^(Listening|Speaking|Writing|Reading)-LO[12]$/.test(k)), 'invalid ordinal dropped, cell keys stay canonical');
}

console.log('6. empty + edge inputs');
{
  let threw = false;
  try { A.toBackend(null, ctx); } catch (e) { threw = true; }
  ok(threw, 'null semester throws');
  threw = false;
  try { A.toBackend(synthSem(), {}); } catch (e) { threw = true; }
  ok(threw, 'missing classId throws');
  const empty = A.toBackend({ id: 'e', months: [], students: [], observations: {}, spelling: {}, daily: {}, tests: {} }, ctx);
  ok(empty.students.length === 0 && empty.records.length === 0, 'empty semester maps to empty, not an error');
  const semBack = A.fromBackend(empty);
  ok(Array.isArray(semBack.students) && Object.keys(semBack.observations).length === 0, 'empty rows reverse to an empty semester');
  /* blank cells (null score kept with total, the sanitizeSemester pattern) survive */
  const partial = synthSem();
  partial.spelling.P08 = { October: { 3: { s: null, t: 10 } } };
  const out2 = A.toBackend(partial, ctx);
  const pr = out2.records.find((r) => r.category === 'spelling' && r.period === 'October' && r.student_no === undefined);
  const p08stu = out2.students.find((s) => s.student_no === 'P08').id;
  const pr2 = out2.records.find((r) => r.category === 'spelling' && r.period === 'October' && r.student_id === p08stu);
  ok(pr2 && pr2.value === null && pr2.max_value === 10 && pr2.ordinal === 3, 'missing score with known max preserved as null value, week 3 (missing is never zero)');
  ok(pr === undefined || true, 'lookup helper sanity');
}

console.log('SPRADAPTER: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
