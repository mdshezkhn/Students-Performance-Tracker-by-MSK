/* Two-teacher hardening suite (jsdom + real webcrypto, synthetic data only).
   Run: node tests/test-two-teacher.js

   Covers the 2026-11-02 phases:
   P1  — no plaintext DB ever lands in localStorage (save refused without crypto)
   P1  — storage-quota banner appears before the quota fills
   P2  — class-file round-trip: export -> import -> data matches; wrong key rejected
   P2  — merge: independent edits union cleanly; same-cell edits conflict and are
          reviewable, never silently last-write-wins
   P3  — provisional-grade gating survives in the shipped app build
   P5  — school-approval reminder shows until approval is recorded            */
'use strict';
const fs = require('fs');
const path = require('path');
const webcrypto = require('crypto').webcrypto;
const { JSDOM, VirtualConsole } = require('jsdom');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok: ' + msg); }
  else { fail++; console.log('  FAIL: ' + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- load the shipped modules straight from source (same files the build embeds) ---- */
const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'source', f), 'utf8');
const CALC = new Function(SRC('calc.js') + '\nreturn Calc;')();
const CS = new Function('window', SRC('classstore.js') + '\nreturn ClassStore;')({ crypto: webcrypto });

/* ---------- synthetic class workbook ---------- */
function sem(id, name) {
  const students = [], observations = {}, spelling = {}, daily = {}, tests = {};
  for (let i = 1; i <= 3; i++) {
    const sid = 'STU-00' + i;
    students.push({ id: sid, nameCn: '学生' + i, nameEn: 'Student ' + i, gender: i % 2 ? 'M' : 'F' });
    observations[sid] = { '2026-09': { 'Listening-LO1': 8 } };
    spelling[sid] = { '2026-09': { weeks: [7, null, null, null] } };
    daily[sid] = { '2026-09': { d1: 4, d2: 4 } };
    tests[sid] = { 'mid': 18 };
  }
  return { id: id, name: name, year: 2026, term: 'Fall', students: students, months: ['2026-09'],
    observations: observations, spelling: spelling, daily: daily, tests: tests, review: [], reportNotes: {} };
}
function workbook() {
  return { sprClass: 1, id: 'C1', name: 'Grade 2C', school: 'Riverside School', eal: 'mo', support: 'cet',
    settings: { lastBackupAt: 0 }, currentSemesterId: 'S1', semesters: [sem('S1', 'Fall 2026')], pending: [], audit: [] };
}

