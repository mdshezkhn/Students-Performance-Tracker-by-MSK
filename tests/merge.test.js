/* Device-sync three-way merge tests (pure modules, synthetic data only).
   Run: node tests/merge.test.js  */
const M = require('../source/merge.js');
const Calc = require('../source/calc.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log('FAIL', label, '\n  expected:', e, '\n  actual:  ', a); }
}
function ok(v, label) { if (v) pass++; else { fail++; console.log('FAIL', label); } }
function st(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------------- fixtures ---------------- */
function mkState() {
  return {
    users: [{ username: 'mo', hash: 'h1', name: 'Mo', role: 'admin' }],
    wraps: { mo: 'w-mo' },
    db: {
      v: 1, currentSemesterId: 's1',
      credit: 'Designed for teachers, by a teacher — Mohammed Shehzad Khan (Teacher Mo)',
      author: 'Mohammed Shehzad Khan (Teacher Mo)',
      settings: { autoTotal: true, spTotal: 20, daTotal: 10 },
      semesters: [mkSem('s1')]
    }
  };
}
function mkSem(id) {
  return {
    id: id, name: '2026 Fall', school: 'Test School', className: 'P4C4', teachers: ['Mo'],
    months: ['September', 'October'],
    students: [
      { id: 'a1', nameCn: '小明', nameEn: 'Xiao Ming', gender: 'M' },
      { id: 'a2', nameCn: '小红', nameEn: 'Xiao Hong', gender: 'F' }
    ],
    observations: { a1: { September: { 'Listening-LO1': 8, 'Listening-LO2': 7 } } },
    spelling: { a1: { September: { 0: { s: 18, t: 20 } } }, a2: { September: { 0: { s: 15, t: 20 } } } },
    daily: { a2: { September: { 0: { s: 9, t: 10 } } } },
    tests: { a1: { midterm: { s: 45, t: 50 } } },
    reportNotes: { a1: 'Great progress.' }
  };
}
function setObs(s, sid, month, key, v) { const sem = s.db.semesters[0]; sem.observations[sid] = sem.observations[sid] || {}; sem.observations[sid][month] = sem.observations[sid][month] || {}; sem.observations[sid][month][key] = v; }
function setSp(s, sid, month, week, rec) { const sem = s.db.semesters[0]; sem.spelling[sid] = sem.spelling[sid] || {}; sem.spelling[sid][month] = sem.spelling[sid][month] || {}; sem.spelling[sid][month][week] = rec; }

/* ---------------- 1. identical edits ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  setObs(A, 'a1', 'September', 'Listening-LO1', 9);
  setObs(B, 'a1', 'September', 'Listening-LO1', 9);
  const r = M.merge(base, A, B);
  eq(r.conflicts, [], 'identical edits: no conflict');
  eq(r.merged.db.semesters[0].observations.a1.September['Listening-LO1'], 9, 'identical edits: value taken');
}

/* ---------------- 2. one-sided edits on each side ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  setObs(A, 'a1', 'September', 'Listening-LO1', 9);            // local only
  B.db.semesters[0].tests.a1.oral = { s: 48, t: 50 };          // cloud only
  const r = M.merge(base, A, B);
  eq(r.conflicts, [], 'one-sided: no conflict');
  eq(r.merged.db.semesters[0].observations.a1.September['Listening-LO1'], 9, 'local edit kept');
  eq(r.merged.db.semesters[0].tests.a1.oral, { s: 48, t: 50 }, 'cloud edit taken');
}

/* ---------------- 3. disjoint edits by two teachers ---------------- */
{
  const base = mkState(), obs = st(base), sp = st(base);
  setObs(obs, 'a1', 'September', 'Listening-LO2', 10);
  setSp(sp, 'a1', 'September', 0, { s: 20, t: 20 });
  const r = M.merge(base, obs, sp);
  eq(r.conflicts, [], 'disjoint: no conflict');
  const sem = r.merged.db.semesters[0];
  eq(sem.observations.a1.September['Listening-LO2'], 10, 'disjoint: observation kept');
  eq(sem.spelling.a1.September[0], { s: 20, t: 20 }, 'disjoint: spelling kept');
  /* grades recomputed from the merged data must reflect BOTH teachers */
  const g = Calc.gradeAll(sem).find((x) => x.sid === 'a1');
  ok(g.parts['Spelling'] > 0 && g.parts['Listening'] > 0, 'disjoint: both components graded');
}

/* ---------------- 4. same-cell different-value conflict ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  setSp(A, 'a1', 'September', 0, { s: 20, t: 20 });
  setSp(B, 'a1', 'September', 0, { s: 12, t: 20 });
  const r = M.merge(base, A, B);
  eq(r.conflicts.length, 1, 'same-cell: exactly one conflict');
  const c = r.conflicts[0];
  eq([c.studentName, c.section, c.month, c.week], ['小明 (Xiao Ming)', 'spelling', 'September', '0'], 'same-cell: metadata');
  eq([c.local, c.cloud], [{ s: 20, t: 20 }, { s: 12, t: 20 }], 'same-cell: both values');
  eq(r.merged.db.semesters[0].spelling.a1.September[0], { s: 20, t: 20 }, 'same-cell: local kept pending decision');
  M.applyChoice(r.merged, c, 'theirs');
  eq(r.merged.db.semesters[0].spelling.a1.September[0], { s: 12, t: 20 }, 'same-cell: theirs applied');
  M.applyChoice(r.merged, c, 'mine');
  eq(r.merged.db.semesters[0].spelling.a1.September[0], { s: 20, t: 20 }, 'same-cell: mine re-applied');
}

/* ---------------- 5. edit-vs-delete conflict ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  delete A.db.semesters[0].tests.a1.midterm;                   // local deleted
  A.db.semesters[0].tests.a1 = {};                             // (row exists, key gone)
  B.db.semesters[0].tests.a1.midterm = { s: 49, t: 50 };       // cloud edited
  const r = M.merge(base, A, B);
  const c = r.conflicts.find((x) => x.key === 'midterm');
  ok(!!c, 'edit-vs-delete: conflict raised');
  eq(c.local, null, 'edit-vs-delete: local side is a deletion');
  eq(c.cloud, { s: 49, t: 50 }, 'edit-vs-delete: cloud side is the edit');
  M.applyChoice(r.merged, c, 'theirs');
  eq(r.merged.db.semesters[0].tests.a1.midterm, { s: 49, t: 50 }, 'edit-vs-delete: resurrected');
  M.applyChoice(r.merged, c, 'mine');
  const rowNow = r.merged.db.semesters[0].tests.a1;
  ok(!rowNow || rowNow.midterm === undefined, 'edit-vs-delete: deletion applied');
}

/* ---------------- 6. delete on one side only ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  delete B.db.semesters[0].spelling.a2.September[0];           // cloud deleted, local untouched
  const r = M.merge(base, A, B);
  eq(r.conflicts, [], 'delete-only: no conflict');
  eq(r.merged.db.semesters[0].spelling.a2, undefined, 'delete-only: deletion honoured');
}

/* ---------------- 7. student added on both sides ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  A.db.semesters[0].students.push({ id: 'n1', nameCn: '新一', nameEn: 'New One', gender: 'F' });
  B.db.semesters[0].students.push({ id: 'n2', nameCn: '新二', nameEn: 'New Two', gender: 'M' });
  const r = M.merge(base, A, B);
  eq(r.conflicts, [], 'both-added students: no conflict');
  eq(r.merged.db.semesters[0].students.length, 4, 'both-added students: both kept');
  /* same id added on both sides with different data -> conflict, never silent */
  const C = st(base), D = st(base);
  C.db.semesters[0].students.push({ id: 'n9', nameCn: '同名', nameEn: 'Same Id A', gender: 'F' });
  D.db.semesters[0].students.push({ id: 'n9', nameCn: '同名', nameEn: 'Same Id B', gender: 'M' });
  const r2 = M.merge(base, C, D);
  eq(r2.conflicts.filter((c) => c.unit === 'student').length, 1, 'both-added same id: conflict');
}

