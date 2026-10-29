/* =========================================================================
   ClassStore — per-class workbooks, role scoping and observation approvals
   (client-side agreed-rule model; NO backend)

   Every class is its own encrypted workbook sealed with its own random key.
   Keys are handed out wrapped under each account's password (PBKDF2-SHA256
   310k -> AES-GCM, same parameters as the app's master key). Only holders of
   a class key can open that class — enforced by cryptography, not by UI.

   HONEST SECURITY BOUNDARY (also stated in the UI and docs): this is an
   agreed-rule control between colleagues. Anyone who HOLDS a class key (or a
   password of an account that does) can decrypt the workbook and re-encrypt
   anything they like — the audit log inside the workbook is append-only by
   convention, not tamper-proof against a key holder.

   Node-safe: no DOM. In browser: window.ClassStore; in node: module.exports.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClassStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- base64url + crypto helpers ---------------- */
  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64uFromBytes(bytes) {
    let s = '', bits = 0, acc = 0;
    for (let i = 0; i < bytes.length; i++) {
      acc = (acc << 8) | bytes[i]; bits += 8;
      while (bits >= 6) { bits -= 6; s += B64U[(acc >> bits) & 63]; }
    }
    if (bits) s += B64U[(acc << (6 - bits)) & 63];
    return s;
  }
  function bytesFromB64u(s) {
    s = String(s || '').replace(/=+$/, '');
    const out = []; let bits = 0, acc = 0;
    for (let i = 0; i < s.length; i++) {
      const v = B64U.indexOf(s[i]);
      if (v < 0) throw new Error('bad base64url data');
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return new Uint8Array(out);
  }
  function C() {
    const c = (typeof self !== 'undefined' && self.crypto) || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (!c || !c.subtle) throw new Error('WebCrypto unavailable (needs https or Node >= 19)');
    return c;
  }
  function TE() { return (typeof self !== 'undefined' && self.TextEncoder) || globalThis.TextEncoder; }
  function TD() { return (typeof self !== 'undefined' && self.TextDecoder) || globalThis.TextDecoder; }

  async function deriveBits(password, salt, iterations) {
    const c = C();
    const base = await c.subtle.importKey('raw', new (TE())().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await c.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' }, base, 256));
  }
  async function aesKey(raw, usages) {
    return C().subtle.importKey('raw', raw, 'AES-GCM', false, usages || ['encrypt', 'decrypt']);
  }

  /* ---------------- class keys ---------------- */
  function genKey() { return C().getRandomValues(new Uint8Array(32)); }
  /* Wrap format v2: {v:2, it:600000, salt, iv, ct}. Wraps made before P1.1
     carry no v/it fields (read as v1, PBKDF2 310k) and keep working; unwrap
     always honours the wrap's own iteration count. */
  const PBKDF2_V1 = 310000, PBKDF2_V2 = 600000;
  async function wrapKey(keyBytes, password, itOverride) {
    const c = C();
    const it = itOverride || PBKDF2_V2;
    const salt = c.getRandomValues(new Uint8Array(16));
    const kb = await deriveBits(password, salt, it);
    const k = await aesKey(kb);
    const iv = c.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, keyBytes));
    return { v: it >= PBKDF2_V2 ? 2 : 1, it: it, salt: b64uFromBytes(salt), iv: b64uFromBytes(iv), ct: b64uFromBytes(ct) };
  }
  async function unwrapKey(w, password) {
    const kb = await deriveBits(password, bytesFromB64u(w.salt), w.it || PBKDF2_V1);
    const k = await aesKey(kb);
    return new Uint8Array(await C().subtle.decrypt({ name: 'AES-GCM', iv: bytesFromB64u(w.iv) }, k, bytesFromB64u(w.ct)));
  }
  function wrapNeedsUpgrade(w) { return (w.it || PBKDF2_V1) < PBKDF2_V2; }
  /* re-wrap one wrap (e.g. a class key) under a NEW password at v2 strength */
  async function rewrapKey(w, oldPw, newPw) { return wrapKey(await unwrapKey(w, oldPw), newPw); }

  /* ---------------- login wraps (password verification WITHOUT a hash) ------
     A login wrap seals a random 32-byte token under the account's password.
     Verification = a successful AES-GCM unlock; a wrong password fails the
     GCM auth tag. No password hash is ever stored or synced. */
  async function loginWrap(password) { return wrapKey(genKey(), password); }
  async function verifyLogin(w, password) {
    if (!w || !w.salt || !w.iv || !w.ct) return false;
    try { await unwrapKey(w, password); return true; } catch (e) { return false; }
  }

  /* ---------------- password policy + generator ---------------- */
  /* 2026-10-25 (owner request): no length restrictions — any non-empty
     password is accepted everywhere (setup, add account, reset, change).
     Generated one-time passwords stay long (98 bits) — that is a feature,
     not a policy. */
  /* item 4 (2026-10-28): the vault and the cloud row are only as strong as the
     password wrapping them, and the data belongs to minors. Admin and manager
     get a real minimum plus a common-password block; teachers (whose accounts
     the admin provisions, often handed out on paper to type once) keep a
     lighter minimum. */
  const COMMON_PW = ['password', '123456', '12345678', '123456789', '1234567890', 'qwerty', 'abc123', 'password1', 'password123', '111111', '123123', '1234567891', '000000', '1234', '12345', 'iloveyou', 'qwerty123', '1q2w3e4r', 'admin', 'welcome', 'monkey', 'letmein', 'login', 'princess', 'dragon', 'sunshine', 'football', 'baseball', 'superman', 'batman', 'trustno1', 'master', 'shadow', 'michael', 'jennifer', 'charlie', 'jordan', 'harley', 'ranger', 'buster', 'thomas', 'tigger', 'robert', 'soccer', 'hockey', 'killer', 'george', 'sexy', 'andrew', 'summer'];
  function pwOk(role, pw) {
    if (!pw || typeof pw !== 'string') return 'Enter a password.';
    const isTeacher = role === 'teacher' || role === 'eal';   /* accounts may store either spelling */
    const min = isTeacher ? 6 : 8;
    if (pw.length < min) return 'Use at least ' + min + ' characters.';
    if (!isTeacher && COMMON_PW.indexOf(String(pw).toLowerCase()) !== -1) return 'That password is too common. Choose something others could not guess.';
    return null;   /* ok */
  }
  /* 20 random chars from a 30-symbol no-lookalike alphabet, grouped 5-5-5-5:
     30^20 = 2^98 bits of entropy straight from crypto.getRandomValues. */
  const PW_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyu';   /* 30 unambiguous symbols */
  function genPassword() {
    const c = C();
    const groups = [];
    for (let g = 0; g < 4; g++) {
      const bytes = c.getRandomValues(new Uint8Array(5));
      let part = '';
      for (let i = 0; i < 5; i++) part += PW_ALPHABET[bytes[i] % PW_ALPHABET.length];
      groups.push(part);
    }
    return groups.join('-');
  }
  function genPasswordBits() { return Math.floor(20 * Math.log2(PW_ALPHABET.length)); }   /* 20 chars * log2(30) = 98 */

  /* ---------------- class blob (encrypted workbook) ---------------- */
  async function sealClass(obj, keyBytes) {
    const c = C();
    const iv = c.getRandomValues(new Uint8Array(12));
    const k = await aesKey(keyBytes);
    const pt = new (TE())().encode(JSON.stringify(obj));
    const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, pt));
    return { v: 1, iv: b64uFromBytes(iv), ct: b64uFromBytes(ct), sum: await contentSum(obj) };
  }
  async function openClass(blob, keyBytes) {
    const k = await aesKey(keyBytes);
    const pt = await C().subtle.decrypt({ name: 'AES-GCM', iv: bytesFromB64u(blob.iv) }, k, bytesFromB64u(blob.ct));
    return JSON.parse(new (TD())().decode(pt));
  }
  /* stable content digest of the DECRYPTED workbook — the blob ciphertext
     changes on every seal (fresh IV), so change detection uses this instead */
  async function contentSum(obj) {
    const d = await C().subtle.digest('SHA-256', new (TE())().encode(JSON.stringify(obj)));
    return b64uFromBytes(new Uint8Array(d)).slice(0, 22);
  }

  /* ---------------- roles ---------------- */
  const ROLES = ['admin', 'manager', 'eal', 'support'];
  const ROLE_LABEL = { admin: 'Admin', manager: 'Manager (read-only)', eal: 'EAL teacher', support: 'Supporting teacher' };
  const ROLE_ALIASES = [
    [/admin/i, 'admin'], [/^manager\b|management|sees whole school/i, 'manager'],
    [/^eal\b|eal teacher/i, 'eal'], [/support/i, 'support'], [/^teacher$/i, 'eal'],
  ];
  function normalizeRole(s) {
    const t = String(s || '').trim();
    for (const [re, r] of ROLE_ALIASES) if (re.test(t)) return r;
    return null;
  }
  function roleLabel(r) { return ROLE_LABEL[r] || r || ''; }
  function isClassOf(user, cls) {
    if (!cls) return false;
    return cls.eal === user.username || cls.support === user.username;
  }
  /* The single permission matrix. Actions:
     view          — open the class workbook (read)
     edit.obs      — edit observation cells directly
     edit.scores   — edit spelling / daily assignment / test cells
     edit.roster   — add/remove/edit students of the class
     request.obs   — propose an observation change (goes to the EAL for approval)
     review        — approve / reject proposed observation changes
     export.class  — export / print / back up this class
     audit.view    — read the class audit log
     manage.accounts / manage.classes / migrate / export.all — admin only
  */
  function can(user, action, cls) {
    if (!user || !user.username) return false;
    const r = user.role;
    if (r === 'admin') return true;
    if (action === 'manage.accounts' || action === 'manage.classes' || action === 'migrate' || action === 'export.all') return false;
    if (r === 'manager') return action === 'view' || action === 'audit.view';
    if (!isClassOf(user, cls)) return false;
    if (r === 'eal') {
      return ['view', 'edit.obs', 'edit.scores', 'edit.roster', 'review', 'export.class', 'audit.view'].indexOf(action) !== -1;
    }
    if (r === 'support') {
      return ['view', 'edit.scores', 'request.obs', 'audit.view'].indexOf(action) !== -1;
    }
    return false;
  }
  /* classes a user may see at all (admin/manager: all; eal/support: theirs) */
  function classesFor(user, index) {
    if (!user) return [];
    if (user.role === 'admin' || user.role === 'manager') return index.slice();
    return index.filter((c) => isClassOf(user, c));
  }

  /* ---------------- audit log (append-only by convention) ---------------- */
  const AUDIT_MAX = 5000;   /* localStorage is finite; the OLDEST entries drop
                               off first and the docs say so. Full history also
                               lives in every downloaded backup. */
  function logAudit(wb, entry) {
    if (!Array.isArray(wb.audit)) wb.audit = [];
    wb.audit.push(Object.assign({ t: Date.now() }, entry));
    if (wb.audit.length > AUDIT_MAX) wb.audit = wb.audit.slice(wb.audit.length - AUDIT_MAX);
    return wb.audit.length;
  }

  /* ---------------- pending observation changes ----------------
     A supporting teacher's observation edit NEVER touches the score: it is
     stored as a proposal and applied only when the paired EAL approves. */
  function obsCell(wb, semId, sid, month, key) {
    const sem = (wb.semesters || []).find((s) => s.id === semId);
    if (!sem) return undefined;
    return sem.observations && sem.observations[sid] && sem.observations[sid][month] && sem.observations[sid][month][key];
  }
  function requestChange(wb, req) {
    if (!req || !req.semId || !req.sid || !req.month || !req.key) return { error: 'incomplete request' };
    if (req.newValue === null || req.newValue === undefined || typeof req.newValue !== 'number') return { error: 'newValue must be a number' };
    if (!Array.isArray(wb.pending)) wb.pending = [];
    const oldValue = obsCell(wb, req.semId, req.sid, req.month, req.key);
    const id = 'pc-' + Date.now().toString(36) + '-' + (wb.pending.length + 1);
    wb.pending.push({
      id: id, kind: 'obs', semId: req.semId, sid: req.sid, month: req.month, key: req.key,
      oldValue: oldValue === undefined ? null : oldValue, newValue: req.newValue,
      requestedBy: req.by || '', time: req.t || Date.now(), note: String(req.note || '').slice(0, 300),
    });
    logAudit(wb, { by: req.by || '', action: 'obs.request', cell: req.semId + '/' + req.sid + '/' + req.month + '/' + req.key, old: oldValue === undefined ? null : oldValue, new: req.newValue, note: req.note || '' });
    return { ok: true, id: id };
  }
  function applyObs(wb, p) {
    const sem = (wb.semesters || []).find((s) => s.id === p.semId);
    if (!sem) return 'semester missing';
    if (!sem.observations[p.sid]) sem.observations[p.sid] = {};
    if (!sem.observations[p.sid][p.month]) sem.observations[p.sid][p.month] = {};
    sem.observations[p.sid][p.month][p.key] = p.newValue;
    return null;
  }
  function approveChange(wb, id, decision) {
    const i = (wb.pending || []).findIndex((p) => p.id === id);
    if (i < 0) return { error: 'no such pending change' };
    const p = wb.pending[i];
    const cell = p.semId + '/' + p.sid + '/' + p.month + '/' + p.key;
    const err = applyObs(wb, p);
    if (err) return { error: err };
    wb.pending.splice(i, 1);   /* apply + remove + audit as one mutation set */
    logAudit(wb, { by: (decision && decision.by) || '', action: 'obs.approve', cell: cell, old: p.oldValue, new: p.newValue, note: 'requested by ' + p.requestedBy + ((decision && decision.reason) ? ' — ' + decision.reason : '') });
    return { ok: true };
  }
  function rejectChange(wb, id, decision) {
    const i = (wb.pending || []).findIndex((p) => p.id === id);
    if (i < 0) return { error: 'no such pending change' };
    const p = wb.pending[i];
    wb.pending.splice(i, 1);   /* the stored score is never touched */
    logAudit(wb, { by: (decision && decision.by) || '', action: 'obs.reject', cell: p.semId + '/' + p.sid + '/' + p.month + '/' + p.key, old: p.oldValue, new: p.newValue, note: 'requested by ' + p.requestedBy + ((decision && decision.reason) ? ' — ' + decision.reason : '') });
    return { ok: true };
  }

  /* ---------------- migration planner (single markbook -> classes) ---------------- */
  function classKeyOf(sem) { return (String(sem.school || '').trim() + '·' + String(sem.className || '').trim() || '·') ; }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'class'; }
  function countCells(sem) {
    let n = 0;
    const bump = (o) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'number') n++; else if (v && typeof v === 'object') bump(v); } };
    bump(sem.observations); bump(sem.spelling); bump(sem.daily); bump(sem.tests);
    return n;
  }
  /* Dry run: group semesters into classes, count what will move, flag problems.
     NEVER mutates db. */
  function planMigration(db) {
    const groups = new Map();
    for (const sem of (db && db.semesters) || []) {
      const k = classKeyOf(sem);
      if (!groups.has(k)) groups.set(k, { school: String(sem.school || '').trim(), name: String(sem.className || '').trim() || 'Unassigned class', semesters: [] });
      groups.get(k).semesters.push(sem);
    }
    const classes = [];
    const warnings = [];
    for (const g of groups.values()) {
      const students = new Set();
      let cells = 0;
      for (const s of g.semesters) { cells += countCells(s); for (const st of s.students || []) students.add(st.id); }
      const id = 'c-' + slug(g.name) + '-' + Math.random().toString(36).slice(2, 6);
      classes.push({ id: id, name: g.name, school: g.school, eal: '', support: '', semCount: g.semesters.length, studentCount: students.size, cellCount: cells, semIds: g.semesters.map((s) => s.id) });
      if (!String(g.name || '').trim()) warnings.push('One group has no class name — review it before migrating (shown as "Unassigned class").');
    }
    const legacyTeachers = ((db && db.settings && db.settings._usernames) || []);
    if (classes.length > 1) warnings.push(classes.length + ' separate classes were found in the single markbook — each becomes its own workbook after migration.');
    return { classes: classes, warnings: warnings.filter((w, i, a) => a.indexOf(w) === i) };
  }
  /* Apply: seal each class under a fresh random key, wrap keys per account.
     opts = {
       plan, db,
       pairings:  { classId: {eal, support} },
       users:     [{username, role}] (roles already migrated: teacher->eal),
       passwords: { username: password } for accounts keyed NOW (admin's own
                   password must be here); others get generated passwords back
     }
     Returns everything the caller must persist — db itself is not touched. */
  async function applyMigration(db, opts) {
    const plan = opts.plan;
    const byId = new Map();
    for (const g of plan.classes) byId.set(g.id, Object.assign({}, g, { semesters: [] }));
    for (const sem of db.semesters) {
      const g = plan.classes.find((c) => c.semIds.indexOf(sem.id) !== -1);
      if (g) byId.get(g.id).semesters.push(sem);
    }
    const index = [];
    const blobs = {};
    const keyrings = {};
    const newPasswords = {};
    for (const c of plan.classes) {
      const grp = byId.get(c.id);   /* plan rows carry ids only; byId rows carry the semesters */
      const pair = (opts.pairings && opts.pairings[c.id]) || {};
      const key = genKey();
      const wb = {
        sprClass: 1, id: c.id, name: c.name, school: c.school,
        eal: pair.eal || '', support: pair.support || '',
        settings: Object.assign({}, db.settings || {}),
        currentSemesterId: grp.semesters.length ? grp.semesters[grp.semesters.length - 1].id : null,
        semesters: grp.semesters, pending: [], audit: [],
      };
      logAudit(wb, { by: (opts.adminUser || ''), action: 'migrate', note: 'split from the single markbook (' + grp.semesters.length + ' semester(s))' });
      blobs[c.id] = await sealClass(wb, key);
      index.push({ id: c.id, name: c.name, school: c.school, eal: pair.eal || '', support: pair.support || '', createdAt: Date.now(), updatedAt: Date.now() });
      /* who gets this class's key? admin + managers: all; eal/support: their own */
      for (const u of opts.users || []) {
        const mine = u.role === 'admin' || u.role === 'manager' || pair.eal === u.username || pair.support === u.username;
        if (!mine) continue;
        let pw = (opts.passwords || {})[u.username];
        if (!pw) { pw = (opts.generatePassword ? opts.generatePassword(u.username) : null) || ('spr-' + Math.random().toString(36).slice(2, 10)); newPasswords[u.username] = pw; }
        keyrings[u.username] = keyrings[u.username] || {};
        keyrings[u.username][c.id] = await wrapKey(key, pw);
      }
    }
    return { mode: 'class', index: index, blobs: blobs, keyrings: keyrings, newPasswords: newPasswords };
  }

  /* ---------------- roster CSV (account template) ---------------- */
  function csvRows(text) {
    const s = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    return rows;
  }
  /* The admin's roster template: username, display_name, role, class_or_grade,
     paired_with, status. Roles arrive as display strings. Pairing must be
     mutual (eal-01 <-> sup-01); the class link itself is assigned later. */
  function parseRosterCsv(text) {
    const rows = csvRows(text);
    const users = [];
    const errors = [];
    const warnings = [];
    if (!rows.length) return { users: users, errors: ['empty file'], warnings: warnings };
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name) => head.indexOf(name);
    const iU = col('username'), iD = col('display_name'), iR = col('role'), iC = col('class_or_grade'), iP = col('paired_with');
    if (iU < 0 || iR < 0) return { users: [], errors: ['need at least "username" and "role" columns'], warnings: [] };
    for (let r = 1; r < rows.length; r++) {
      const c = rows[r];
      const username = String(c[iU] || '').trim().toLowerCase();
      const roleRaw = String(c[iR] || '').trim();
      if (!username) { errors.push('row ' + (r + 1) + ': missing username'); continue; }
      if (!/^[a-z0-9][a-z0-9_-]{1,30}$/.test(username)) { errors.push('row ' + (r + 1) + ': bad username "' + username.slice(0, 20) + '" (letters, digits, - and _ only)'); continue; }
      const role = normalizeRole(roleRaw);
      if (!role) { errors.push('row ' + (r + 1) + ': unknown role "' + roleRaw.slice(0, 30) + '"'); continue; }
      if (users.some((u) => u.username === username)) { errors.push('row ' + (r + 1) + ': duplicate username ' + username); continue; }
      users.push({
        username: username,
        display_name: iD >= 0 ? String(c[iD] || '').trim().slice(0, 40) : '',
        role: role,
        class_or_grade: iC >= 0 ? String(c[iC] || '').trim().slice(0, 40) : '',
        paired_with: iP >= 0 ? String(c[iP] || '').trim().toLowerCase() : '',
        status: (c.length > 5 ? String(c[5] || '').trim() : ''),
      });
    }
    /* mutuality of pairing */
    const byName = new Map(users.map((u) => [u.username, u]));
    for (const u of users) {
      if (!u.paired_with) { if (u.role === 'eal' || u.role === 'support') warnings.push(u.username + ' (' + roleLabel(u.role) + ') has no pair in this file — pair them later in Manage.'); continue; }
      const p = byName.get(u.paired_with);
      if (!p) warnings.push(u.username + ' is paired with "' + u.paired_with + '" which is not in this file.');
      else if (p.paired_with !== u.username) warnings.push(u.username + ' <-> ' + p.username + ' pairing is one-sided.');
    }
    return { users: users, errors: errors, warnings: warnings };
  }

  /* ---------------- class file + share-link codecs ---------------- */
  function classFile(meta, blob) {
    return { spr: 1, type: 'spr-class-file', id: meta.id, name: meta.name, school: meta.school, eal: meta.eal || '', support: meta.support || '', blob: blob };
  }
  function parseClassFile(json) {
    if (!json || json.spr !== 1 || json.type !== 'spr-class-file' || !json.id || !json.blob || !json.blob.iv || !json.blob.ct) throw new Error('not a valid SPR class file');
    return { id: String(json.id), name: String(json.name || ''), school: String(json.school || ''), eal: String(json.eal || ''), support: String(json.support || ''), blob: json.blob };
  }
  function classLink(origin, pathname, classId, keyB64) {
    return origin + pathname + '#class=' + encodeURIComponent(classId) + '&k=' + encodeURIComponent(keyB64);
  }
  function parseClassHash(hash) {
    const m = String(hash || '').match(/#class=([^&]+)&k=([^&]+)/);
    if (!m) return null;
    try { return { id: decodeURIComponent(m[1]), k: decodeURIComponent(m[2]) }; } catch (e) { return null; }
  }

  return {
    b64uFromBytes: b64uFromBytes, bytesFromB64u: bytesFromB64u,
    genKey: genKey, wrapKey: wrapKey, unwrapKey: unwrapKey,
    wrapNeedsUpgrade: wrapNeedsUpgrade, rewrapKey: rewrapKey,
    loginWrap: loginWrap, verifyLogin: verifyLogin,
    pwOk: pwOk, genPassword: genPassword, genPasswordBits: genPasswordBits,
    sealClass: sealClass, openClass: openClass, contentSum: contentSum,
    ROLES: ROLES, normalizeRole: normalizeRole, roleLabel: roleLabel,
    can: can, classesFor: classesFor, isClassOf: isClassOf,
    AUDIT_MAX: AUDIT_MAX, logAudit: logAudit,
    requestChange: requestChange, approveChange: approveChange, rejectChange: rejectChange, obsCell: obsCell,
    planMigration: planMigration, applyMigration: applyMigration, countCells: countCells,
    parseRosterCsv: parseRosterCsv, csvRows: csvRows,
    classFile: classFile, parseClassFile: parseClassFile, classLink: classLink, parseClassHash: parseClassHash,
  };
});
