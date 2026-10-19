/* Completeness-gate unit tests (pure modules, synthetic data only).
   Run: node tests/completeness.test.js  */
const Calc = require('../source/calc.js');
const A = require('../source/analysis.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log('FAIL', label, '\n  expected:', e, '\n  actual:  ', a); }
}
function ok(v, label) { if (v) pass++; else { fail++; console.log('FAIL', label); } }

/* ---- synthetic semester builder ---- */
function mkSem(stuDefs) {
  // stuDefs: [{ id, comp: {L,S,W,R,Sp,Da,M,O,Wr}, zero?: [...] }] — values are raw evidence builders
  const months = ['September', 'October'];
  const sem = {
    id: 'sem-1', name: '2026 Fall', school: 'Test School', className: 'P4C4',
    months, students: [], observations: {}, spelling: {}, daily: {}, tests: {},
  };
  for (const d of stuDefs) {
    sem.students.push({ id: d.id, nameCn: d.cn || '', nameEn: d.en || d.id, gender: 'F' });
    const c = d.comp || {};
    // observations: each of L,S,W,R as a single LO1 raw /10 => pct = v*10
    const obs = { September: {} };
    for (const [k, tag] of [['L', 'Listening'], ['S', 'Speaking'], ['W', 'Writing'], ['R', 'Reading']]) {
      if (c[k] !== undefined) obs.September[tag + '-LO1'] = c[k]; // v in 0..10
    }
    if (Object.keys(obs.September).length) sem.observations[d.id] = obs;
    for (const [k, store] of [['Sp', 'spelling'], ['Da', 'daily']]) {
      if (c[k] !== undefined) {
        sem[store][d.id] = { September: { 1: { s: c[k], t: c[k] === null ? null : 20 } } };
        if (c[k] === null) sem[store][d.id] = { September: { 1: { s: null, t: null } } };
      }
    }
    const tests = {};
    for (const [k, kind] of [['M', 'midterm'], ['O', 'oral'], ['Wr', 'written']]) {
      if (c[k] !== undefined && c[k] !== null) tests[kind] = { s: c[k], t: 50 };
    }
    if (Object.keys(tests).length) sem.tests[d.id] = tests;
  }
  return sem;
}
const FULL = { L: 8, S: 8, W: 8, R: 8, Sp: 16, Da: 8, M: 40, O: 40, Wr: 40 }; // 9/9 ~80%

/* ============ A: zero components ============ */
{
  const sem = mkSem([{ id: 'A0', comp: {} }]);
  const c = Calc.getAssessmentCompleteness(sem, 'A0');
  eq(c.assessedComponentCount, 0, 'A.count');
  ok(c.gate === 'not-assessed', 'A.gate');
  const fs = A.finalStatus(sem, 'A0');
  eq(fs.finalScore, null, 'A.finalScore null');
  eq(fs.letterGrade, null, 'A.letterGrade null');
  eq(fs.ragStatus, null, 'A.ragStatus null');
  ok(/Not yet assessed · 0 of 9 components/.test(fs.displayLabel), 'A.label');
  const sw = A.swot({ semesters: [sem] }, 'A0');
  ok(sw.provisionalStub === true, 'A.swot stub');
  ok(sw.strengths.length === 0 && sw.remark.indexOf('Not enough assessed work') === 0, 'A.remark safe');
  eq(Calc.atRisk(sem).length, 0, 'A.no intervention flag');
  eq(Calc.classFinalAvg(sem), null, 'A.class avg null');
  eq(Calc.gradeDistribution(sem)['U'], 0, 'A.no U in distribution');
}

/* ============ B: five components incl. real zeros ============ */
{
  // L=0 (real zero observation), Sp=0 (0/20 real zero), Da, M, O => 5 assessed
  const sem = mkSem([{ id: 'B5', comp: { L: 0, Sp: 0, Da: 10, M: 25, O: 30 } }]);
  const c = Calc.getAssessmentCompleteness(sem, 'B5');
  eq(c.assessedComponentCount, 5, 'B.count');
  eq(c.gate, 'not-assessed', 'B.gate');
  const fs = A.finalStatus(sem, 'B5');
  eq(fs.finalScore, null, 'B.final null');
  ok(/Not yet assessed · 5 of 9/.test(fs.displayLabel), 'B.label');
  const g = Calc.gradeStudent(sem, 'B5');
  eq(g.parts.Listening, 0, 'B.real zero kept as 0 (obs)');
  eq(g.parts.Spelling, 0, 'B.real zero kept as 0 (spelling)');
  ok(c.assessedComponentNames.includes('Listening') && c.assessedComponentNames.includes('Spelling'), 'B.zeros count as assessed');
  eq(Calc.atRisk(sem).length, 0, 'B.no intervention');
}

/* ============ C: six components ============ */
{
  const sem = mkSem([{ id: 'C6', comp: { L: 8, S: 8, W: 8, R: 8, Sp: 16, Da: 8 } }]);
  const fs = A.finalStatus(sem, 'C6');
  eq(fs.assessedComponentCount, 6, 'C.count');
  eq(fs.status, 'provisional', 'C.status');
  ok(/Provisional grade based on 6 of 9 components/.test(fs.displayLabel), 'C.label');
  ok(fs.finalScore !== null && fs.letterGrade !== null, 'C.has numbers');
  // formula unchanged: skills 80 each, Sp 80, Da 8/20=40 => 0.1*(80*5+40) = 44
  eq(Math.round(fs.finalScore * 100) / 100, 44, 'C.formula preserved');
  const rows = A.studentSemesterRows({ semesters: [sem] }, 'C6');
  eq(rows[0].rank, null, 'C.no rank (not 9/9)');
  const sw = A.swot({ semesters: [sem] }, 'C6');
  ok(sw.remark.indexOf('Provisional — based on 6 of 9 components') === 0, 'C.remark prefix');
  ok(Calc.atRisk(sem).length === 1, 'C.intervention allowed (final 44 < 50)');
}