/* ---------------- 8. weekly record with score but no total ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  setSp(A, 'a2', 'October', 1, { s: 17 });                     // half-record is data
  setSp(B, 'a2', 'October', 1, { s: 17 });                     // identical half-record
  const r = M.merge(base, A, B);
  eq(r.conflicts, [], 'half-record: identical halves agree');
  eq(r.merged.db.semesters[0].spelling.a2.October[1], { s: 17 }, 'half-record: preserved');
  const C = st(base);
  setSp(C, 'a2', 'October', 1, { s: 17, t: 20 });
  const r2 = M.merge(base, A, C);
  eq(r2.conflicts.length, 1, 'half vs full record: conflict');
}

/* ---------------- 9. a genuine 0 is never "missing" ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  setObs(A, 'a1', 'September', 'Listening-LO1', 0);            // scored zero
  const r = M.merge(base, A, B);
  eq(r.conflicts, [], 'zero: no conflict (0 vs unchanged)');
  eq(r.merged.db.semesters[0].observations.a1.September['Listening-LO1'], 0, 'zero: value kept');
  setObs(B, 'a1', 'September', 'Listening-LO1', 0);
  const r2 = M.merge(base, A, B);
  eq(r2.merged.db.semesters[0].observations.a1.September['Listening-LO1'], 0, 'zero: agrees with identical 0');
}

/* ---------------- 10. idempotence ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  setObs(A, 'a1', 'September', 'Listening-LO1', 9);
  setSp(B, 'a1', 'September', 0, { s: 11, t: 20 });
  const r1 = M.merge(base, A, B);
  const r2 = M.merge(base, r1.merged, B);                      // merging the result again
  eq(r2.conflicts, [], 'idempotent: no new conflicts');
  eq(r2.merged, r1.merged, 'idempotent: identical result');
}

/* ---------------- 11. symmetry ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  setObs(A, 'a1', 'October', 'Reading-LO1', 6);
  setSp(B, 'a2', 'September', 0, { s: 19, t: 20 });
  B.db.settings.spTotal = 25;
  const r1 = M.merge(base, A, B);
  const r2 = M.merge(base, B, A);                              // roles swapped
  eq(r2.conflicts, [], 'symmetry: no conflicts either direction');
  eq(M.stableStringify(r2.merged), M.stableStringify(r1.merged), 'symmetry: same merged data');
}

/* ---------------- 12. inputs never mutated ---------------- */
{
  const base = mkState(), A = st(base), B = st(base);
  setObs(A, 'a1', 'September', 'Listening-LO1', 9);
  setSp(B, 'a1', 'September', 0, { s: 13, t: 20 });
  const before = { b: st(base), a: st(A), c: st(B) };
  M.merge(base, A, B);
  eq([base, A, B], [before.b, before.a, before.c], 'inputs unmutated');
}

