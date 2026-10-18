/* =========================================================================
   Shared utilities — Chinese school calendar + misc (node & browser safe)
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Util = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTH_ABBR = {
    January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr', May: 'May',
    June: 'Jun', July: 'Jul', August: 'Aug', September: 'Sep', October: 'Oct',
    November: 'Nov', December: 'Dec',
  };

  /* Chinese New Year dates 2024–2035 (Gregorian) */
  const CNY = {
    2024: '2024-02-10', 2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06',
    2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03', 2031: '2031-01-23',
    2032: '2032-02-11', 2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08',
  };

  const cnyDate = (y) => (CNY[y] ? new Date(CNY[y] + 'T12:00:00') : null);

  /* Estimate spring-semester start: ~2.5 weeks after CNY, snapped to Monday.
     Fall always starts Sep 1. Spring ends late June / early July. */
  function springStart(year) {
    const cny = cnyDate(year);
    if (!cny) return new Date(year, 1, 24); // no data → late Feb fallback
    const d = new Date(cny);
    d.setDate(d.getDate() + 17);            // settle + lantern festival window
    // snap forward to Monday
    const day = d.getDay();                 // 0 Sun … 6 Sat
    const add = day === 0 ? 1 : day === 6 ? 2 : day === 5 ? 3 : 0; // Fri→Mon too
    d.setDate(d.getDate() + add);
    return d;
  }

  /* Suggested months for a semester, based on the Chinese school calendar.
     Fall of year Y: Sep Y – Jan Y+1 (ends before CNY of Y+1; January always included).
     Spring of year Y: start ≈ 17 days after CNY of Y snapped to Monday →
       CNY early (≤ Jan 31) → mid-Feb start → Feb–Jun
       CNY early/mid Feb (≤ Feb 8) → late-Feb start → Feb–Jun
       CNY late (Feb 9–20) → March start → Mar–Jun                                */
  function suggestMonths(year, period) {
    if (period === 'fall') {
      return ['September', 'October', 'November', 'December', 'January'];
    }
    const start = springStart(year);
    const fromFeb = start.getMonth() <= 1; // month index 1 = February
    const first = fromFeb ? 'February' : 'March';
    const i0 = MONTHS.indexOf(first);
    return MONTHS.slice(i0, 6); // through June
  }

  function suggestHint(year, period) {
    if (period === 'fall') {
      const next = Number(year) + 1;
      const cny = CNY[next];
      return cny
        ? `Fall runs Sep ${year} – Jan ${next}, ending before Chinese New Year ${next} (${fmtCny(cny)}).`
        : `Fall runs Sep ${year} – Jan ${next}.`;
    }
    const cny = CNY[year];
    const st = springStart(year);
    if (!cny) return `Spring starts around ${MONTH_ABBR[MONTHS[st.getMonth()]]} ${st.getDate()}.`;
    return `CNY ${year} falls on ${fmtCny(cny)}; term starts around ${MONTH_ABBR[MONTHS[st.getMonth()]]} ${st.getDate()} → ${suggestMonths(year, 'spring').join('–')}.`;
  }

  function fmtCny(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTH_ABBR[MONTHS[m - 1]]} ${d}, ${y}`;
  }

  const uid = (p) => (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
  const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

  /* LO descriptions (from the SPR Instructions sheet) */
  const LOS = {
    'Listening-LO1': 'Understand basic instructional language in classroom.',
    'Listening-LO2': 'Demonstrate positive listening attitudes and behaviour.',
    'Speaking-LO1': 'Can understand and use basic spoken instructions in classroom.',
    'Speaking-LO2': 'Use appropriate skills, strategies and language to convey and construct meaning during interactions.',
    'Writing-LO1': 'Able to complete assigned writings in classroom.',
    'Writing-LO2': 'Demonstrate language ability in writing assignments.',
    'Reading-LO1': 'Able to read and understand reading materials used in classroom.',
    'Reading-LO2': 'Demonstrate literal and inferential comprehension of reading materials through participation in discussion and other activities.',
  };

  /* Learning-outcome text for the Instructions sheet on export */
  const INSTRUCTIONS_LINES = [
    'Please read the instructions carefully before filling in the report.',
    '',
    '1) For classroom observations, please refer to the table below.',
    '2) All scores for Classroom Observations should be a score out of 10',
    '3) For Spelling and Daily Assignment, the actual and total score are to be input.',
    '4) Classroom Observations scores are recorded on a monthly basis.',
    '5) Spelling and Daily Assignments are to be recorded on a weekly basis.',
  ];

  const CANON_MONTH = { Octber: 'October', Sep: 'September', Sept: 'September', Decem: 'December' };
  const canonMonth = (s) => {
    const t = String(s ?? '').trim();
    return CANON_MONTH[t] || (MONTHS.includes(t) ? t : null);
  };

  return {
    MONTHS, MONTH_ABBR, CNY, LOS, INSTRUCTIONS_LINES,
    suggestMonths, suggestHint, springStart, fmtCny,
    uid, esc, num, r1, r2, canonMonth,
  };
});
