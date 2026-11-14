/* SPRDemo generator tests: determinism, engine validity, synthetic-only.
   Run: node tests/sprdemo.test.js */
const path = require('path');
const Module = require('module');
function loadAs(srcPath, exportName) {
  const src = require('fs').readFileSync(srcPath, 'utf8');
  const m = new Module('t', null);
  m._compile(src.replace(/typeof self !== 'undefined' \? self : this/g, 'globalThis'), 't.js');
  return m.exports;
}
const SPRDemo = loadAs(path.join(__dirname, '../source/sprdemo.js'));
const Calc = loadAs(path.join(__dirname, '../source/calc.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL: ' + m); } };

const d1 = SPRDemo.build(), d2 = SPRDemo.build();
ok(d1 && d2, 'build() returns data');
ok(JSON.stringify(d1) === JSON.stringify(d2), 'deterministic: two builds byte-identical');
ok(d1.meta.demo === 1 && /SYNTHETIC/.test(d1.meta.note), 'meta marks data as synthetic');
ok(d1.users.length === 2 && d1.users.every(u => /demo/i.test(u.username)), 'two demo teacher accounts only');
ok(d1.classes.length === 2, 'two classes');
ok(d1.classes[0].name === 'P4-A Demo' && d1.classes[1].name === 'P4-B Demo', 'class names per convention');
ok(d1.classes[0].semester.students.length === 22 && d1.classes[1].semester.students.length === 24, '22 + 24 students');
ok(d1.classes.every(c => c.semester.students.every(s => /Demo Student \d\d/.test(s.nameEn) && !s.nameCn)), 'every student name is Demo Student NN (synthetic)');
ok(d1.classes[0].pending.length === 1 && d1.classes[0].pending[0].requestedBy === 'cet-demo', 'one pending obs request from the CET');

/* engine validity: sanitize must quarantine NOTHING, and grades must come out */
let grades = 0, finals = [];
for (const c of d1.classes) {
  const moved = Calc.sanitizeSemester(c.semester);
  ok(moved.length === 0, c.name + ': 0 invalid cells quarantined (got ' + moved.length + ')');
  for (const s of c.semester.students) {
    const g = Calc.gradeStudent(c.semester, s.id);
    if (g && g.final !== null && isFinite(g.final)) { grades++; finals.push(g.final); }
  }
  const comp = c.semester.students.map(s => Calc.getAssessmentCompleteness(c.semester, s.id).gate);
  ok(comp.includes('final'), c.name + ': at least one fully-assessed (final) student');
}
ok(grades >= 40, 'gradeStudent produced finals for ' + grades + '/46 students');
const avg = finals.reduce((a, b) => a + b, 0) / finals.length;
ok(avg > 40 && avg < 95, 'realistic class average (' + avg.toFixed(1) + ')');
const gates = [];
for (const c of d1.classes) for (const s of c.semester.students) gates.push(Calc.getAssessmentCompleteness(c.semester, s.id).gate);
ok(gates.includes('provisional'), 'some students provisional (missing components demo)');
console.log('SPRDEMO: ' + pass + ' ok, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