/* ---------------- 13. large class performance ---------------- */
{
  const base = mkState();
  const sem = base.db.semesters[0];
  sem.months = ['January','February','March','April','May','June','September','October','November','December'];
  sem.students = [];
  for (let i = 0; i < 30; i++) {
    const id = 'p' + i;
    sem.students.push({ id: id, nameCn: '学' + i, nameEn: 'Pupil ' + i, gender: i % 2 ? 'F' : 'M' });
    for (const m of sem.months) {
      for (const sk of Calc.SKILLS) for (const lo of [1, 2]) setObs(base, id, m, sk + '-LO' + lo, (i + lo) % 11);
      for (let w = 0; w < 5; w++) { setSp(base, id, m, w, { s: (i + w) % 21, t: 20 }); sem.daily[id] = sem.daily[id] || {}; sem.daily[id][m] = sem.daily[id][m] || {}; sem.daily[id][m][w] = { s: (i + w) % 11, t: 10 }; }
    }
    sem.tests[id] = { midterm: { s: (i * 3) % 51, t: 50 }, oral: { s: (i * 3) % 51, t: 50 }, written: { s: (i * 3) % 101, t: 100 } };
  }
  const A = st(base), B = st(base);
  setObs(A, 'p7', 'May', 'Reading-LO2', 3);
  setSp(B, 'p11', 'November', 4, { s: 1, t: 20 });
  const t0 = Date.now();
  const r = M.merge(base, A, B);
  const ms = Date.now() - t0;
  eq(r.conflicts, [], 'large: no false conflicts');
  ok(ms < 1000, 'large: merged in ' + ms + 'ms (< 1000ms)');
  console.log('       (large-class merge: ' + ms + ' ms)');
}

