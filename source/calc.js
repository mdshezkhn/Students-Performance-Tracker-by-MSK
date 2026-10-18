/* =========================================================================
   ESL Markbook — calculation engine (pure functions, no DOM)
   Replicates the school's SPR Excel workbook logic exactly:
   - Classroom Observations: each LO scored /10, monthly per skill
       semester % per skill = AVERAGE(all LO raw scores across months) * 10
   - Spelling / Daily Assignment: weekly score/total per month
       month %  = sum(scores) / sum(totals) * 100
       semester % = AVERAGE(month %) over months that have data
   - Tests: Mid-Term / Oral / Written  → score/total*100
   - Letter grade: >84 A*, >74 A, >64 B, >54 C, >49 D, else U
   - Final score = 0.1*(Listen+Speak+Write+Read+Spell+Daily+MidTerm+Oral)
                   + 0.2*Written      (missing components count as 0)
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SKILLS = ['Listening', 'Speaking', 'Writing', 'Reading'];
  const METRICS = { spelling: 'Spelling', daily: 'Daily Assignment' };
  const TESTS = ['midterm', 'oral', 'written'];

  // Excel: IF(x>84,"A*",IF(x>74,"A",IF(x>64,"B",IF(x>54,"C",IF(x>49,"D",IF(x>=0,"U"))))))
  function letter(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return null;
    if (pct > 84) return 'A*';
    if (pct > 74) return 'A';
    if (pct > 64) return 'B';
    if (pct > 54) return 'C';
    if (pct > 49) return 'D';
    return 'U';
  }

  /* ---------- helpers ---------- */
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

  function student(sem, sid) {
    return (sem.students || []).find((s) => s.id === sid) || null;
  }

  /* ---------- Classroom Observations ---------- */
  // raw LO value for one month/skill/lo
  function obsValue(sem, sid, month, skill, lo) {
    return (sem.observations[sid] && sem.observations[sid][month] &&
            sem.observations[sid][month][skill + '-LO' + lo]) ?? null;
  }

  // month % for one skill = mean(LO1, LO2) * 10, null if no data that month
  function obsMonthPct(sem, sid, month, skill) {
    const v1 = obsValue(sem, sid, month, skill, 1);
    const v2 = obsValue(sem, sid, month, skill, 2);
    const vals = [v1, v2].filter((v) => v !== null && !isNaN(v));
    if (!vals.length) return null;
    return mean(vals) * 10;
  }

  // month % overall (all 8 LO cells)
  function obsMonthPctOverall(sem, sid, month) {
    const vals = [];
    for (const sk of SKILLS) for (const lo of [1, 2]) {
      const v = obsValue(sem, sid, month, sk, lo);
      if (v !== null && !isNaN(v)) vals.push(v);
    }
    if (!vals.length) return null;
    return mean(vals) * 10;
  }

  // semester % per skill — Excel: AVERAGE of every LO raw score across months, *10
  function obsSkillPct(sem, sid, skill) {
    const vals = [];
    for (const m of sem.months) for (const lo of [1, 2]) {
      const v = obsValue(sem, sid, m, skill, lo);
      if (v !== null && !isNaN(v)) vals.push(v);
    }
    if (!vals.length) return null;
    return mean(vals) * 10;
  }

  /* ---------- Spelling / Daily Assignment (weekly) ---------- */
  function weeksWithData(sem, sid, metric, month) {
    const rec = sem[metric] && sem[metric][sid] && sem[metric][sid][month];
    if (!rec) return [];
    return Object.keys(rec)
      .map(Number)
      .filter((w) => {
        const e = rec[w];
        return e && (e.s !== null && e.s !== undefined || e.t !== null && e.t !== undefined);
      })
      .sort((a, b) => a - b);
  }

  // month % = Σscore / Σtotal * 100 (weeks with a positive total)
  function weeklyMonthPct(sem, sid, metric, month) {
    const rec = sem[metric] && sem[metric][sid] && sem[metric][sid][month];
    if (!rec) return null;
    let s = 0, t = 0, any = false;
    for (const w of Object.keys(rec)) {
      const e = rec[w];
      if (!e) continue;
      const sc = Number(e.s), tt = Number(e.t);
      if (!isNaN(sc) && !isNaN(tt) && tt > 0) { s += sc; t += tt; any = true; }
      else if (!isNaN(sc) && (e.t === null || e.t === undefined) && sc >= 0 && e.s !== null && e.s !== undefined) {
        // score entered without total — cannot include, flag separately
        any = any || false;
      }
    }
    if (!any || t === 0) return null;
    return (s / t) * 100;
  }

  // per-week % for charts: {week, pct}
  function weeklyPctList(sem, sid, metric) {
    const out = [];
    for (const m of sem.months) {
      for (const w of weeksWithData(sem, sid, metric, m)) {
        const e = sem[metric][sid][m][w];
        const sc = Number(e.s), tt = Number(e.t);
        out.push({
          label: m.slice(0, 3) + ' W' + w,
          pct: !isNaN(sc) && !isNaN(tt) && tt > 0 ? (sc / tt) * 100 : null,
        });
      }
    }
    return out;
  }

  // semester % = mean of month % over months with data (Excel AVERAGE of month avgs)
  function weeklySemesterPct(sem, sid, metric) {
    const pcts = sem.months
      .map((m) => weeklyMonthPct(sem, sid, metric, m))
      .filter((p) => p !== null);
    return mean(pcts);
  }

  /* ---------- Tests ---------- */
  function testPct(sem, sid, kind) {
    const t = sem.tests && sem.tests[sid] && sem.tests[sid][kind];
    if (!t) return null;
    const sc = Number(t.s), tt = Number(t.t);
    if (isNaN(sc) || isNaN(tt) || tt <= 0) return null;
    return (sc / tt) * 100;
  }

  /* ---------- Full grading ---------- */
  function gradeStudent(sem, sid) {
    const skills = {};
    for (const sk of SKILLS) skills[sk] = obsSkillPct(sem, sid, sk);
    const spelling = weeklySemesterPct(sem, sid, 'spelling');
    const daily = weeklySemesterPct(sem, sid, 'daily');
    const midterm = testPct(sem, sid, 'midterm');
    const oral = testPct(sem, sid, 'oral');
    const written = testPct(sem, sid, 'written');

    const parts = {
      Listening: skills.Listening, Speaking: skills.Speaking,
      Writing: skills.Writing, Reading: skills.Reading,
      Spelling: spelling, 'Daily Assignments': daily,
      'Mid-Term': midterm, Oral: oral, Written: written,
    };
    const missing = Object.keys(parts).filter((k) => parts[k] === null);

    let final = 0, wsum = 0;
    for (const k of Object.keys(parts)) {
      const w = k === 'Written' ? 0.2 : 0.1;
      final += (parts[k] === null ? 0 : parts[k]) * w;
      wsum += w;
    }
    return {
      sid, skills, spelling, daily, midterm, oral, written,
      parts, missing,
      final: wsum ? final : null,   // full precision; round at display time
      letter: letter(final),
    };
  }

  /* ---------- Class aggregates ---------- */
  function gradeAll(sem) {
    return sem.students.map((s) => gradeStudent(sem, s.id));
  }

  // class average pct for one component ('Listening' | 'Spelling' | 'Mid-Term' ...)
  function classComponentAvg(sem, component) {
    const vals = gradeAll(sem)
      .map((g) => g.parts[component])
      .filter((v) => v !== null);
    return mean(vals);
  }

  // class average of final scores (students with any data)
  function classFinalAvg(sem) {
    const vals = gradeAll(sem).filter((g) => g.missing.length < 9).map((g) => g.final);
    return mean(vals);
  }

  // class avg per month for a weekly metric; and obs overall per month
  function classMonthPct(sem, metric /* 'spelling'|'daily'|'obs' */, month) {
    const vals = [];
    for (const s of sem.students) {
      const v = metric === 'obs'
        ? obsMonthPctOverall(sem, s.id, month)
        : weeklyMonthPct(sem, s.id, metric, month);
      if (v !== null) vals.push(v);
    }
    return mean(vals);
  }

  // class avg of each skill % (for radar overlay)
  function classSkillAvgs(sem) {
    const out = {};
    for (const sk of SKILLS) {
      out[sk] = mean(
        sem.students.map((s) => obsSkillPct(sem, s.id, sk)).filter((v) => v !== null)
      );
    }
    return out;
  }

  function classTestAvg(sem, kind) {
    return mean(sem.students.map((s) => testPct(sem, s.id, kind)).filter((v) => v !== null));
  }

  // grade distribution {A*:n, A:n, ...}
  function gradeDistribution(sem) {
    const dist = { 'A*': 0, A: 0, B: 0, C: 0, D: 0, U: 0 };
    for (const g of gradeAll(sem)) if (g.letter) dist[g.letter]++;
    return dist;
  }

  // data completeness per metric: fraction of expected cells filled
  function completeness(sem) {
    const nStu = sem.students.length;
    const res = { obs: 0, spelling: 0, daily: 0, tests: 0 };
    if (!nStu) return res;
    let obsCells = 0, obsFill = 0;
    for (const s of sem.students) {
      for (const m of sem.months) for (const sk of SKILLS) for (const lo of [1, 2]) {
        obsCells++;
        if (obsValue(sem, s.id, m, sk, lo) !== null) obsFill++;
      }
      for (const m of sem.months) for (const w of [1, 2, 3, 4, 5]) {
        for (const metric of ['spelling', 'daily']) {
          const e = sem[metric][s.id] && sem[metric][s.id][m] && sem[metric][s.id][m][w];
          res[metric === 'spelling' ? 'spellingCells' : 'dailyCells'] =
            (res[metric === 'spelling' ? 'spellingCells' : 'dailyCells'] || 0) + 1;
          if (e && e.s !== null && e.s !== undefined) res[metric === 'spelling' ? 'spFill' : 'dailyFill'] =
            (res[metric === 'spelling' ? 'spFill' : 'dailyFill'] || 0) + 1;
        }
      }
      for (const k of TESTS) {
        res.testCells = (res.testCells || 0) + 1;
        if (sem.tests[s.id] && sem.tests[s.id][k]) res.tests++;
      }
    }
    res.obs = obsCells ? obsFill / obsCells : 0;
    res.spelling = res.spellingCells ? (res.spFill || 0) / res.spellingCells : 0;
    res.daily = res.dailyCells ? (res.dailyFill || 0) / res.dailyCells : 0;
    res.tests = res.testCells ? res.tests / res.testCells : 0;
    return res;
  }

  // at-risk: final < 50, or 2+ missing components, or any core pct < 50
  function atRisk(sem) {
    const out = [];
    for (const g of gradeAll(sem)) {
      const reasons = [];
      if (g.final !== null && g.final < 50) reasons.push('final ' + g.final);
      if (g.missing.length >= 2) reasons.push(g.missing.length + ' ungraded parts');
      const core = ['Spelling', 'Written', 'Mid-Term'];
      for (const c of core) if (g.parts[c] !== null && g.parts[c] < 50) reasons.push(c + ' ' + Math.round(g.parts[c]));
      if (reasons.length) out.push({ sid: g.sid, reasons });
    }
    return out;
  }

  return {
    SKILLS, TESTS,
    letter, mean, round1, student,
    obsValue, obsMonthPct, obsMonthPctOverall, obsSkillPct,
    weeksWithData, weeklyMonthPct, weeklyPctList, weeklySemesterPct,
    testPct, gradeStudent, gradeAll,
    classComponentAvg, classFinalAvg, classMonthPct, classSkillAvgs, classTestAvg,
    gradeDistribution, completeness, atRisk,
  };
});