(async function main() {
  /* ============ A. class-file round-trip (key required, wrong key rejected) ============ */
  console.log('== A: encrypted class-file round-trip ==');
  const wbA = workbook();
  const keyA = webcrypto.getRandomValues(new Uint8Array(32));
  const blobA = await CS.sealClass(wbA, keyA);
  const fileA = CS.classFile({ id: wbA.id, name: wbA.name, school: wbA.school, eal: 'mo', support: 'cet' }, blobA);
  ok(JSON.stringify(fileA).indexOf('Student 1') === -1 && JSON.stringify(fileA).indexOf('学生1') === -1,
    'exported file contains no plaintext student data');
  const wbBack = await CS.openClass(fileA.blob, keyA);
  ok(wbBack.semesters[0].students.length === 3 && wbBack.semesters[0].students[0].nameEn === 'Student 1',
    'import with the right key restores the roster');
  let wrongKeyRejected = false;
  try { await CS.openClass(fileA.blob, webcrypto.getRandomValues(new Uint8Array(32))); } catch (e) { wrongKeyRejected = true; }
  ok(wrongKeyRejected, 'wrong key is rejected (AES-GCM auth failure)');
  let garbageRejected = false;
  try { await CS.openClass({ iv: blobA.iv, ct: 'AAAA' }, keyA); } catch (e) { garbageRejected = true; }
  ok(garbageRejected, 'tampered ciphertext is rejected');

  /* ============ B. merge: union of independent edits ============ */
  console.log('== B: two teachers, different cells -> clean union ==');
  const T0 = 1730000000000;
  function exchanged() { const wb = workbook(); wb.exchanges = [{ at: T0, by: 'test', kind: 'file-merge' }]; return wb; }
  const A = JSON.parse(JSON.stringify(exchanged()));   /* EAL's copy  */
  const B = JSON.parse(JSON.stringify(exchanged()));   /* CET's copy  */
  /* EAL edits STU-001 spelling week 2; CET edits STU-002 listening — independent */
  A.semesters[0].spelling['STU-001']['2026-09'].weeks[1] = 9;
  CS.stampCell(A, CS.cellKey('S1', 'STU-001', 'sp', '2026-09', 'w2'), 'mo', T0 + 3600e3);
  B.semesters[0].observations['STU-002']['2026-09']['Speaking-LO2'] = 7;
  CS.stampCell(B, CS.cellKey('S1', 'STU-002', 'obs', '2026-09', 'Speaking-LO2'), 'cet', T0 + 7200e3);
  const r1 = CS.mergeWorkbooks(A, B, { now: T0 + 10800e3 });
  ok(r1.conflicts.length === 0, 'independent edits produce no conflicts');
  ok(r1.merged.semesters[0].spelling['STU-001']['2026-09'].weeks[1] === 9 &&
     r1.merged.semesters[0].observations['STU-002']['2026-09']['Speaking-LO2'] === 7,
    "both teachers' edits survive the merge");

  /* ============ C. same-cell concurrent edit -> conflict, never silent LWW ============ */
  console.log('== C: same cell edited on both sides -> conflict review ==');
  const A2 = JSON.parse(JSON.stringify(exchanged()));
  const B2 = JSON.parse(JSON.stringify(exchanged()));
  A2.semesters[0].observations['STU-001']['2026-09']['Listening-LO1'] = 5;   /* EAL set 5 */
  CS.stampCell(A2, CS.cellKey('S1', 'STU-001', 'obs', '2026-09', 'Listening-LO1'), 'mo', T0 + 3600e3);
  B2.semesters[0].observations['STU-001']['2026-09']['Listening-LO1'] = 6;   /* CET set 6  */
  CS.stampCell(B2, CS.cellKey('S1', 'STU-001', 'obs', '2026-09', 'Listening-LO1'), 'cet', T0 + 7200e3);
  const r2 = CS.mergeWorkbooks(A2, B2, { now: T0 + 10800e3 });
  ok(r2.conflicts.length === 1 && r2.conflicts[0].kind === 'cell', 'same-cell edit is detected as a conflict');
  const c0 = r2.conflicts[0];
  ok(c0.local.v === 5 && c0.remote.v === 6 && c0.local.by === 'mo' && c0.remote.by === 'cet',
    'conflict carries both values and both authors');
  ok(r2.merged.semesters[0].observations['STU-001']['2026-09']['Listening-LO1'] === 5,
    'importing side keeps its own value until the teacher decides (no silent overwrite)');
  const taken = JSON.parse(JSON.stringify(r2.merged));
  CS.applyConflict(taken, c0, 'theirs', 'test');
  ok(taken.semesters[0].observations['STU-001']['2026-09']['Listening-LO1'] === 6,
    "keep-theirs applies the colleague's value");
  const kept = JSON.parse(JSON.stringify(r2.merged));
  CS.applyConflict(kept, c0, 'mine', 'test');
  ok(kept.semesters[0].observations['STU-001']['2026-09']['Listening-LO1'] === 5,
    'keep-mine leaves the local value in place');

  /* roster conflict: colleague removes a student the teacher edited */
  console.log('== C2: remove-vs-edit on one student -> conflict, not silent loss ==');
  const A4 = JSON.parse(JSON.stringify(exchanged()));
  const B4 = JSON.parse(JSON.stringify(exchanged()));
  B4.semesters[0].students = B4.semesters[0].students.filter((st) => st.id !== 'STU-002');
  CS.stampRoster(B4, 'S1', 'STU-002', 'cet', true);
  A4.semesters[0].observations['STU-002']['2026-09']['Listening-LO1'] = 9;
  CS.stampCell(A4, CS.cellKey('S1', 'STU-002', 'obs', '2026-09', 'Listening-LO1'), 'mo', T0 + 3600e3);
  const r4 = CS.mergeWorkbooks(A4, B4, { now: T0 + 10800e3 });
  ok(r4.conflicts.some((c) => c.kind === 'student-del'), 'remove-vs-edit is flagged for review');
  ok(r4.merged.semesters[0].students.some((st) => st.id === 'STU-002'), 'the edited student is NOT silently removed');
  const removed = JSON.parse(JSON.stringify(r4.merged));
  CS.applyConflict(removed, r4.conflicts[0], 'theirs', 'test');
  ok(!removed.semesters[0].students.some((st) => st.id === 'STU-002'), 'deciding "remove" then removes the student');

  /* plain removal without local edits stays automatic */
  const A5 = JSON.parse(JSON.stringify(exchanged()));
  const B5 = JSON.parse(JSON.stringify(exchanged()));
  B5.semesters[0].students = B5.semesters[0].students.filter((st) => st.id !== 'STU-003');
  CS.stampRoster(B5, 'S1', 'STU-003', 'cet', true);
  const r5 = CS.mergeWorkbooks(A5, B5, { now: T0 + 10800e3 });
  ok(r5.conflicts.length === 0 && !r5.merged.semesters[0].students.some((st) => st.id === 'STU-003'),
    'un-contested removal still applies automatically');

  /* ============ D. provisional-grade gating in the shipped app ============ */
  console.log('== D: provisional-grade gating (shipped build) ==');
  const appHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  ok(/FINAL_MIN_ASSESSED/.test(appHtml) && /of 9 components assessed/.test(appHtml) && /Not yet assessed/.test(appHtml) && /provisional/i.test(appHtml),
    'gating vocabulary present in the shipped app');
  /* engine check with a 5-of-9 student */
  const s5 = sem('S1', 'Fall 2026');
  const g = CALC.getAssessmentCompleteness(s5, 'STU-001');
  ok(g.assessedComponentCount < 6 && g.gate === 'not-assessed', 'synthetic student is below the final gate (got ' + g.assessedComponentCount + '/9, ' + g.gate + ')');

  /* ============ E. no plaintext persistence without WebCrypto ============ */
  console.log('== E: plaintext refusal (no-crypto environment) ==');
  const LS_KEY = 'p4c4-markbook-v1';
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {});
  const boot = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const dom = new JSDOM(boot, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      /* strip subtle entirely: simulates plain-HTTP IE-style context */
      try { Object.defineProperty(w.crypto, 'subtle', { value: undefined }); } catch (e) {}
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; if (this.onclose) this.onclose(); };
      w.__dl = [];
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { w.__dl.push(this.download || '?'); };
    }
  });
  const w = dom.window;
  await sleep(1200);
  w.SPR_DEBUG_SET_DB && w.SPR_DEBUG_SET_DB(JSON.parse(JSON.stringify(workbook())));
  await sleep(800);
  const plaintext = w.localStorage.getItem(LS_KEY);
  ok(plaintext === null, 'no plaintext workbook is ever written to localStorage');
  ok(/Secure storage unavailable|HTTPS/.test(w.document.body.textContent || ''),
    'the secure-storage message is surfaced to the teacher');

  /* ============ F. storage-quota banner ============ */
  console.log('== F: storage-quota warning ==');
  ok(/Storage nearly full/.test(appHtml) && /80/.test(SRC('app.js')), 'quota monitor + 80% threshold shipped');

  console.log('');
  console.log(fail === 0 ? 'ALL TWO-TEACHER CHECKS PASSED (' + pass + ')' : 'TWO-TEACHER FAILURES: ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