/* ---------------- 14. grading regression (golden values) ---------------- */
{
  const s = mkState();
  const sem = s.db.semesters[0];
  /* student a1: L(8,7)=7.5*10=75, Spelling 18/20=90, MidTerm 45/50=90, only 3 of 9 -> not-assessed */
  const g1 = Calc.gradeStudent(sem, 'a1');
  eq(Calc.getAssessmentCompleteness(sem, 'a1').gate, 'not-assessed', 'grading: gate not-assessed (<6 components)');
  eq(Calc.assessedCount(g1), 3, 'grading: assessedCount 3');
  /* complete student: fill every component for a2 -> final = .1*(L+S+W+R+Sp+Da+Mid+Oral) + .2*Written */
  const full = { a2: { September: { 'Listening-LO1': 9, 'Listening-LO2': 9, 'Speaking-LO1': 8, 'Speaking-LO2': 8, 'Writing-LO1': 7, 'Writing-LO2': 7, 'Reading-LO1': 6, 'Reading-LO2': 6 } } };
  sem.observations = Object.assign(sem.observations, full);
  sem.spelling.a2.September[1] = { s: 20, t: 20 };             // month1: 15/20=75, month2: 100 -> avg 87.5
  sem.daily.a2.September[1] = { s: 10, t: 10 };                // month1: 9/10=90, month2: 100 -> avg 95
  sem.tests.a2 = { midterm: { s: 50, t: 50 }, oral: { s: 45, t: 50 }, written: { s: 80, t: 100 } };
  const g2 = Calc.gradeStudent(sem, 'a2');
  /* L=(9+9)/2*10=90, S=80, W=70, R=60, Sp=(15+20)/40=87.5, Da=(9+10)/20=95,
     Mid=100, Oral=90, Wr=80
     final = .1*(90+80+70+60+87.5+95+100+90) + .2*80 = 67.25 + 16 = 83.25 -> A */
  eq(g2.final, 83.25, 'grading: golden final');
  eq(g2.letter, 'A', 'grading: golden letter');
  eq(Calc.getAssessmentCompleteness(sem, 'a2').gate, 'final', 'grading: gate final (9 of 9)');
  /* the merged engine must not disturb any of this: merge a no-op sync */
  const before = JSON.stringify(Calc.gradeAll(sem));
  const r = M.merge(s, st(s), st(s));
  eq(JSON.stringify(Calc.gradeAll(r.merged.db.semesters[0])), before, 'grading: unchanged through merge');
}

