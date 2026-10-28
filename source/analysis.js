/* =========================================================================
   Student's Performance Report: comparative analysis engine (pure, no DOM)
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
  const RAG_NAME = { G: 'Secure / on track', A: 'Developing', R: 'Priority support' }; /* teacher triage language */
  const RAG_PARENT = { G: 'Secure', A: 'Developing', R: 'Needs focused support' };
  const MIN_CLASS_N = 5;      /* pupils with valid data before a class-level conclusion */
  const MIN_TREND_EVENTS = 3; /* comparable events for a labelled student trend */

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

  /* ---------------- evidence thresholds & child-centred reporting ---------------- */
  const OBS_SKILLS = ['Listening', 'Speaking', 'Writing', 'Reading'];

  /* number of distinct recorded assessment events behind one component
     (obs: months with >=1 LO value; weekly: weeks with a valid score/total;
     tests: 1 when present). A single number is a data point, not a pattern. */
  function componentEvents(sem, sid, k) {
    if (OBS_SKILLS.indexOf(k) >= 0) {
      let n = 0;
      for (const m of sem.months) {
        let any = false;
        for (const lo of [1, 2]) if (Calc.obsValue(sem, sid, m, k, lo) !== null) any = true;
        if (any) n++;
      }
      return n;
    }
    if (k === 'Spelling' || k === 'Daily Assignments') {
      const met = k === 'Spelling' ? 'spelling' : 'daily';
      return Calc.weeklyPctList(sem, sid, met).filter((w) => w.pct !== null).length;
    }
    const kind = k === 'Mid-Term' ? 'midterm' : k === 'Oral' ? 'oral' : 'written';
    return Calc.testPct(sem, sid, kind) !== null ? 1 : 0;
  }

  /* class average for one component, with the evidence count — means never
     include missing data as zero (existing parts rule) */
  function classComponentStats(sem, k) {
    const vals = Calc.gradeAll(sem).map((g) => g.parts[k]).filter((v) => v !== null);
    return { n: vals.length, avg: vals.length ? mean(vals) : null };
  }

  /* chronological comparable points for the per-student progress line */
  function componentPointList(sem, sid, k) {
    const pts = [];
    if (OBS_SKILLS.indexOf(k) >= 0) {
      for (const m of sem.months) {
        const v = Calc.obsMonthPct(sem, sid, m, k);
        if (v !== null) pts.push({ label: U.MONTH_ABBR[m] || m, pct: v });
      }
    } else if (k === 'Spelling' || k === 'Daily Assignments') {
      const met = k === 'Spelling' ? 'spelling' : 'daily';
      for (const w of Calc.weeklyPctList(sem, sid, met)) if (w.pct !== null) pts.push(w);
    } else {
      const kind = k === 'Mid-Term' ? 'midterm' : k === 'Oral' ? 'oral' : 'written';
      const v = Calc.testPct(sem, sid, kind);
      if (v !== null) pts.push({ label: k, pct: v });
    }
    return pts;
  }

  /* trend verdict from comparable points: >=3 => Improving/Stable/Review with
     the calculation; 2 => cautious early-indication wording; never a claim
     from one point */
  function trendVerdict(points) {
    const pts = points.filter((x) => x.pct !== null);
    if (pts.length < 2) return null;
    const d = pts[pts.length - 1].pct - pts[0].pct;
    const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const nTxt = pts.length <= 10 ? words[pts.length] : String(pts.length);
    if (pts.length === 2) {
      return { label: null, calc: 'Early indication: ' + (d >= 0 ? '+' : '') + f1(d) + ' points across two comparable checks.' };
    }
    let label = 'Stable';
    if (d > 3) label = 'Improving';
    else if (d < -3) label = 'Review';
    return { label: label, calc: (d >= 0 ? '+' : '') + f1(d) + ' points across ' + nTxt + ' comparable checks.' };
  }

  /* explain a student's overall RAG: rule, evidence, trend influence, action */
  function ragWhy(sem, sid, db) {
    const fs = finalStatus(sem, sid);
    if (fs.finalScore === null) {
      return { title: 'Not yet assessed', body: 'This student has ' + fs.assessedComponentCount + ' of 9 components with recorded assessment data. Final grades and status colours appear once at least 6 components are assessed. Missing data is never treated as low achievement.' };
    }
    const c = sem.students.find((x) => x.id === sid);
    const name = c ? (c.nameEn || c.nameCn) : sid;
    const rowsSem = db ? studentSemesterRows(db, sid) : null;
    const prev = rowsSem && rowsSem.length > 1 ? rowsSem[rowsSem.length - 2] : null;
    let trendTxt = '';
    if (prev && prev.assessed >= Calc.FINAL_MIN_ASSESSED) {
      const d = fs.finalScore - prev.final;
      if (d <= -8 || d >= 8) {
        trendTxt = ' Trend rule: ' + (d >= 0 ? '+' : '') + f1(d) + ' points vs ' + prev.semName + ' adjusted the label one step (' + (d >= 0 ? 'rise' : 'decline') + ' of 8+ points).';
      }
    }
    let action = '';
    let worst = null;
    for (const k of COMPONENTS) {
      const v = Calc.gradeStudent(sem, sid).parts[k];
      const ev = componentEvents(sem, sid, k);
      if (v !== null && v < 55 && ev >= 1 && (!worst || v < worst.v)) worst = { k: k, v: v, ev: ev };
    }
    if (fs.ragStatus !== 'G' && worst) {
      action = ' Next step: focus on ' + worst.k.toLowerCase() + ' (' + f1(worst.v) + '% across ' + worst.ev + ' recorded ' + (worst.ev === 1 ? 'task' : 'tasks') + ').';
    }
    return {
      title: RAG_NAME[fs.ragStatus],
      body: f1(fs.finalScore) + '% across ' + fs.assessedComponentCount + ' of 9 assessed components. Bands: Secure 75+, Developing 55-74.9, Priority support below 55.' + trendTxt + action,
    };
  }

  /* whole-class reteaching priorities: lowest valid averages, n>=5 rule */
  function classTeachingPriorities(sem) {
    const rows = COMPONENTS.map((k) => { const st = classComponentStats(sem, k); return { k: k, avg: st.avg, n: st.n }; })
      .filter((r) => r.avg !== null)
      .sort((a, b) => a.avg - b.avg);
    const ready = rows.filter((r) => r.n >= MIN_CLASS_N);
    if (!ready.length) return { list: rows, focus: [], text: 'Not enough evidence for a class conclusion (needs at least ' + MIN_CLASS_N + ' pupils assessed in a component).' };
    const focus = ready.slice(0, 2);
    return {
      list: rows, focus: focus,
      text: focus.map((r) => 'Whole-class focus: ' + r.k + ': ' + f1(r.avg) + '% across ' + r.n + ' assessed pupils.').join(' '),
    };
  }

  /* ---- child-centred report sections (evidence-based, editable upstream) ---- */
  const STRENGTH_TXT = {
    'Listening': 'Follows classroom instructions and spoken texts with confidence.',
    'Speaking': 'Participates confidently in familiar speaking activities.',
    'Writing': 'Produces written work with growing confidence and accuracy.',
    'Reading': 'Reads short familiar texts accurately and identifies key details.',
    'Spelling': 'Spells high-frequency words accurately in weekly checks.',
    'Daily Assignments': 'Completes daily assignments consistently well.',
    'Mid-Term': 'Performed strongly in the Mid-Term assessment.',
    'Oral': 'Spoke clearly and confidently in the Oral assessment.',
    'Written': 'Produced a strong Written assessment paper.',
  };
  const STEP_TXT = {
    'Listening': 'Practise following multi-step spoken instructions.',
    'Speaking': 'Build confidence when answering questions using complete sentences.',
    'Writing': 'Practise using capital letters and full stops consistently in short sentences.',
    'Reading': 'Re-read short texts and retell the main events.',
    'Spelling': 'Review common vowel patterns in weekly spelling practice.',
    'Daily Assignments': 'Build a careful routine for completing daily assignments.',
    'Mid-Term': 'Review this term\u2019s topics before the next assessment.',
    'Oral': 'Practise short spoken answers with a partner.',
    'Written': 'Plan short written answers before starting to write.',
  };
  const SUPPORT_TXT = {
    'Listening': 'The teacher will use short listening games with clear step-by-step instructions.',
    'Speaking': 'The teacher will provide daily talking prompts and partner practice.',
    'Writing': 'The teacher will provide sentence frames during guided writing and review one punctuation target each week.',
    'Reading': 'The teacher will use guided reading in a small group.',
    'Spelling': 'The teacher will use small-group phonics practice and short weekly spelling checks.',
    'Daily Assignments': 'The teacher will provide a short daily checklist and check in each week.',
    'Mid-Term': 'The teacher will provide guided revision of this term\u2019s work.',
    'Oral': 'The teacher will give regular opportunities to speak in pairs and small groups.',
    'Written': 'The teacher will model short planning before written tasks.',
  };
  const HOME_TXT = {
    'Listening': 'Ask your child to follow two short instructions in English each day, e.g. during play or cooking.',
    'Speaking': 'Encourage your child to describe one part of their day using a complete English sentence.',
    'Writing': 'Write two or three short English sentences together, checking capital letters and full stops.',
    'Reading': 'Read a short English story together and ask your child to retell three key events.',
    'Spelling': 'Practise five high-frequency words for a few minutes, three times a week.',
    'Daily Assignments': 'Check the daily assignment together each evening and praise careful work.',
    'Mid-Term': 'Chat briefly about what your child is learning in English this term.',
    'Oral': 'Ask your child one or two simple questions in English each day.',
    'Written': 'Encourage your child to write one true sentence about their day.',
  };

  function reportSections(sem, sid) {
    /* 2026-10-25 (owner request): practical, positive, score-driven comments.
       Uses the SAME component values the Skill-overview table shows
       (Calc.gradeStudent -> parts), grades via Calc.letter. Never claims
       "not enough assessed work" while real scores exist. */
    const g = Calc.gradeStudent(sem, sid);
    const L = Calc.letter;
    const ev = {};
    for (const k of COMPONENTS) ev[k] = componentEvents(sem, sid, k);
    const evidence = COMPONENTS
      .map((k) => ({ k: k, pct: g.parts[k], ev: ev[k] }))
      .filter((x) => x.pct !== null && x.ev >= 1);
    const empty = {
      strengths: [], steps: [], support: '', home: '', overall: '',
      inProgress: true, note: 'Assessment is still in progress: no scores recorded yet.',
    };
    if (!evidence.length) return empty;
    const desc = evidence.slice().sort((a, b) => b.pct - a.pct);
    const bandWord = (pct) => {
      const l = L(pct);
      if (l === 'A*') return 'outstanding';
      if (l === 'A') return 'strong';
      if (l === 'B') return 'good, steady';
      if (l === 'C') return 'developing';
      if (l === 'D') return 'early';
      return 'emerging';
    };
    const gradeBit = (x) => 'grade ' + L(x.pct) + ' · ' + f1(x.pct) + '% across ' + x.ev + ' recorded ' + (x.ev === 1 ? 'task' : 'tasks');
    /* strengths: the child's genuinely best areas, worded by how strong */
    const nm = possName(sem, sid);
    const strengths = desc.slice(0, Math.min(3, Math.max(2, desc.length)))
      .map((x) => {
        const band = bandWord(x.pct);
        const art = band === 'outstanding' ? 'an outstanding' : 'a ' + band;
        const variants = [
          STRENGTH_TXT[x.k] + ' ' + NAME_CAP[x.k] + ' is ' + art + ' area for ' + nm + '.',
          nm + ' does ' + band + ' work in ' + lowerFirst(NAME_CAP[x.k]) + '.',
        ];
        if (band === 'outstanding' || band === 'strong') variants.push(nm + '\u2019s ' + lowerFirst(NAME_CAP[x.k]) + ' is a clear strength this term.');
        return { k: x.k, pct: x.pct, ev: x.ev,
          text: pickVariant(variants, nm + '|' + x.k + '|' + Math.round(x.pct)),
          evidence: gradeBit(x) };
      });
    /* steps: real focus areas = the lowest scores; practical, never empty
       while data exists. Below C the wording gets concrete; otherwise the
       lowest area becomes an extension challenge. */
    const inS = (x) => strengths.some((s2) => s2.k === x.k);
    let weak = desc.filter((x) => x.pct < 70 && !inS(x)).sort((a, b) => a.pct - b.pct).slice(0, 2);
    if (!weak.length) { const rest = desc.filter((x) => !inS(x)); weak = [rest.length ? rest[rest.length - 1] : desc[desc.length - 1]]; }
    const steps = weak
      .map((x) => {
        const lead = x.pct < 50 ? 'Priority: ' : 'Next focus: ';
        const variants = [
          lead + STEP_TXT[x.k],
          lowerFirst(NAME_CAP[x.k]) + ' is the next focus: ' + lowerFirst(STEP_TXT[x.k]),
          'More practice with ' + lowerFirst(NAME_CAP[x.k]) + ' will help: ' + lowerFirst(STEP_TXT[x.k]),
        ];
        return { k: x.k, pct: x.pct, ev: x.ev,
          text: pickVariant(variants, possName(sem, sid) + '|step|' + x.k + '|' + Math.round(x.pct)),
          evidence: gradeBit(x) };
      });
    const first = steps[0] || strengths[0];
    const support = first ? SUPPORT_TXT[first.k] : 'The teacher will keep monitoring progress and provide support as needed.';
    const home = first ? HOME_TXT[first.k] : 'Keep encouraging regular short English practice at home.';
    return {
      inProgress: false,
      strengths: strengths,
      steps: steps,
      support: support,
      home: home,
      overall: overallText(sem, sid, g, strengths, steps),
      note: '',
    };
  }

  /* B3 (2026-10-28): 2-3 phrasings per slot so two students with the same
     grade band do not read identically. The pick is deterministic (a hash of
     the student's name and the component), so a given student always gets the
     same wording on reprints. */
  function pickVariant(variants, seed) {
    let h = 2166136261;
    const str = String(seed);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return variants[h % variants.length];
  }
  const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);

  function possName(sem, sid) {
    const stu = sem.students.find((x) => x.id === sid);
    return stu ? (stu.nameEn || stu.nameCn || 'this student') : 'this student';
  }
  const NAME_CAP = { 'Listening': 'Listening', 'Speaking': 'Speaking', 'Writing': 'Writing', 'Reading': 'Reading',
    'Spelling': 'Spelling', 'Daily Assignments': 'Daily work', 'Mid-Term': 'Mid-Term work', 'Oral': 'Oral work', 'Written': 'Written work' };
  function overallText(sem, sid, g, strengths, steps) {
    const name = possName(sem, sid);
    const pct = g.final === null ? null : Math.round(g.final * 10) / 10;
    const L = g.letter || (pct === null ? null : Calc.letter(pct));
    const bandOpen = pickVariant((L === 'A*' || L === 'A')
      ? [name + ' has had an excellent term in English', name + ' has done very good work in English this term', name + ' ends the term with a strong result in English']
      : L === 'B'
      ? [name + ' has had a good term in English', name + ' has made solid progress in English this term']
      : L === 'C'
      ? [name + ' is making steady progress in English', name + ' is moving forward steadily in English']
      : [name + ' is building the foundations of English', name + ' has worked on the basics of English this term'], name + '|open|' + (L || ''));
    const strongBit = strengths.length ? pickVariant([', with ' + strengths[0].k.toLowerCase() + ' the strongest area (grade ' + Calc.letter(strengths[0].pct) + ')', ', strongest in ' + strengths[0].k.toLowerCase() + ' (grade ' + Calc.letter(strengths[0].pct) + ')'], name + '|strong|' + (strengths[0] ? strengths[0].k : '')) : '';
    const stepBit = steps.length ? pickVariant([
      ' The next step is ' + steps[0].k.toLowerCase() + ': ' + steps[0].text.replace(/^(Priority|Next focus): /, '').replace(/\.$/, '').toLowerCase() + '.',
      ' Looking ahead, ' + steps[0].k.toLowerCase() + ' is where practice will pay off most.',
    ], name + '|step0|' + (steps[0] ? steps[0].k : '')) : ' Keep up the regular practice.';
    const close = !L || L === 'U' || L === 'D' ? ' With short, regular practice at home and in class, ' + name + ' will see this improve next term.'
      : L === 'C' ? ' Continued regular practice will turn this solid base into real confidence next term.'
      : ' Keep it up: ' + name + ' should be proud of this term’s work.';
    return bandOpen + ' (grade ' + (L || '–') + (pct === null ? '' : ', ' + f1(pct) + '%') + ')' + strongBit + '.' + stepBit + close;
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
      /* owner decision: students at the evidence gate (>=6/9) rank among
         gate-qualified students; provisional ranks are tagged downstream */
      const finals = sem.students
        .map((s) => { const gg = Calc.gradeStudent(sem, s.id); return { id: s.id, f: gg.final, ok: Calc.assessedCount(gg) >= Calc.FINAL_MIN_ASSESSED }; })
        .filter((x) => x.ok && x.f !== null)
        .sort((x, y) => y.f - x.f);
      const rank = finals.findIndex((x) => x.id === sid) + 1;
      out.push({
        semId: sem.id, semName: sem.name, parts: g.parts, final: g.final, letter: g.letter,
        rank: rank || null, total: finals.length, missing: g.missing, assessed: assessed,
        rankProvisional: !!(rank && assessed < Calc.COMPONENTS_ALL.length),
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
        remark: 'Not enough assessed work yet to report on ' + nm + ': ' + last.assessed + ' of 9 components assessed.',
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

    const bullet = (x) => x.k + ': ' + f1(x.v) + '%' + (x.d !== null && x.d !== undefined && x.k.indexOf('Ungraded') !== 0 ? ' (' + (x.d >= 0 ? '+' : '') + f1(x.d) + ' vs class)' : '');

    let remark = name + ' finishes ' + last.semName + ' with a weighted final of ' + f1(last.final) + '% (' + (last.letter || '–') + ')';
    remark += clsFinal !== null ? ', ' + (last.final >= clsFinal ? 'above' : 'below') + ' the class average of ' + f1(clsFinal) + '%.' : '.';
    if (best && worst && best.k !== worst.k) remark += ' Strongest area: ' + best.k + ' (' + f1(best.v) + '%); most in need of support: ' + worst.k + ' (' + f1(worst.v) + '%).';
    if (prev) {
      if (delta === null) remark += ' No comparable final for ' + prev.semName + '.';
      else if (delta > 1) remark += ' Since ' + prev.semName + ', the overall score has improved by ' + f1(delta) + ' points: well done.';
      else if (delta < -1) remark += ' Since ' + prev.semName + ', the overall score has slipped by ' + f1(-delta) + ' points.';
      else remark += ' The overall score has held steady since ' + prev.semName + '.';
    }
    if (last.rank) remark += ' Class rank: ' + last.rank + ' of ' + last.total + '.';
    if (worst) remark += ' Next step: focus on ' + worst.k.toLowerCase() + ', where ' + name + ' is furthest from the class average.';
    if (last.missing && last.missing.length) remark += ' Note: ' + last.missing.join(', ') + ' not yet graded.';

    if (provisional && remark) remark = 'Provisional: based on ' + last.assessed + ' of 9 components. ' + remark;
    return {
      sid: sid, name: name,
      last: last, prev: prev, delta: delta, overallRag: overallRag,
      ragName: overallRag ? RAG_NAME[overallRag] : null,
      provisional: provisional,
      strengths: strengths.map(bullet), weaknesses: weaknesses.map(bullet),
      opportunities: opportunities.map(bullet), threats: threats.map((t) =>
        t.k.indexOf('Ungraded') === 0 ? t.k : t.k + ': ' + f1(t.v) + '%' + (t.d !== null && t.d !== undefined ? ' (' + f1(t.d) + ' vs ' + (prev ? prev.semName : '') + ')' : '')),
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
    RAG_PARENT: RAG_PARENT, MIN_CLASS_N: MIN_CLASS_N, MIN_TREND_EVENTS: MIN_TREND_EVENTS,
    componentEvents: componentEvents, classComponentStats: classComponentStats,
    componentPointList: componentPointList, trendVerdict: trendVerdict,
    ragWhy: ragWhy, classTeachingPriorities: classTeachingPriorities,
    reportSections: reportSections,
    classSemesterRows: classSemesterRows, classAvgParts: classAvgParts,
    movers: movers, classSummary: classSummary, classSwotText: classSwotText,
    studentSemesterRows: studentSemesterRows, studentMatrix: studentMatrix,
    swot: swot, f1: f1, r1: r1,
  };
});
