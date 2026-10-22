/* =========================================================================
   SPR Device Sync — cell-level three-way merge (pure functions, no DOM)
   merge(base, local, cloud) -> { merged, conflicts[], stats }
     each input is a SYNC STATE: { users:[…], wraps:{…}, db:{…} }
     - users: account records [{username, hash, name, role}]
     - wraps: data-key wraps keyed by username ('__master__' = recovery wrap);
       a password change ALWAYS moves users[i] and wraps[username] together
     - db: the plaintext workbook (same shape calc.js consumes)
   Rules: one-sided change wins; identical change on both sides wins;
   different change on both sides = CONFLICT (local value kept until the user
   decides via applyChoice). Delete vs unchanged = deleted; delete vs edit =
   conflict. Students/semesters matched by stable id, accounts by username,
   NEVER by name. A genuine 0 is data (presence via hasOwnProperty, never
   truthiness). Inputs are never mutated; merged is a fresh deep copy and the
   owner's credit fields always survive from local.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPRMerge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SECTIONS = ['observations', 'spelling', 'daily', 'tests', 'reportNotes'];

  /* ---------------- primitives ---------------- */
  const ABSENT = Object.seal({ __sprAbsent: true });   // unique-identity sentinel
  function isAbsent(v) { return v === ABSENT; }
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) === undefined ? 'undefined' : JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stableStringify(v[k]); }).join(',') + '}';
  }
  function eq(a, b) {
    if (a === b) return true;
    if (isAbsent(a) || isAbsent(b)) return false;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    return stableStringify(a) === stableStringify(b);
  }
  function deepCopy(v) { return v === ABSENT || v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function getKey(o, k) { return has(o, k) ? o[k] : ABSENT; }
  function keyUnion() {
    const seen = [];
    const add = function (o) { if (o) for (const k of Object.keys(o)) if (seen.indexOf(k) < 0) seen.push(k); };
    for (let i = 0; i < arguments.length; i++) add(arguments[i]);
    return seen;
  }
  function clean(obj) { return (obj && Object.keys(obj).length) ? obj : null; }

  /* three-way pick for one unit -> { v, how:'same'|'local'|'cloud'|'agree' } | { conflict:true } */
  function pick3(b, l, c) {
    const lSame = eq(l, b), cSame = eq(c, b);
    if (lSame && cSame) return { v: l, how: 'same' };
    if (lSame && !cSame) return { v: c, how: 'cloud' };
    if (!lSame && cSame) return { v: l, how: 'local' };
    if (eq(l, c)) return { v: l, how: 'agree' };
    return { conflict: true };
  }

  /* ---------------- labels ---------------- */
  function sectionLabel(s) {
    return { observations: 'Observations', spelling: 'Spelling', daily: 'Daily Assignment', tests: 'Tests', reportNotes: 'Report note' }[s] || s;
  }
  function testLabel(k) { return { midterm: 'Mid-Term', oral: 'Oral', written: 'Written' }[k] || k; }
  function displayName(sem, sid) {
    const st = sem && sem.students ? sem.students.find(function (x) { return x.id === sid; }) : null;
    if (!st) return sid;
    const en = st.nameEn || '', cn = st.nameCn || '';
    return cn && en ? cn + ' (' + en + ')' : (cn || en || sid);
  }

  /* ---------------- conflict record ---------------- */
  function mkConflict(unit, meta, b, l, c) {
    return {
      unit: unit,                       // 'cell' | 'student' | 'semester' | 'setting' | 'user' | 'master'
      section: meta.section || null,    // observations | spelling | daily | tests | reportNotes | students | settings | account | semester
      semesterId: meta.semesterId || null,
      semName: meta.semName || null,
      sid: meta.sid || null,
      studentName: meta.studentName || null,
      month: meta.month || null,
      week: meta.week || null,
      key: meta.key || null,
      label: meta.label || '',
      base: isAbsent(b) ? null : deepCopy(b),
      local: isAbsent(l) ? null : deepCopy(l),
      cloud: isAbsent(c) ? null : deepCopy(c)
    };
  }

  /* ---------------- one cell inside a container that starts as local's copy ---------------- */
  function cell(container, k, b, l, c, meta, conflicts, stats) {
    const r = pick3(b, l, c);
    if (r.conflict) {
      stats.conflicts++; stats.conflictCells++;
      conflicts.push(mkConflict('cell', meta, b, l, c));
      return;                                   // local value already sits in container
    }
    if (isAbsent(r.v)) delete container[k];     // deleted on the only side that changed
    else container[k] = deepCopy(r.v);
  }

  /* ---------------- sections: observations / spelling / daily ---------------- */
  function mergeMonthMap(section, bRow, lRow, cRow, sid, sem, conflicts, stats) {
    /* bRow/lRow/cRow: { month: {key|week: val} } (ABSENT possible) */
    const outRow = (lRow === ABSENT) ? {} : deepCopy(lRow);
    for (const month of keyUnion(bRow, lRow, cRow)) {
      const bm = getKey(bRow, month), lm = getKey(lRow, month), cm = getKey(cRow, month);
      const rm = pick3(bm, lm, cm);
      if (!rm.conflict) {
        if (isAbsent(rm.v) || !Object.keys(rm.v).length) delete outRow[month];
        else outRow[month] = deepCopy(rm.v);
        continue;
      }
      const outMonth = (lm === ABSENT) ? {} : deepCopy(lm);
      const isWeek = (section === 'spelling' || section === 'daily');
      for (const k of keyUnion(bm, lm, cm)) {
        cell(outMonth, k, getKey(bm, k), getKey(lm, k), getKey(cm, k), {
          section: section, semesterId: sem.id, semName: sem.name, sid: sid,
          studentName: displayName(sem, sid), month: month,
          week: isWeek ? String(k) : null, key: isWeek ? null : String(k),
          label: sectionLabel(section) + (isWeek ? ' · week ' + k : ' · ' + k)
        }, conflicts, stats);
      }
      if (Object.keys(outMonth).length) outRow[month] = outMonth; else delete outRow[month];
    }
    return clean(outRow);
  }

  /* ---------------- tests / reportNotes rows ---------------- */
  function mergeTestsRow(bRow, lRow, cRow, sid, sem, conflicts, stats) {
    const outRow = (lRow === ABSENT) ? {} : deepCopy(lRow);
    for (const kind of keyUnion(bRow, lRow, cRow)) {
      cell(outRow, kind, getKey(bRow, kind), getKey(lRow, kind), getKey(cRow, kind), {
        section: 'tests', semesterId: sem.id, semName: sem.name, sid: sid,
        studentName: displayName(sem, sid), key: kind,
        label: 'Tests · ' + testLabel(kind)
      }, conflicts, stats);
    }
    return clean(outRow);
  }
  function mergeNoteRow(bRow, lRow, cRow, sid, sem, conflicts, stats) {
    const meta = { section: 'reportNotes', semesterId: sem.id, semName: sem.name, sid: sid, studentName: displayName(sem, sid), label: 'Report-card note' };
    const r = pick3(bRow, lRow, cRow);
    if (r.conflict) { stats.conflicts++; conflicts.push(mkConflict('cell', meta, bRow, lRow, cRow)); return (lRow === ABSENT) ? null : deepCopy(lRow); }
    return isAbsent(r.v) ? null : deepCopy(r.v);
  }

  /* ---------------- one semester ---------------- */
  function mergeSem(baseSem, localSem, cloudSem, conflicts, stats) {
    const b = (baseSem === ABSENT) ? null : baseSem;
    const l = localSem, c = cloudSem;
    const out = deepCopy(l);
    /* cosmetic scalars: one-sided change wins, both-changed keeps local (counted) */
    for (const f of ['name', 'school', 'className']) {
      const r = pick3(b ? b[f] : ABSENT, l[f], c[f]);
      if (!r.conflict && r.how === 'cloud') out[f] = deepCopy(r.v);
      if (r.conflict) stats.scalarsKeptLocal++;
    }
    out.teachers = Array.from(new Set([].concat((b && b.teachers) || [], l.teachers || [], c.teachers || [])));
    out.months = Array.from(new Set([].concat((b && b.months) || [], l.months || [], c.months || [])));

    /* students by id */
    const byId = function (arr, id) { return (arr || []).find(function (s) { return s.id === id; }) || null; };
    const ids = keyUnion(
      b ? objectMap(b.students) : null, objectMap(l.students), objectMap(c.students));
    out.students = [];
    for (const id of ids) {
      const bs = b ? byId(b.students, id) : null, ls = byId(l.students, id), cs = byId(c.students, id);
      const r = pick3(bs || ABSENT, ls || ABSENT, cs || ABSENT);
      if (r.conflict) {
        stats.conflicts++;
        conflicts.push(mkConflict('student', {
          section: 'students', semesterId: l.id, semName: l.name, sid: id,
          studentName: displayName(ls || cs ? l : c, id), label: 'Student record'
        }, bs, ls, cs));
        if (ls) out.students.push(deepCopy(ls));           // local kept until decided
      } else if (!isAbsent(r.v)) out.students.push(deepCopy(r.v));
      else stats.studentsRemoved++;
    }

    /* score sections */
    for (const section of SECTIONS) {
      const bs = b ? (b[section] || {}) : {}, ls = l[section] || {}, cs = c[section] || {};
      const outSec = {};
      for (const sid of keyUnion(bs, ls, cs)) {
        const bRow = getKey(bs, sid), lRow = getKey(ls, sid), cRow = getKey(cs, sid);
        const r0 = pick3(bRow, lRow, cRow);
        let row = null;
        if (!r0.conflict) row = isAbsent(r0.v) ? null : deepCopy(r0.v);
        else if (section === 'tests') row = mergeTestsRow(bRow, lRow, cRow, sid, l, conflicts, stats);
        else if (section === 'reportNotes') row = mergeNoteRow(bRow, lRow, cRow, sid, l, conflicts, stats);
        else row = mergeMonthMap(section, bRow, lRow, cRow, sid, l, conflicts, stats);
        if (section === 'observations' || section === 'spelling' || section === 'daily') row = pruneRow(row);
        if (row) outSec[sid] = row;
      }
      out[section] = outSec;
    }
    return out;
  }
  function objectMap(arr) { const o = {}; (arr || []).forEach(function (s) { o[s.id] = 1; }); return o; }
  /* strip empty month maps left behind by deletions, then drop the row if empty */
  /* prune every month-map section of a semester (fast-path winners skip mergeSem) */
  function pruneSem(sem) {
    if (!sem) return sem;
    for (const section of ['observations', 'spelling', 'daily']) {
      const sec = sem[section] || {};
      for (const sid of Object.keys(sec)) {
        const row = pruneRow(sec[sid]);
        if (row) sec[sid] = row; else delete sec[sid];
      }
    }
    return sem;
  }
  function pruneRow(row) {
    if (!row || typeof row !== 'object') return null;
    for (const m of Object.keys(row)) {
      const v = row[m];
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) delete row[m];
    }
    return Object.keys(row).length ? row : null;
  }

  /* ---------------- accounts (users + wraps move together) ---------------- */
  function mergeUsers(base, local, cloud, conflicts, stats) {
    const mergedUsers = [], mergedWraps = {};
    const names = keyUnion(indexBy(base.users, 'username'), indexBy(local.users, 'username'), indexBy(cloud.users, 'username'));
    for (const uname of names) {
      const bu = findBy(base.users, uname), lu = findBy(local.users, uname), cu = findBy(cloud.users, uname);
      const bw = getKey(base.wraps, uname), lw = getKey(local.wraps, uname), cw = getKey(cloud.wraps, uname);
      /* account record */
      const r = pick3(bu || ABSENT, lu || ABSENT, cu || ABSENT);
      let user = null;
      if (r.conflict) {
        stats.conflicts++;
        const cf = mkConflict('user', { section: 'account', sid: uname, label: 'Account · ' + uname }, bu, lu, cu);
        cf.localWrap = (lw === ABSENT) ? null : deepCopy(lw);   // the data-key wrap that
        cf.cloudWrap = (cw === ABSENT) ? null : deepCopy(cw);   // travels WITH this account
        conflicts.push(cf);
        user = deepCopy(lu);
      } else user = isAbsent(r.v) ? null : deepCopy(r.v);
      /* wrap for this account — must follow the same decision, else a password
         reset could arrive without its key (or vice versa = lockout) */
      const rw = pick3(bw, lw, cw);
      let wrap;
      if (rw.conflict) {
        if (!r.conflict) {   // user record agreed but wraps differ — surface it
          stats.conflicts++;
          conflicts.push(mkConflict('user', { section: 'account', sid: uname, label: 'Account key · ' + uname }, bw, lw, cw));
        }
        wrap = lw === ABSENT ? ABSENT : deepCopy(lw);
      } else wrap = isAbsent(rw.v) ? ABSENT : deepCopy(rw.v);
      if (user) mergedUsers.push(user);
      if (wrap !== ABSENT) mergedWraps[uname] = wrap;
    }
    /* the master recovery wrap is its own unit */
    const bm = getKey(base.wraps, '__master__'), lm2 = getKey(local.wraps, '__master__'), cm2 = getKey(cloud.wraps, '__master__');
    const rm = pick3(bm, lm2, cm2);
    if (rm.conflict) {
      stats.conflicts++;
      conflicts.push(mkConflict('master', { section: 'account', label: 'Master-password recovery key' }, bm, lm2, cm2));
      if (lm2 !== ABSENT) mergedWraps['__master__'] = deepCopy(lm2);
    } else if (!isAbsent(rm.v)) mergedWraps['__master__'] = deepCopy(rm.v);
    return { users: mergedUsers, wraps: mergedWraps };
  }
  function indexBy(arr, k) { const o = {}; (arr || []).forEach(function (x) { o[x[k]] = 1; }); return o; }
  function findBy(arr, uname) { return (arr || []).find(function (u) { return u.username === uname; }) || null; }

  /* ---------------- workbook ---------------- */
  function mergeDB(baseDB, localDB, cloudDB, conflicts, stats) {
    const out = deepCopy(localDB);
    /* owner credit is never negotiable */
    out.credit = localDB.credit || (baseDB && baseDB.credit) || cloudDB.credit;
    out.author = localDB.author || (baseDB && baseDB.author) || cloudDB.author;
    /* settings, key by key (timestamps take the max, never conflict) */
    const sKeys = keyUnion(baseDB.settings, localDB.settings, cloudDB.settings);
    out.settings = {};
    for (const k of sKeys) {
      const b = getKey(baseDB.settings, k), l = getKey(localDB.settings, k), c = getKey(cloudDB.settings, k);
      if (k === 'lastBackupAt') { out.settings[k] = Math.max(l === ABSENT ? 0 : l, c === ABSENT ? 0 : c) || (l === ABSENT ? c : l); continue; }
      const r = pick3(b, l, c);
      if (r.conflict) {
        stats.conflicts++;
        conflicts.push(mkConflict('setting', { section: 'settings', key: k, label: 'Setting · ' + k }, b, l, c));
        out.settings[k] = (l === ABSENT) ? deepCopy(c) : deepCopy(l);
      } else out.settings[k] = isAbsent(r.v) ? undefined : deepCopy(r.v);
      if (out.settings[k] === undefined) delete out.settings[k];
    }
    /* current semester pointer: whichever side changed it; both changed -> local */
    const bp = baseDB.currentSemesterId, lp = localDB.currentSemesterId, cp = cloudDB.currentSemesterId;
    if (lp === bp && cp !== bp) out.currentSemesterId = cp;
    else out.currentSemesterId = lp;
    /* semesters by id */
    const semById = function (db, id) { return (db && db.semesters || []).find(function (s) { return s.id === id; }) || null; };
    const ids = keyUnion(indexSem(baseDB), indexSem(localDB), indexSem(cloudDB));
    out.semesters = [];
    for (const id of ids) {
      const b = semById(baseDB, id), l = semById(localDB, id), c = semById(cloudDB, id);
      const r = pick3(b || ABSENT, l || ABSENT, c || ABSENT);
      if (r.conflict) {
        if (!l || !c) {   // deleted on one side, edited on the other
          stats.conflicts++;
          conflicts.push(mkConflict('semester', { section: 'semester', semesterId: id, semName: (l || c || {}).name || id, label: 'Whole class · ' + ((l || c || {}).name || id) }, b, l, c));
          if (l) out.semesters.push(pruneSem(deepCopy(l)));
        } else out.semesters.push(mergeSem(b, l, c, conflicts, stats));
      } else if (!isAbsent(r.v)) out.semesters.push(pruneSem(deepCopy(r.v)));
      else stats.semestersRemoved++;
    }
    return out;
  }
  function indexSem(db) { const o = {}; (db && db.semesters || []).forEach(function (s) { o[s.id] = 1; }); return o; }

  /* ---------------- entry point ---------------- */
  function merge(base, local, cloud) {
    const stats = { conflicts: 0, conflictCells: 0, studentsRemoved: 0, semestersRemoved: 0, scalarsKeptLocal: 0 };
    const conflicts = [];
    const b = base || { users: [], wraps: {}, db: null };
    const l = local, c = cloud;
    const accounts = mergeUsers(
      { users: b.users || [], wraps: b.wraps || {} },
      { users: l.users || [], wraps: l.wraps || {} },
      { users: c.users || [], wraps: c.wraps || {} }, conflicts, stats);
    const db = mergeDB(b.db || emptyDB(), l.db, c.db || emptyDB(), conflicts, stats);
    return { merged: { users: accounts.users, wraps: accounts.wraps, db: db }, conflicts: conflicts, stats: stats };
  }
  function emptyDB() { return { v: 1, currentSemesterId: null, semesters: [], settings: {} }; }

  /* ---------------- applying a user decision (mutates MERGED only) ---------------- */
  function applyChoice(merged, conflict, side) {
    const src = side === 'mine' ? conflict.local : conflict.cloud;
    const val = (src === null || src === undefined) ? ABSENT : deepCopy(src);
    const isDel = isAbsent(val);
    if (conflict.unit === 'user') {
      const uname = conflict.sid;
      replaceByKey(merged.users, 'username', uname, isDel ? null : val);
      const wrap = (side === 'mine') ? conflict.localWrap : conflict.cloudWrap;
      if (wrap === null || wrap === undefined) delete merged.wraps[uname];
      else merged.wraps[uname] = deepCopy(wrap);
      return;
    }
    if (conflict.unit === 'master') {
      if (isDel) delete merged.wraps['__master__'];
      else merged.wraps['__master__'] = val;
      return;
    }
    if (conflict.unit === 'setting') {
      if (isDel) delete merged.db.settings[conflict.key];
      else merged.db.settings[conflict.key] = val;
      return;
    }
    if (conflict.unit === 'semester') {
      const i = merged.db.semesters.findIndex(function (s) { return s.id === conflict.semesterId; });
      if (isDel) { if (i >= 0) merged.db.semesters.splice(i, 1); }
      else if (i >= 0) merged.db.semesters[i] = val; else merged.db.semesters.push(val);
      return;
    }
    if (conflict.unit === 'student') {
      const sem = merged.db.semesters.find(function (s) { return s.id === conflict.semesterId; });
      if (!sem) return;
      replaceByKey(sem.students, 'id', conflict.sid, isDel ? null : val);
      return;
    }
    /* cell */
    const sem = merged.db.semesters.find(function (s) { return s.id === conflict.semesterId; });
    if (!sem) return;
    const sec = sem[conflict.section];
    if (conflict.section === 'tests') {
      writePath(sec, [conflict.sid, conflict.key], val);
    } else if (conflict.section === 'reportNotes') {
      writePath(sec, [conflict.sid], val);
    } else {
      const k = conflict.week !== null && conflict.week !== undefined ? conflict.week : conflict.key;
      writePath(sec, [conflict.sid, conflict.month, k], val);
    }
  }
  function replaceByKey(arr, k, v, newVal) {
    const i = arr.findIndex(function (x) { return x[k] === v; });
    if (newVal === null) { if (i >= 0) arr.splice(i, 1); }
    else if (i >= 0) arr[i] = newVal; else arr.push(newVal);
  }
  function writePath(root, path, val) {
    let o = root;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      if (o[k] === undefined || o[k] === null) {
        if (isAbsent(val)) return;
        o[k] = {};
      }
      o = o[k];
    }
    const last = path[path.length - 1];
    if (isAbsent(val)) { delete o[last]; prune(root, path); }
    else o[last] = val;
  }
  function prune(root, path) {
    let o = root;
    const stack = [];
    for (let i = 0; i < path.length - 1; i++) { stack.push(o); o = o[path[i]]; }
    for (let i = stack.length - 1; i >= 0; i--) {
      const k = path[i + 1];
      if (o && !Object.keys(o).length) delete stack[i][path[i]];
      o = stack[i];
    }
  }

  return { merge: merge, applyChoice: applyChoice, stableStringify: stableStringify };
});