/* ---------------- 15. two-device protocol simulation ---------------- */
/* Exercises the same decision procedure app.js uses on push/pull against an
   in-memory stand-in for the spr_channels row (sbGet/sbSave fakes). */
{
  const digest = (s) => M.stableStringify({ users: s.users, wraps: s.wraps, db: s.db });
  const cloud = { row: null };                                 // { sum, state }
  const sbGet = async () => cloud.row ? st(cloud.row) : null;
  const sbSave = async (state) => { cloud.row = { sum: digest(state), state: st(state), by: 'dev' }; return 'ok'; };

  function mkDevice(name, state) { return { name: name, state: state, base: null }; }

  /* devicePush mirrors dsPushNow: fast path, or three-way merge when the cloud
     moved since our base (conflicts resolved all-mine/theirs by the caller) */
  async function devicePush(dev, resolve) {
    const row = await sbGet();
    if (!row) { await sbSave(dev.state); dev.base = st(dev.state); return 'pushed'; }
    if (row.sum === digest(dev.state)) { dev.base = st(row.state); return 'uptodate'; }
    if (dev.base && digest(dev.base) === row.sum) { await sbSave(dev.state); dev.base = st(dev.state); return 'pushed'; }
    if (dev.base) {
      const r = M.merge(dev.base, dev.state, row.state);
      if (r.conflicts.length) {
        for (const c of r.conflicts) M.applyChoice(r.merged, c, resolve(c));
        dev.state = r.merged; await sbSave(dev.state); dev.base = st(dev.state);
        return 'merged:' + r.conflicts.length;
      }
      dev.state = r.merged; await sbSave(dev.state); dev.base = st(dev.state);
      return 'merged:0';
    }
    return 'no-base-fallback';                                 // must NOT happen in this sim
  }
  /* devicePull mirrors the pull-check: install when local is unchanged, merge otherwise */
  async function devicePull(dev, resolve) {
    const row = await sbGet();
    if (!row) return 'nocloud';
    if (row.sum === digest(dev.state)) { dev.base = st(row.state); return 'uptodate'; }
    if (!dev.base || digest(dev.state) === digest(dev.base)) {
      dev.state = st(row.state); dev.base = st(row.state); return 'installed';
    }
    const r = M.merge(dev.base, dev.state, row.state);
    for (const c of r.conflicts) M.applyChoice(r.merged, c, resolve ? resolve(c) : 'theirs');
    dev.state = r.merged; await sbSave(dev.state); dev.base = st(dev.state);
    return 'merged:' + r.conflicts.length;
  }

  (async function () {
    const S = mkState();
    const A = mkDevice('A', st(S));                            // teacher A's laptop
    const B = mkDevice('B', null);                             // teacher B's tablet
    /* B signs in on a paired device: installs the cloud copy */
    eq(await devicePush(A), 'pushed', 'sim: first push');
    B.state = st((await sbGet()).state); B.base = st(B.state);
    /* the scenario from the brief: A edits Observations, B edits Spelling/Tests */
    setObs(A.state, 'a1', 'September', 'Listening-LO1', 10);
    setSp(B.state, 'a1', 'September', 0, { s: 20, t: 20 });
    B.state.db.semesters[0].tests.a1.written = { s: 92, t: 100 };
    /* A pushes (cloud still == base) */
    eq(await devicePush(A), 'pushed', 'sim: A push while cloud unchanged');
    /* B pushes — cloud moved since B's base: MUST merge, not overwrite */
    eq(await devicePush(B), 'merged:0', 'sim: B push merges (no edit lost)');
    const cloudSem = (await sbGet()).state.db.semesters[0];
    eq(cloudSem.observations.a1.September['Listening-LO1'], 10, 'sim: A observation survived B push');
    eq(cloudSem.spelling.a1.September[0], { s: 20, t: 20 }, 'sim: B spelling survived');
    eq(cloudSem.tests.a1.written, { s: 92, t: 100 }, 'sim: B test survived');
    /* A pulls: local unchanged since base, cloud moved -> installs the merged copy */
    eq(await devicePull(A), 'installed', 'sim: A installs the merged cloud copy');
    eq(A.state.db.semesters[0].tests.a1.written, { s: 92, t: 100 }, 'sim: A now sees B test edit');
    eq(A.state.db.semesters[0].spelling.a1.September[0], { s: 20, t: 20 }, 'sim: A now sees B spelling edit');
    /* offline edit on A while B also edits the SAME cell -> conflict path */
    setSp(A.state, 'a1', 'September', 0, { s: 19, t: 20 });
    setSp(B.state, 'a1', 'September', 0, { s: 5, t: 20 });
    eq(await devicePush(B), 'pushed', 'sim: B push (cloud == B base)');
    const res = await devicePush(A, () => 'mine');
    eq(res, 'merged:1', 'sim: same-cell push raises exactly one conflict');
    eq(A.state.db.semesters[0].spelling.a1.September[0], { s: 19, t: 20 }, 'sim: A kept mine');
    eq((await sbGet()).state.db.semesters[0].spelling.a1.September[0], { s: 19, t: 20 }, 'sim: cloud carries the decision');
    /* B pulls the decision */
    await devicePull(B);
    eq(B.state.db.semesters[0].spelling.a1.September[0], { s: 19, t: 20 }, 'sim: B sees the decision');

    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })().catch(function (e) { console.error('SIM ERROR', e); process.exit(1); });
}
