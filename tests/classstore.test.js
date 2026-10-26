/* ClassStore unit tests (pure Node + webcrypto, synthetic data only).
   Run: node tests/classstore.test.js
   Covers: the full role matrix, class-key wrap/unwrap, sealed class blobs,
   the pending-observation flow (approve applies, reject leaves the score
   untouched), the audit log, the migration planner/applier (with a final-
   grade regression check against Calc), roster CSV parsing, and the class
   file / share-link codecs. */
const CS = require('../source/classstore.js');
const Calc = require('../source/calc.js');

let pass = 0, fail = 0;
  function eqBytes(a, b) { return !!(a && b && a.length === b.length && a.every((x, i) => x === b[i])); }
function ok(cond, label) { if (cond) { pass++; } else { fail++; console.log('FAIL ' + label); } }
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else { fail++; console.log('FAIL ' + label + '\n  expected: ' + e + '\n  actual:   ' + a); }
}

const ADMIN = { username: 'admin-1', role: 'admin' };
const MGR   = { username: 'mgr-01', role: 'manager' };
const EAL   = { username: 'eal-01', role: 'eal' };
const SUP   = { username: 'sup-01', role: 'support' };
const CLS = { id: 'c-a', name: 'P4C4', school: 'SIS', eal: 'eal-01', support: 'sup-01' };
const OTHER = { id: 'c-b', name: 'P5C2', school: 'SIS', eal: 'eal-02', support: 'sup-02' };

/* ---------------- role matrix ---------------- */
const ALL_ACTIONS = ['view', 'edit.obs', 'edit.scores', 'edit.roster', 'request.obs', 'review', 'export.class', 'audit.view', 'manage.accounts', 'manage.classes', 'migrate', 'export.all'];
const MATRIX = {
  admin:   { view: 1, 'edit.obs': 1, 'edit.scores': 1, 'edit.roster': 1, 'request.obs': 1, review: 1, 'export.class': 1, 'audit.view': 1, 'manage.accounts': 1, 'manage.classes': 1, migrate: 1, 'export.all': 1 },
  manager: { view: 1, 'audit.view': 1 },
  eal:     { view: 1, 'edit.obs': 1, 'edit.scores': 1, 'edit.roster': 1, review: 1, 'export.class': 1, 'audit.view': 1 },
  support: { view: 1, 'edit.scores': 1, 'request.obs': 1, 'audit.view': 1 },
};
for (const [role, expected] of Object.entries(MATRIX)) {
  const users = { admin: ADMIN, manager: MGR, eal: EAL, support: SUP };
  for (const action of ALL_ACTIONS) {
    const want = !!expected[action];
    eq(CS.can(users[role], action, CLS), want, role + ' can ' + action + ' (own class)');
    if (role !== 'admin' && role !== 'manager' && want) {
      eq(CS.can(users[role], action, OTHER), false, role + ' CANNOT ' + action + ' on ANOTHER class');
    }
  }
}
eq(CS.can(null, 'view', CLS), false, 'no user -> no access');
eq(CS.can({ username: 'x', role: 'teacher' }, 'view', CLS), false, 'unknown role -> no access');
eq(CS.classesFor(MGR, [CLS, OTHER]).length, 2, 'manager sees all classes');
eq(CS.classesFor(EAL, [CLS, OTHER]).length, 1, 'eal sees only their class');
eq(CS.classesFor(SUP, [CLS, OTHER]).length, 1, 'support sees only their class');
eq(CS.classesFor(EAL, [CLS, OTHER])[0].id, 'c-a', 'support/eal class list is their own');

/* role normalisation (roster display strings + bare words) */
eq(CS.normalizeRole('Manager (sees whole school)'), 'manager', 'roster manager string');
eq(CS.normalizeRole('EAL teacher'), 'eal', 'roster eal string');
eq(CS.normalizeRole('Supporting teacher'), 'support', 'roster support string');
eq(CS.normalizeRole('teacher'), 'eal', 'legacy teacher maps to eal');
eq(CS.normalizeRole('principal'), null, 'unknown role rejected');