/* ============ D: eight components ============ */
{
  const sem = mkSem([{ id: 'D8', comp: { L: 8, S: 8, W: 8, R: 8, Sp: 16, Da: 8, M: 40, O: 40 } }]);
  const fs = A.finalStatus(sem, 'D8');
  ok(/Provisional grade based on 8 of 9 components/.test(fs.displayLabel), 'D.label');
  // skills 80x4, Sp 80, Da 40, M 80, O 80 => 0.1*(80*7+40) = 60
  eq(A.studentSemesterRows({ semesters: [sem] }, 'D8')[0].rank, null, 'D.no rank');
}

/* ============ E: nine components, genuine zero everywhere ============ */
{
  const sem = mkSem([{ id: 'E9', comp: { L: 0, S: 0, W: 0, R: 0, Sp: 0, Da: 0, M: 0, O: 0, Wr: 0 } }]);
  const fs = A.finalStatus(sem, 'E9');
  eq(fs.assessedComponentCount, 9, 'E.count');
  eq(fs.status, 'final', 'E.status final');
  eq(fs.finalScore, 0, 'E.final 0.0 kept');
  eq(fs.letterGrade, 'U', 'E.grade U kept');
  eq(fs.ragStatus, 'R', 'E.RAG red kept');
  eq(A.studentSemesterRows({ semesters: [sem] }, 'E9')[0].rank, 1, 'E.ranked');
  ok(Calc.atRisk(sem).length === 1, 'E.intervention');
  eq(Calc.gradeDistribution(sem)['U'], 1, 'E.distribution U');
}

/* ============ F: nine components, passing — regression vs original formula ============ */
{
  const sem = mkSem([{ id: 'F9', comp: FULL }]);
  const fs = A.finalStatus(sem, 'F9');
  // skills 80x4, Sp 80, Da 40, tests 80/80/80 => 0.1*(80*7+40+80) = 60 + 0.2*80 = 76
  eq(Math.round(fs.finalScore * 100) / 100, 76, 'F.final 76');
  eq(fs.letterGrade, 'A', 'F.grade A');
  eq(fs.displayLabel, '', 'F.no provisional label');
  eq(fs.status, 'final', 'F.status final');
  // letter boundaries unchanged
  eq(Calc.letter(85), 'A*', 'F.A* boundary');
  eq(Calc.letter(84), 'A', 'F.84 is A');
  eq(Calc.letter(50), 'D', 'F.50 is D');
  eq(Calc.letter(49.9), 'D', 'F.49.9 is D (>49)');
  eq(Calc.letter(49), 'U', 'F.49 is U');
}

/* ============ G: mixed class — aggregates exclude incomplete ============ */
{
  const sem = mkSem([
    { id: 'G0', comp: {} },                                // 0/9
    { id: 'G5', comp: { L: 8, S: 8, W: 8, R: 8, Sp: 16 } }, // 5/9
    { id: 'G6', comp: { L: 8, S: 8, W: 8, R: 8, Sp: 16, Da: 8 } }, // 6/9 @ ~66.7
    { id: 'G9', comp: FULL },                              // 9/9 @ 80
  ]);
  // class average over gate-passing students only (G6 ~66.67, G9 80 => ~73.3)
  const avg = Calc.classFinalAvg(sem); // G6 final 44 (eligible), G9 final 76 => 60; G0/G5 excluded
  ok(avg !== null && Math.abs(avg - (44 + 76) / 2) < 0.001, 'G.avg excludes incomplete');
  // distribution: only G9's A counted; G0/G5 never counted
  const dist = Calc.gradeDistribution(sem);
  eq(dist.A, 1, 'G.dist A=1');
  eq(dist.U, 1, 'G.dist U=1 (G6 is eligible with final 44 — a real U, not a fake one)');
  // intervention: only eligible students (G6 final ~66.7? 0.1*(80*5+40)=44 -> at risk; G9 not)
  const risk = Calc.atRisk(sem);
  eq(risk.length, 1, 'G.risk only eligible');
  eq(risk[0].sid, 'G6', 'G.risk sid');
  // rank: only 9/9 students ranked
  const rows = A.studentSemesterRows({ semesters: [sem] }, 'G9');
  eq(rows[0].rank, 1, 'G.rank among 9/9 only');
  eq(rows[0].total, 1, 'G.rank denominator');
  eq(A.studentSemesterRows({ semesters: [sem] }, 'G0')[0].rank, null, 'G.no rank for 0/9');
  // movers: G6 excluded on the earlier side if other sem has it incomplete
  const sem2 = mkSem([{ id: 'G6', comp: {} }, { id: 'G9', comp: FULL }]);
  const mv = A.movers({ semesters: [sem, sem2] });
  eq(mv.list.length, 1, 'G.movers only fully-evidenced pairs (G9)');
  eq(mv.list[0].sid, 'G9', 'G.mover sid');
}

/* ============ score-without-total is NOT assessed (existing rule) ============ */
{
  const sem = mkSem([{ id: 'H1', comp: { L: 8, S: 8, W: 8, R: 8 } }]);
  sem.spelling['H1'] = { September: { 1: { s: 15, t: null } } }; // score without total
  const c = Calc.getAssessmentCompleteness(sem, 'H1');
  ok(!c.assessedComponentNames.includes('Spelling'), 'H.score w/o total not assessed');
  ok(c.missingComponentNames.includes('Spelling'), 'H.spelling in missing list');
}

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
