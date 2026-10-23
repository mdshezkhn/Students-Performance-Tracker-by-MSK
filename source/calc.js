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

  /* ---------- score validity (single source of truth) -------------------
     Workbook rules: an observation raw score is out of 10; weekly/test cells
     are score/total pairs with 0 <= score <= total and total > 0. Ingress
     paths (grid entry, paste, Excel import, backup restore) must REJECT
     values that fail these rules; and for anything that still slips into
     stored data (legacy saves, hand-edited backups) the calc engine treats
     the value as absent instead of counting it — a blank score next to a
     filled total is NOT a zero score. -------------------------------------- */
  const EMPTY = (x) => x === null || x === undefined || x === '';
  function validObs(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 10;
  }
  function validScore(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0;
  }
  function validTotal(v) {
    return typeof v === 'number' && isFinite(v) && v > 0;
  }
  function validPair(s, t) {
    return validScore(s) && validTotal(t) && s <= t;
  }

  function student(sem, sid) {
    return (sem.students || []).find((s) => s.id === sid) || null;
  }

  /* ---------- Classroom Observations ---------- */
  // raw LO value for one month/skill/lo (invalid stored values read as absent)
  function obsValue(sem, sid, month, skill, lo) {
    const v = (sem.observations[sid] && sem.observations[sid][month] &&
               sem.observations[sid][month][skill + '-LO' + lo]) ?? null;
    return validObs(v) ? v : null;
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

  // month % = Σscore / Σtotal * 100 (weeks with a valid score/total pair)
  function weeklyMonthPct(sem, sid, metric, month) {
    const rec = sem[metric] && sem[metric][sid] && sem[metric][sid][month];
    if (!rec) return null;
    let s = 0, t = 0, any = false;
    for (const w of Object.keys(rec)) {
      const e = rec[w];
      if (!e || EMPTY(e.s)) continue;               // no score -> not assessable
      if (EMPTY(e.t)) continue;                     // score without total: cannot include
      const sc = Number(e.s), tt = Number(e.t);
      if (validPair(sc, tt)) { s += sc; t += tt; any = true; }
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
        const pct = (!e || EMPTY(e.s) || EMPTY(e.t))
          ? null
          : (validPair(Number(e.s), Number(e.t)) ? (Number(e.s) / Number(e.t)) * 100 : null);
        out.push({ label: m.slice(0, 3) + ' W' + w, pct });
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
    if (EMPTY(t.s) || EMPTY(t.t)) return null;      // blank score or total -> no %
    const sc = Number(t.s), tt = Number(t.t);
    if (!validPair(sc, tt)) return null;
    return (sc / tt) * 100;
  }


  /* ---------- Assessment completeness (single source of truth) ----------
     A component counts as assessed only when the existing validity rules
     produced a component percentage (parts[k] !== null): e.g. a weekly
     metric needs >=1 month with a positive total; a test needs valid score
     AND total. A genuine teacher-entered score of 0 is valid evidence
     (parts === 0) and is NEVER treated as missing. ------------------------- */
  const COMPONENTS_ALL = ['Listening', 'Speaking', 'Writing', 'Reading', 'Spelling',
    'Daily Assignments', 'Mid-Term', 'Oral', 'Written'];
  const FINAL_MIN_ASSESSED = 6; // school rule: <6 of 9 assessed => no final result

  function assessedCount(g) {
    let n = 0;
    for (const k of COMPONENTS_ALL) if (g.parts && g.parts[k] !== null && g.parts[k] !== undefined) n++;
    return n;
  }

  function getAssessmentCompleteness(sem, sid) {
    const g = gradeStudent(sem, sid);
    const assessed = [], missing = [];
    for (const k of COMPONENTS_ALL) (g.parts[k] === null || g.parts[k] === undefined ? missing : assessed).push(k);
    const n = assessed.length, total = COMPONENTS_ALL.length;
    return {
      assessedComponentCount: n,
      totalComponentCount: total,
      isProvisional: n < total,
      completionRatio: n / total,
      assessedComponentNames: assessed,
      missingComponentNames: missing,
      gate: n < FINAL_MIN_ASSESSED ? 'not-assessed' : (n < total ? 'provisional' : 'final'),
    };
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

  // class average of final scores — only students meeting the >=6 assessed-components gate
  function classFinalAvg(sem) {
    const vals = gradeAll(sem).filter((g) => assessedCount(g) >= FINAL_MIN_ASSESSED).map((g) => g.final);
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
    for (const g of gradeAll(sem)) if (g.letter && assessedCount(g) >= FINAL_MIN_ASSESSED) dist[g.letter]++;
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
      if (assessedCount(g) < FINAL_MIN_ASSESSED) continue; // missing data is not low attainment
      const reasons = [];
      if (g.final !== null && g.final < 50) reasons.push('final ' + g.final);
      if (g.missing.length >= 2) reasons.push(g.missing.length + ' ungraded parts');
      const core = ['Spelling', 'Written', 'Mid-Term'];
      for (const c of core) if (g.parts[c] !== null && g.parts[c] < 50) reasons.push(c + ' ' + Math.round(g.parts[c]));
      if (reasons.length) out.push({ sid: g.sid, reasons });
    }
    return out;
  }

  /* ---------- sanitize stored semester data (self-healing) ----------------
     Walks every stored score and brings it to the valid canonical form:
     - numeric strings ("8") are coerced to numbers;
     - observation values outside 0..10 are dropped;
     - score/total pairs: an invalid total drops the entry, an invalid score
       (negative, non-finite, > total) drops the score but keeps a valid total;
     - empty leftovers are pruned.
     Returns the number of stored VALUES removed (0 = already clean).
     Grading rules are untouched — this only removes values that could never
     have come from the school's workbook. ---------------------------------- */
  const coerceNum = (x) => (typeof x === 'string' && x.trim() !== '' && !isNaN(Number(x)) ? Number(x) : x);
  /* Quarantines invalid scores instead of destroying them: each moved value is
     recorded as {area, sid, month, key, value, reason} and the live cell is
     cleared so grades stay correct. Returns the array of moved items (empty =
     nothing wrong). Callers decide where the review list lives (sem.review). */
  function sanitizeSemester(sem) {
    const moved = [];
    const note = (area, sid, month, key, value, reason) =>
      moved.push({ area: area, sid: sid, month: month || null, key: key, value: value, reason: reason });
    const fixPair = (e, area, sid, month, key) => {   // e = {s,t} holder (mutated)
      e.s = coerceNum(e.s); e.t = coerceNum(e.t);
      // invalid total (present but unusable) -> clear it, keep the score for later
      if (!EMPTY(e.t) && !validTotal(e.t)) { note(area, sid, month, key + ':t', e.t, 'total must be a positive number'); e.t = null; }
      // invalid score (present but negative/non-finite/above total) -> clear it, keep total
      if (!EMPTY(e.s) && (!validScore(e.s) || (!EMPTY(e.t) && e.s > e.t))) {
        note(area, sid, month, key + ':s', e.s, (!EMPTY(e.t) && e.s > e.t) ? 'score above total' : 'score must be 0 or more');
        e.s = null;
      }
      return (EMPTY(e.s) && EMPTY(e.t));   // nothing left -> caller deletes
    };
    for (const sid of Object.keys(sem.observations || {})) {
      for (const m of Object.keys(sem.observations[sid])) {
        const cell = sem.observations[sid][m];
        for (const k of Object.keys(cell)) {
          const v = coerceNum(cell[k]);
          if (EMPTY(v)) { delete cell[k]; continue; }          // absent -> prune, not "invalid"
          if (!validObs(v)) { note('obs', sid, m, k, v, 'observation scores are 0-10'); delete cell[k]; continue; }
          cell[k] = v;
        }
        if (!Object.keys(cell).length) delete sem.observations[sid][m];
      }
      if (!Object.keys(sem.observations[sid] || {}).length) delete sem.observations[sid];
    }
    for (const metric of ['spelling', 'daily']) {
      for (const sid of Object.keys(sem[metric] || {})) {
        for (const m of Object.keys(sem[metric][sid])) {
          const rec = sem[metric][sid][m];
          for (const w of Object.keys(rec)) if (!rec[w] || fixPair(rec[w], metric, sid, m, 'week ' + w)) delete rec[w];
          if (!Object.keys(rec).length) delete sem[metric][sid][m];
        }
        if (!Object.keys(sem[metric][sid] || {}).length) delete sem[metric][sid];
      }
    }
    for (const sid of Object.keys(sem.tests || {})) {
      for (const kind of Object.keys(sem.tests[sid])) {
        if (fixPair(sem.tests[sid][kind], 'test', sid, null, kind)) delete sem.tests[sid][kind];
      }
      if (!Object.keys(sem.tests[sid]).length) delete sem.tests[sid];
    }
    return moved;
  }

  return {
    SKILLS, TESTS, COMPONENTS_ALL, FINAL_MIN_ASSESSED,
    assessedCount, getAssessmentCompleteness,
    letter, mean, round1, student,
    validObs, validScore, validTotal, validPair, sanitizeSemester,
    obsValue, obsMonthPct, obsMonthPctOverall, obsSkillPct,
    weeksWithData, weeklyMonthPct, weeklyPctList, weeklySemesterPct,
    testPct, gradeStudent, gradeAll,
    classComponentAvg, classFinalAvg, classMonthPct, classSkillAvgs, classTestAvg,
    gradeDistribution, completeness, atRisk,
  };
});
