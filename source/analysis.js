/* =========================================================================
   Student's Performance Report — comparative analysis engine (pure, no DOM)
   Cross-semester class/student progress, RAG classification, SWOT remarks.
   Requires Calc (gradeStudent/gradeAll) and Util.
   RAG thresholds:  Green ≥ 75 (secure A/A*) · Amber 55–74.9 (B/C) · Red < 55 (D/U)
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Analysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const Calc = (typeof window !== 'undefined' && window.Calc) || (typeof require === 'function' ? require('./calc.js') : null);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
  const f1 = (v) => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toFixed(1));

  const COMPONENTS = ['Listening', 'Speaking', 'Writing', 'Reading', 'Spelling',
    'Daily Assignments', 'Mid-Term', 'Oral', 'Written'];
  const SHORT = { 'Listening': 'Listen', 'Speaking': 'Speak', 'Writing': 'Write',
    'Reading': 'Read', 'Spelling': 'Spell', 'Daily Assignments': 'Daily',
    'Mid-Term': 'Mid-Term', 'Oral': 'Oral', 'Written': 'Written' };

  /* ---------------- RAG ---------------- */
  function rag(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return null;
    if (pct >= 75) return 'G';
    if (pct >= 55) return 'A';
    return 'R';
  }
  // overall RAG for a grade result, adjusted by cross-semester trend
  function ragOverall(g, delta) {
    let base = rag(g && g.final);
    if (base === null) return null;
    if (delta !== null && delta <= -8 && base !== 'R') return base === 'G' ? 'A' : 'R'; // sharp decline
    if (delta !== null && delta >= 8 && base !== 'G') return base === 'R' ? 'A' : 'G';  // sharp rise
    return base;
  }
  const RAG_NAME = { G: 'Green', A: 'Amber', R: 'Red' };

  /* Centralised final-result state. Single source of truth for every screen:
     <6/9 assessed => no numbers at all; 6-8 => existing formula + provisional
     label; 9/9 => existing behaviour unchanged. */
  function finalStatus(sem, sid) {
    const c = Calc.getAssessmentCompleteness(sem, sid);
    if (c.assessedComponentCount < Calc.FINAL_MIN_ASSESSED) {
      return {
        status: 'provisional', finalScore: null, letterGrade: null, ragStatus: null,
        assessedComponentCount: c.assessedComponentCount, totalComponentCount: c.totalComponentCount,
        displayLabel: 'Not yet assessed · ' + c.assessedComponentCount + ' of 9 components',
        completeness: c,
      };
    }
    const g = Calc.gradeStudent(sem, sid);
    return {
      status: c.gate, /* 'provisional' (6-8) | 'final' (9) */
      finalScore: g.final, letterGrade: g.letter, ragStatus: rag(g.final),
      assessedComponentCount: c.assessedComponentCount, totalComponentCount: c.totalComponentCount,
      displayLabel: c.gate === 'provisional' ? 'Provisional grade based on ' + c.assessedComponentCount + ' of 9 components' : '',
      completeness: c,
    };
  }

  /* ---------------- class-level series ---------------- */
  // one row per semester: part averages, final avg, distribution, at-risk count
  function classSemesterRows(db) {
    return db.semesters.map((sem) => {
      const gs = Calc.gradeAll(sem);
      const parts = {};
      for (const k of COMPONENTS) parts[k] = mean(gs.map((g) => g.parts[k]).filter((v) => v !== null));
      const obsAvg = mean([parts.Listening, parts.Speaking, parts.Writing, parts.Reading].filter((v) => v !== null));
      return {
        semId: sem.id, semName: sem.name, n: sem.students.length,
        parts: parts, obsAvg: obsAvg,
        final: Calc.classFinalAvg(sem),
        dist: Calc.gradeDistribution(sem),
        atRisk: Calc.atRisk(sem).length,
      };
    });
  }
  function classAvgParts(db, semId) {
    const row = classSemesterRows(db).find((r) => r.semId === semId);
    return row ? row.parts : {};
  }

  // movers: final delta between the last two semesters that share students
  function movers(db) {
    if (db.semesters.length < 2) return null;
    const a = db.semesters[db.semesters.length - 2], b = db.semesters[db.semesters.length - 1];
    const out = [];
    for (const s of b.students) {
      if (!a.students.some((x) => x.id === s.id)) continue;
      const ga = Calc.gradeStudent(a, s.id), gb = Calc.gradeStudent(b, s.id);
      if (ga.final === null || gb.final === null) continue;
      // progress conclusions need sufficient evidence on both sides of the comparison
      if (Calc.assessedCount(ga) < Calc.FINAL_MIN_ASSESSED || Calc.assessedCount(gb) < Calc.FINAL_MIN_ASSESSED) continue;
      out.push({ sid: s.id, name: s.nameEn || s.nameCn, from: a.name, to: b.name, delta: gb.final - ga.final, final: gb.final });
    }
    out.sort((x, y) => y.delta - x.delta);
    return { from: a.name, to: b.name, list: out };
  }

  // class-level narrative: best/worst components + trajectory
  function classSummary(db) {
    const rows = classSemesterRows(db);
    if (!rows.length) return null;
    const last = rows[rows.length - 1], prev = rows[rows.length - 2] || null;
    const ranked = COMPONENTS.map((k) => ({ k: k, v: last.parts[k] }))
      .filter((x) => x.v !== null).sort((x, y) => y.v - x.v);
    const best = ranked.slice(0, 2).map((x) => x.k + ' (' + f1(x.v) + '%)');
    const worst = ranked.slice(-2).reverse().map((x) => x.k + ' (' + f1(x.v) + '%)');
    const d = prev && prev.final !== null && last.final !== null ? last.final - prev.final : null;
    return { last: last, prev: prev, best: best, worst: worst, delta: d };
  }

  /* ---------------- student-level series ---------------- */
  function studentSemesterRows(db, sid) {
    const out = [];
    for (const sem of db.semesters) {
      if (!sem.students.some((x) => x.id === sid)) continue;
      const g = Calc.gradeStudent(sem, sid);
      const assessed = Calc.assessedCount(g);
      // ranks exist only among fully-assessed students (9/9); provisional records never rank
      const finals = sem.students
        .map((s) => { const gg = Calc.gradeStudent(sem, s.id); return { id: s.id, f: gg.final, ok: Calc.assessedCount(gg) >= Calc.COMPONENTS_ALL.length }; })
        .filter((x) => x.ok && x.f !== null)
        .sort((x, y) => y.f - x.f);
      const rank = finals.findIndex((x) => x.id === sid) + 1;
      out.push({
        semId: sem.id, semName: sem.name, parts: g.parts, final: g.final, letter: g.letter,
        rank: rank || null, total: finals.length, missing: g.missing, assessed: assessed,
      });
    }
    return out;
  }
  // component × semester matrix with last-vs-prev delta
  function studentMatrix(db, sid) {
    const rows = studentSemesterRows(db, sid);
    const prev = rows[rows.length - 2] || null, last = rows[rows.length - 1] || null;
    const lastOk = last ? last.assessed >= Calc.FINAL_MIN_ASSESSED : false; /* final row evidence gate */
    return COMPONENTS.concat(['__final']).map((k) => {
      const vals = rows.map((r) => (k === '__final' ? r.final : r.parts[k]));
      const lv = vals[vals.length - 1], pv = vals.length > 1 ? vals[vals.length - 2] : null;
      return {
        key: k === '__final' ? 'Final' : k, short: k === '__final' ? 'Final' : SHORT[k],
        values: vals,
        delta: (lv !== null && pv !== null) ? lv - pv : null,
        rag: k === '__final' ? (lastOk ? rag(lv) : null) : rag(lv),
      };
    });
  }

  /* ---------------- SWOT + remark ---------------- */
  function swot(db, sid) {
    const rows = studentSemesterRows(db, sid);
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2] || null;
    // evidence gate: no SWOT or remark from an incomplete record
    if (last.assessed < Calc.FINAL_MIN_ASSESSED) {
      const stu0 = db.semesters.find((s) => s.id === last.semId).students.find((x) => x.id === sid);
      const nm = (stu0 && (stu0.nameEn || stu0.nameCn)) || sid;
      return {
        sid: sid, name: nm, last: last, prev: prev, delta: null, overallRag: null, ragName: null,
        provisionalStub: true,
        strengths: [], weaknesses: [], opportunities: [], threats: [],
        remark: 'Not enough assessed work yet to report on ' + nm + ' — ' + last.assessed + ' of 9 components assessed.',
      };
    }
    const provisional = last.assessed < Calc.COMPONENTS_ALL.length;
    const stu = db.semesters.find((s) => s.id === last.semId).students.find((x) => x.id === sid);
    const name = (stu && (stu.nameEn || stu.nameCn)) || sid;
    const cls = classAvgParts(db, last.semId);
    const L = last.parts;

    const ranked = COMPONENTS.map((k) => ({ k: k, v: L[k], c: cls[k], d: cls[k] !== null && L[k] !== null ? L[k] - cls[k] : null }))
      .filter((x) => x.v !== null);
    const byVal = ranked.slice().sort((a, b) => b.v - a.v);
    const byGap = ranked.slice().sort((a, b) => (b.d === null ? -99 : b.d) - (a.d === null ? -99 : a.d));

    const strengths = ranked.filter((x) => x.v >= 85 || (x.d !== null && x.d >= 8)).sort((a, b) => b.v - a.v).slice(0, 3);
    const weaknesses = ranked.filter((x) => x.v < 60 || (x.d !== null && x.d <= -8)).sort((a, b) => a.v - b.v).slice(0, 3);
    if (!strengths.length && byVal.length) strengths.push(byVal[0]);
    if (!weaknesses.length && byVal.length) weaknesses.push(byVal[byVal.length - 1]);

    // opportunities: close to the next grade band (68–74 → A, 78–84 → A*)
    const opportunities = ranked.filter((x) => (x.v >= 68 && x.v < 75) || (x.v >= 78 && x.v < 85))
      .sort((a, b) => b.v - a.v).slice(0, 3);
    // threats: declining components vs previous semester, or ungraded parts
    const threats = [];
    if (prev) {
      for (const k of COMPONENTS) {
        const a = prev.parts[k], b = L[k];
        if (a !== null && b !== null && b - a <= -8) threats.push({ k: k, v: b, d: b - a });
      }
    }
    if (last.missing && last.missing.length) threats.push({ k: 'Ungraded: ' + last.missing.join(', '), v: null, d: null });
    if (!threats.length && weaknesses.length) threats.push({ k: weaknesses[0].k + ' pulling the final down', v: weaknesses[0].v, d: weaknesses[0].d });

    const best = byVal[0], worst = byVal[byVal.length - 1];
    const clsFinal = (function () { const r = classSemesterRows(db).find((x) => x.semId === last.semId); return r ? r.final : null; })();
    const delta = prev && prev.final !== null && last.final !== null ? last.final - prev.final : null;
    const overallRag = ragOverall({ final: last.final }, delta);

    const bullet = (x) => x.k + ' — ' + f1(x.v) + '%' + (x.d !== null && x.d !== undefined && x.k.indexOf('Ungraded') !== 0 ? ' (' + (x.d >= 0 ? '+' : '') + f1(x.d) + ' vs class)' : '');

    let remark = name + ' finishes ' + last.semName + ' with a weighted final of ' + f1(last.final) + '% (' + (last.letter || '–') + ')';
    remark += clsFinal !== null ? ', ' + (last.final >= clsFinal ? 'above' : 'below') + ' the class average of ' + f1(clsFinal) + '%.' : '.';
    if (best && worst && best.k !== worst.k) remark += ' Strongest area: ' + best.k + ' (' + f1(best.v) + '%); most in need of support: ' + worst.k + ' (' + f1(worst.v) + '%).';
    if (prev) {
      if (delta === null) remark += ' No comparable final for ' + prev.semName + '.';
      else if (delta > 1) remark += ' Since ' + prev.semName + ', the overall score has improved by ' + f1(delta) + ' points — well done.';
      else if (delta < -1) remark += ' Since ' + prev.semName + ', the overall score has slipped by ' + f1(-delta) + ' points.';
      else remark += ' The overall score has held steady since ' + prev.semName + '.';
    }
    if (last.rank) remark += ' Class rank: ' + last.rank + ' of ' + last.total + '.';
    if (worst) remark += ' Next step: focus on ' + worst.k.toLowerCase() + ', where ' + name + ' is furthest from the class average.';
    if (last.missing && last.missing.length) remark += ' Note: ' + last.missing.join(', ') + ' not yet graded.';

    if (provisional && remark) remark = 'Provisional — based on ' + last.assessed + ' of 9 components. ' + remark;
    return {
      sid: sid, name: name,
      last: last, prev: prev, delta: delta, overallRag: overallRag,
      ragName: overallRag ? RAG_NAME[overallRag] : null,
      provisional: provisional,
      strengths: strengths.map(bullet), weaknesses: weaknesses.map(bullet),
      opportunities: opportunities.map(bullet), threats: threats.map((t) =>
        t.k.indexOf('Ungraded') === 0 ? t.k : t.k + ' — ' + f1(t.v) + '%' + (t.d !== null && t.d !== undefined ? ' (' + f1(t.d) + ' vs ' + (prev ? prev.semName : '') + ')' : '')),
      remark: remark,
    };
  }

  /* class SWOT text (compact) */
  function classSwotText(db) {
    const s = classSummary(db);
    if (!s) return null;
    let t = 'Class finishes ' + s.last.semName + ' with a final average of ' + f1(s.last.final) + '%';
    if (s.delta !== null) t += s.delta >= 0 ? ' (up ' + f1(s.delta) + ' pts from ' + s.prev.semName + ')' : ' (down ' + f1(-s.delta) + ' pts from ' + s.prev.semName + ')';
    t += '. Strongest: ' + s.best.join(', ') + '. Weakest: ' + s.worst.join(', ') + '.';
    return t;
  }

  return {
    COMPONENTS: COMPONENTS, SHORT: SHORT, RAG_NAME: RAG_NAME,
    rag: rag, ragOverall: ragOverall, finalStatus: finalStatus,
    classSemesterRows: classSemesterRows, classAvgParts: classAvgParts,
    movers: movers, classSummary: classSummary, classSwotText: classSwotText,
    studentSemesterRows: studentSemesterRows, studentMatrix: studentMatrix,
    swot: swot, f1: f1, r1: r1,
  };
});
