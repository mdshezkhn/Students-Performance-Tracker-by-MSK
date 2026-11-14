/* SPRDemo — deterministic synthetic demo dataset (class mode).
   Generates TWO demo classes ("P4-A Demo", "P4-B Demo") with dummy students,
   FET observations, CET spelling/daily/test scores, one pending observation
   request and audit history. 100% synthetic: no real student names or marks,
   fixed PRNG seed, so every install produces byte-identical data and node
   tests can verify it against the real calculation engine.
   Node-safe: no DOM. In browser: window.SPRDemo; in node: module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPRDemo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SKILLS = ['Listening', 'Speaking', 'Writing', 'Reading'];
  const MONTHS_FULL = ['September', 'October'];
  const FET = 'fet-demo';
  const CET = 'cet-demo';

  /* mulberry32 — tiny deterministic PRNG (same sequence everywhere) */
  function prng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rint = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

  /* score in a 0..max window around a student's band, clamped to valid */
  function around(r, band, max) {
    const v = Math.round(band * max + (r() - 0.5) * max * 0.18);
    return Math.max(0, Math.min(max, v));
  }

  function makeStudents(r, prefix, count) {
    const out = [];
    for (let i = 1; i <= count; i++) {
      out.push({
        id: prefix + '-' + String(i).padStart(2, '0'),
        nameCn: '',
        nameEn: 'Demo Student ' + String(i).padStart(2, '0'),
        gender: i % 2 === 0 ? 'F' : 'M',
      });
    }
    return out;
  }

  /* Build one class workbook semester. fill pattern:
     full    — everything assessed (final grades)
     partial — October still in progress (provisional grades)
     sparse  — a student whose written + oral tests are still missing   */
  function buildSemester(r, cls, students, pattern, opts) {
    const sem = {
      id: 'sem-' + cls.id + '-2026f',
      name: '2026 Fall',
      school: 'SPR Demo School',
      className: cls.name,
      teachers: ['Demo FET', 'Demo CET'],
      months: MONTHS_FULL.slice(),
      students: students,
      observations: {}, spelling: {}, daily: {}, tests: {},
      reportNotes: {},
    };
    students.forEach((s, i) => {
      /* deterministic bands: 4 strong, broad middle, a few developing
         learners — a realistic class spread, plus one high performer and
         one student whose written/oral exams are not entered yet */
      const bandPool = [0.92, 0.86, 0.80, 0.77, 0.74, 0.70, 0.70, 0.66, 0.62, 0.58, 0.54, 0.47];
      const band = bandPool[i % bandPool.length];
      const isSparse = pattern === 'sparse' && i === students.length - 2;

      /* FET observations: two lesson observations (LO1/LO2) per skill per
         month on the 0-10 scale */
      sem.observations[s.id] = {};
      for (const m of MONTHS_FULL) {
        if (pattern === 'partial' && m === 'October' && i % 7 === 3) continue;   /* not observed yet this month */
        sem.observations[s.id][m] = {};
        for (const sk of SKILLS) {
          const base = around(r, band, 10);
          sem.observations[s.id][m][sk + '-LO1'] = Math.max(0, Math.min(10, base));
          sem.observations[s.id][m][sk + '-LO2'] = Math.max(0, Math.min(10, base + rint(r, -1, 1)));
        }
      }

      /* CET spelling (out of 20) and daily assignments (out of 10): weekly */
      for (const metric of ['spelling', 'daily']) {
        sem[metric][s.id] = {};
        const max = metric === 'spelling' ? 20 : 10;
        const weeks = { September: 4, October: pattern === 'partial' ? 2 : 4 };
        for (const m of MONTHS_FULL) {
          sem[metric][s.id][m] = {};
          for (let w = 1; w <= weeks[m]; w++) {
            /* a few blank weeks (absent) so missing ≠ zero is visible */
            if (r() < 0.04) continue;
            sem[metric][s.id][m][String(w)] = { s: around(r, band, max), t: max };
          }
        }
      }

      /* CET formal tests: midterm (all), oral (most), written (most) */
      sem.tests[s.id] = { midterm: { s: around(r, band, 50), t: 50 } };
      if (!(isSparse)) {
        if (r() > 0.08) sem.tests[s.id].oral = { s: around(r, band, 20), t: 20 };
        if (r() > 0.08) sem.tests[s.id].written = { s: around(r, band, 40), t: 40 };
      }
    });
    return sem;
  }

  /* the full demo environment */
  function build() {
    const r = prng(20261115);
    const studentsA = makeStudents(r, 'da', 22);
    const studentsB = makeStudents(r, 'db', 24);

    const classA = {
      id: 'demo-p4a-2026', name: 'P4-A Demo', school: 'SPR Demo School',
      eal: FET, support: CET,
    };
    const classB = {
      id: 'demo-p4b-2026', name: 'P4-B Demo', school: 'SPR Demo School',
      eal: FET, support: CET,
    };

    const semA = buildSemester(r, classA, studentsA, 'full', {});
    const semB = buildSemester(r, classB, studentsB, 'partial', {});

    /* one pending observation request from the CET, so the FET approval
       workflow has something real to show (P4-A, Demo Student 08, October) */
    const pending = {
      id: 'pc-demo-1', kind: 'obs', semId: semA.id,
      sid: studentsA[7].id, month: 'October', key: 'Speaking-LO2',
      oldValue: semA.observations[studentsA[7].id].October['Speaking-LO2'],
      newValue: 8,
      requestedBy: CET, time: 1762900000000,
      note: 'He led his group confidently in the weather game today.',
    };

    const audit = [
      { t: 1762800000000, by: 'owner-demo', action: 'class.create', note: 'P4-A Demo created (demo data)' },
      { t: 1762800100000, by: 'owner-demo', action: 'class.create', note: 'P4-B Demo created (demo data)' },
      { t: 1762810000000, by: FET, action: 'obs.request', cell: semA.id + '/' + studentsA[7].id + '/October/Speaking-LO2', old: pending.oldValue, new: 8, note: 'requested by ' + CET },
    ];

    return {
      meta: { demo: 1, version: 1, generatedBy: 'sprdemo.js', note: 'SYNTHETIC demo data - no real students' },
      users: [
        { username: FET, name: 'Demo FET (foreign teacher)', role: 'teacher' },
        { username: CET, name: 'Demo CET (assistant teacher)', role: 'teacher' },
      ],
      classes: [
        { id: classA.id, name: classA.name, school: classA.school, eal: FET, support: CET, semester: semA, pending: [pending], audit: audit },
        { id: classB.id, name: classB.name, school: classB.school, eal: FET, support: CET, semester: semB, pending: [], audit: [] },
      ],
    };
  }

  return { build: build, FET: FET, CET: CET };
});