/* ---------------- keys & sealed blobs ---------------- */
(async function () {
  const key = CS.genKey();
  eq(key.length, 32, 'class key is 32 bytes');
  const wrap = await CS.wrapKey(key, 'correct horse battery');
  const back = await CS.unwrapKey(wrap, 'correct horse battery');
  eq(CS.b64uFromBytes(back), CS.b64uFromBytes(key), 'key wrap/unwrap round-trip');
  let wrongPw = false;
  try { await CS.unwrapKey(wrap, 'wrong password'); } catch (e) { wrongPw = true; }
  ok(wrongPw, 'wrong password cannot unwrap a class key');

  const wb = { sprClass: 1, id: 'c-a', semesters: [{ id: 's1', students: [{ id: 'P01' }] }], pending: [], audit: [] };
  const blob = await CS.sealClass(wb, key);
  ok(!!blob.sum && blob.sum.length === 22, 'blob carries a stable content sum');
  const opened = await CS.openClass(blob, key);
  eq(opened.semesters[0].students[0].id, 'P01', 'seal/open round-trip keeps data');
  const sum2 = await CS.contentSum(wb);
  eq(sum2, blob.sum, 'content sum is deterministic');
  let tampered = false;
  try { await CS.openClass({ iv: blob.iv, ct: blob.ct.slice(0, -2) + (blob.ct.slice(-1) === 'A' ? 'B' : 'A') }, key); } catch (e) { tampered = true; }
  ok(tampered, 'tampered ciphertext fails to open');

  /* ---------------- pending observation flow ---------------- */
  const sem = { id: 'sem1', school: 'S', className: 'P4C4', name: '2026 Spring', months: ['March'], students: [{ id: 'STU-01', nameCn: '学生01', nameEn: 'Pupil One', gender: 'M' }], observations: { 'STU-01': { 'March': { 'Listening-LO1': 8 } } }, spelling: {}, daily: {}, tests: {} };
  const wbk = { sprClass: 1, id: 'c-a', settings: {}, semesters: [sem], pending: [], audit: [] };
  const r = CS.requestChange(wbk, { semId: 'sem1', sid: 'STU-01', month: 'March', key: 'Listening-LO1', newValue: 5, by: 'sup-01', note: 'miscounted' });
  ok(!!r.ok, 'request accepted');
  eq(sem.observations['STU-01']['March']['Listening-LO1'], 8, 'PENDING request does NOT change the score');
  eq(wbk.pending.length, 1, 'pending queue holds the request');
  eq(wbk.audit.length, 1, 'request is audited');
  const bad = CS.requestChange(wbk, { semId: 'sem1', sid: 'STU-01', month: 'March', key: 'Listening-LO1', newValue: 'high' });
  ok(!!bad.error, 'non-numeric request rejected');

  const pid = wbk.pending[0].id;
  const rej = CS.rejectChange(wbk, pid, { by: 'eal-01', reason: 'we agreed on 8' });
  ok(!!rej.ok, 'reject accepted');
  eq(sem.observations['STU-01']['March']['Listening-LO1'], 8, 'REJECTED change leaves the score unchanged');
  eq(wbk.pending.length, 0, 'rejected request leaves the queue');
  eq(wbk.audit[wbk.audit.length - 1].action, 'obs.reject', 'reject is audited');

  CS.requestChange(wbk, { semId: 'sem1', sid: 'STU-01', month: 'March', key: 'Listening-LO1', newValue: 6, by: 'sup-01' });
  const app = CS.approveChange(wbk, wbk.pending[0].id, { by: 'eal-01' });
  ok(!!app.ok, 'approve accepted');
  eq(sem.observations['STU-01']['March']['Listening-LO1'], 6, 'APPROVED change applies the new value');
  eq(wbk.audit[wbk.audit.length - 1].action, 'obs.approve', 'approve is audited');
  eq(wbk.audit[wbk.audit.length - 1].old, 8, 'audit keeps the old value');
  eq(wbk.audit[wbk.audit.length - 1].new, 6, 'audit keeps the new value');

  /* audit cap */
  const big = { audit: [] };
  for (let i = 0; i < CS.AUDIT_MAX + 120; i++) CS.logAudit(big, { by: 'x', action: 'edit', n: i });
  eq(big.audit.length, CS.AUDIT_MAX, 'audit log capped at AUDIT_MAX');
  eq(big.audit[0].n, 120, 'audit cap drops the OLDEST entries');

  /* ---------------- migration: plan, apply, scoping, grade regression ---------------- */
  const legacy = {
    settings: { autoTotal: true, spTotal: 20, daTotal: 10 },
    semesters: [
      mkSem('sem-a1', 'P4C4', 2026, [10, 9, 8, 7]),
      mkSem('sem-a2', 'P4C4', 2027, [9, 9, 9, 9]),
      mkSem('sem-b1', 'P5C2', 2026, [6, 7, 5, 8]),
    ],
  };
  function mkSem(id, className, year, obs) {
    return {
      id: id, school: 'Synthetic Primary', className: className, name: year + ' Spring ' + className, year: year, period: 'spring',
      months: ['March'], students: [{ id: 'STU-01', nameCn: '学生01', nameEn: 'Pupil One', gender: 'M' }, { id: 'STU-02', nameCn: '学生02', nameEn: 'Pupil Two', gender: 'F' }],
      observations: { 'STU-01': { 'March': { 'Listening-LO1': obs[0], 'Speaking-LO1': obs[1], 'Writing-LO1': obs[2], 'Reading-LO1': obs[3] } } },
      spelling: { 'STU-02': { 'March': { 1: { s: 18, t: 20 } } } }, daily: {}, tests: {},
    };
  }
  const plan = CS.planMigration(legacy);
  eq(plan.classes.length, 2, 'migration plan groups semesters by class');
  const p4 = plan.classes.find((c) => c.name === 'P4C4');
  const p5 = plan.classes.find((c) => c.name === 'P5C2');
  eq(p4.semCount, 2, 'P4C4 carries both its semesters');
  eq(p5.semCount, 1, 'P5C2 carries one semester');
  eq(p4.cellCount, CS.countCells(legacy.semesters[0]) + CS.countCells(legacy.semesters[1]), 'plan counts every moving cell');

  /* final grades BEFORE migration (the numbers that must not change) */
  const before = {};
  for (const s of legacy.semesters) before[s.id] = Calc.gradeAll(s).map((g) => [g.sid, g.final, g.letter]);

  const pairings = {};
  pairings[p4.id] = { eal: 'eal-01', support: 'sup-01' };
  pairings[p5.id] = { eal: 'eal-02', support: '' };
  const applied2 = await CS.applyMigration(legacy, {
    plan: plan, users: [
      { username: 'admin-1', role: 'admin' },
      { username: 'mgr-01', role: 'manager' },
      { username: 'eal-01', role: 'eal' },
      { username: 'sup-01', role: 'support' },
      { username: 'eal-02', role: 'eal' },
    ],
    pairings: pairings,
    passwords: { 'admin-1': 'admin-pw-123', 'mgr-01': 'mgr-pw-123' },
    generatePassword: (u) => 'gen-' + u + '-pw',
  });
  ok(applied2.newPasswords['eal-01'] === 'gen-eal-01-pw' && applied2.newPasswords['sup-01'] === 'gen-sup-01-pw', 'accounts without a supplied password get a generated one');
  ok(!applied2.newPasswords['admin-1'], 'admin uses the supplied password (not regenerated)');

  /* key scoping: support holds only their class key */
  const supRing = applied2.keyrings['sup-01'];
  eq(Object.keys(supRing).length, 1, 'support keyring holds exactly one class');
  ok(!!supRing[p4.id], 'support keyring is their paired class');
  const supKey = await CS.unwrapKey(supRing[p4.id], 'gen-sup-01-pw');
  const p4wb = await CS.openClass(applied2.blobs[p4.id], supKey);
  eq(p4wb.semesters.length, 2, 'support can open their own class workbook');
  let cross = false;
  try { await CS.openClass(applied2.blobs[p5.id], supKey); } catch (e) { cross = true; }
  ok(cross, "support's P4C4 key cannot open the P5C2 workbook");

  /* admin + manager hold all keys */
  eq(Object.keys(applied2.keyrings['admin-1']).length, 2, 'admin keyring holds every class');
  eq(Object.keys(applied2.keyrings['mgr-01']).length, 2, 'manager keyring holds every class');

  /* data + grades identical after migration */
  const adminKey = await CS.unwrapKey(applied2.keyrings['admin-1'][p4.id], 'admin-pw-123');
  const p4open = await CS.openClass(applied2.blobs[p4.id], adminKey);
  eq(p4open.semesters.map((s) => s.id).sort(), ['sem-a1', 'sem-a2'], 'class workbook keeps the same semesters');
  eq(JSON.stringify(p4open.semesters[0]), JSON.stringify(legacy.semesters[0]), 'semester content is byte-identical after migration');
  ok(p4open.audit.some((a) => a.action === 'migrate'), 'migration is audited inside the class');
  for (const c of [p4, p5]) {
    const k = await CS.unwrapKey(applied2.keyrings['admin-1'][c.id], 'admin-pw-123');
    const w = await CS.openClass(applied2.blobs[c.id], k);
    for (const s of w.semesters) {
      const after = Calc.gradeAll(s).map((g) => [g.sid, g.final, g.letter]);
      eq(after, before[s.id], 'FINAL GRADES unchanged for ' + s.id + ' after migration');
    }
  }

  /* ---------------- roster CSV ---------------- */
  const csv = 'username,display_name,role,class_or_grade,paired_with,status\r\n' +
    'mgr-01,,Manager (sees whole school),,,optional\r\n' +
    'eal-01,Mo Li,EAL teacher,,sup-01,\r\n' +
    'sup-01,,Supporting teacher,,eal-01,\r\n' +
    'eal-02,Ann,EAL teacher,,,\r\n' +
    'bad name,,EAL teacher,,,\r\n' +
    'dup-01,,EAL teacher,,,\r\n' +
    'dup-01,,Supporting teacher,,,\r\n' +
    'weird-01,,Principal,,,\r\n';
  const roster = CS.parseRosterCsv('\uFEFF' + csv);
  eq(roster.users.map((u) => u.username), ['mgr-01', 'eal-01', 'sup-01', 'eal-02', 'dup-01'], 'roster keeps valid rows (first of the duplicates)');
  eq(roster.errors.length, 3, 'roster errors: bad username + duplicate + unknown role');
  ok(roster.warnings.some((w) => w.indexOf('eal-02') !== -1 && w.indexOf('pair') !== -1), 'unpaired EAL flagged as warning');
  eq(CS.parseRosterCsv('a,b\r\n1,2').errors[0], 'need at least "username" and "role" columns', 'missing columns rejected');

  /* ---------------- codecs ---------------- */
  const cf = CS.classFile({ id: 'c-a', name: 'P4C4', school: 'S', eal: 'eal-01', support: 'sup-01' }, blob);
  const parsed = CS.parseClassFile(JSON.parse(JSON.stringify(cf)));
  eq(parsed.id, 'c-a', 'class file round-trip');
  ok(!!parsed.blob.ct, 'class file carries the encrypted blob');
  let badFile = false;
  try { CS.parseClassFile({ spr: 1, type: 'other' }); } catch (e) { badFile = true; }
  ok(badFile, 'foreign JSON rejected as class file');
  const link = CS.classLink('https://spr.example', '/app/index.html', 'c-a', CS.b64uFromBytes(key));
  const lp = CS.parseClassHash(link.substring(link.indexOf('#')));
  eq(lp.id, 'c-a', 'share link round-trip: id');
  eq(lp.k, CS.b64uFromBytes(key), 'share link round-trip: key');
  const opened2 = await CS.openClass(parsed.blob, key);
  eq(opened2.semesters[0].students[0].id, 'P01', 'blob from class file still opens with the shared key');
  eq(CS.parseClassHash('#/dashboard'), null, 'normal routes are not class links');

  /* ============== P1.1: hashless auth, PBKDF2 v2, policy, generator ============== */
  {
    const ALPHA = new Set('23456789abcdefghjkmnpqrstuvwxyu-');
    let shapeOk = true, charsetOk = true, policyOk = true;
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const pw = CS.genPassword();
      const parts = pw.split('-');
      if (!(pw.length === 23 && parts.length === 4 && parts.every((g) => g.length === 5))) shapeOk = false;
      if (!pw.split('').every((ch) => ALPHA.has(ch))) charsetOk = false;
      if (!(CS.pwOk('admin', pw) === null && CS.pwOk('manager', pw) === null && CS.pwOk('eal', pw) === null)) policyOk = false;
      seen.add(pw);
    }
    ok(shapeOk, 'genPassword shape is 4 groups of 5 (xxxxx-xxxxx-xxxxx-xxxxx)');
    ok(charsetOk, 'genPassword uses the 32-symbol no-lookalike alphabet');
    ok(policyOk, 'generated passwords satisfy every role policy');
    ok(seen.size === 40, 'genPassword draws are unique');
    ok(CS.genPasswordBits() >= 80, 'generator entropy is at least 80 bits (100 claimed)');

    /* 2026-10-25 (owner request): length minimums removed — any non-empty
       password is accepted for every role; only the empty string rejects */
    ok(CS.pwOk('admin', 'short') === null && CS.pwOk('manager', 'a') === null, 'no length minimum: short passwords accepted for every role');
    ok(CS.pwOk('eal', 'x') === null && CS.pwOk('support', '') !== null, 'empty password rejected, 1-char accepted');

    const key = CS.genKey();
    const wrap = await CS.wrapKey(key, 'pw-one');
    ok(wrap.v === 2 && wrap.it === 600000, 'new wraps are v2 / 600k iterations');
    ok(eqBytes(await CS.unwrapKey(wrap, 'pw-one'), key), 'v2 wrap round-trip');
    ok((await CS.unwrapKey(wrap, 'wrong').catch(() => null)) === null, 'wrong password fails the v2 wrap');

    const legacy = await CS.wrapKey(key, 'pw-one', 310000);
    delete legacy.v; delete legacy.it;  /* fieldless = a pre-P1.1 wrap on disk */
    const leg2 = await CS.wrapKey(key, 'pw-one', 310000);
    ok(eqBytes(await CS.unwrapKey(legacy, 'pw-one'), key), 'fieldless legacy wrap (310k) still unwraps');
    ok(eqBytes(await CS.unwrapKey(leg2, 'pw-one'), key), 'v1-tagged wrap still unwraps');
    ok(CS.wrapNeedsUpgrade(legacy) && CS.wrapNeedsUpgrade(leg2) && !CS.wrapNeedsUpgrade(wrap), 'upgrade detection knows v1 from v2');

    const rw = await CS.rewrapKey(leg2, 'pw-one', 'a-new-password-2');
    ok(rw.v === 2 && rw.it === 600000, 'rewrap upgrades to v2 while it re-keys');
    ok(eqBytes(await CS.unwrapKey(rw, 'a-new-password-2'), key), 'rewrapped key opens under the NEW password');
    ok((await CS.unwrapKey(rw, 'pw-one').catch(() => null)) === null, 'old password no longer opens it');

    const lw = await CS.loginWrap('sign-in-pw-1');
    ok(await CS.verifyLogin(lw, 'sign-in-pw-1') === true, 'login wrap verifies the right password');
    ok(await CS.verifyLogin(lw, 'nope') === false, 'login wrap rejects a wrong password');
    ok(await CS.verifyLogin(null, 'x') === false && await CS.verifyLogin({}, 'x') === false, 'login wrap handles missing/garbage wraps');
    ok(!/"(hash|password|pw)"/.test(JSON.stringify(lw)), 'login wrap stores no password material');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); });
