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
        cellLog: {}, rosterLog: {}, exchanges: [],
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

  /* ==================== two-teacher merge (2026-11-02) ====================
     Offline class-file exchange between the two teachers of a class. Every
     score edit stamps wb.cellLog[cellKey] = {t, by}; every import appends to
     wb.exchanges. A cell CONFLICTS when both copies changed it after the last
     exchange (both t > base) and now hold different values — those are listed
     for the importing teacher to decide. One-sided edits are taken silently
     (the newer edit wins), additions (students, semesters, months) merge in.

     cellLog key shapes:
       s/<semId>/<sid>/obs/<month>/<obsKey>     observation cell (number)
       s/<semId>/<sid>/sp|da/<month>/<w>        spelling / daily week record {s,t}
       s/<semId>/<sid>/tst/<tp>/<s|t>           test record field
       n/<semId>/<sid>/<field>                  report-card note text
     rosterLog: { [sid]: {t, by, rm?} } — rm:true stamps a removal. */
  const CELL_LOG_MAX = 5000;
  function cellKey(semId, sid, area, col, sub) {
    if (area === 'note') return 'n/' + semId + '/' + sid + '/' + col;
    return 's/' + semId + '/' + sid + '/' + area + '/' + col + (sub !== undefined && sub !== null && sub !== '' ? '/' + sub : '');
  }
  function stampCell(wb, key, by, t) {
    if (!wb) return;
    const log = (wb.cellLog = wb.cellLog || {});
    log[key] = { t: t || Date.now(), by: by || '' };
    const ks = Object.keys(log);
    if (ks.length > CELL_LOG_MAX) {   /* oldest entries drop off first; a cell
        with no entry on one side is treated as a conflict (safe side) */
      ks.sort((a, b) => (log[a].t || 0) - (log[b].t || 0));
      for (let i = 0; i < ks.length - CELL_LOG_MAX; i++) delete log[ks[i]];
      wb.cellLogPruned = true;
    }
  }
  function stampRoster(wb, semId, sid, by, removed) {
    if (!wb) return;
    const log = (wb.rosterLog = wb.rosterLog || {});
    log[sid] = { t: Date.now(), by: by || '', semId: semId || '' };
    if (removed) log[sid].rm = true; else delete log[sid].rm;
  }
  const AREAS = { obs: 'observations', sp: 'spelling', da: 'daily', tst: 'tests' };
  /* canonical cell read/write so merge never has to know each area's shape.
     Key shapes: s/<semId>/<sid>/obs/<month>/<obsKey>
                 s/<semId>/<sid>/sp|da/<month>/<week>/<s|t>
                 s/<semId>/<sid>/tst/<tp>/<s|t>
                 n/<semId>/<sid>/<field> */
  function cellGet(wb, key) {
    if (!wb || !key) return undefined;
    const p = key.split('/');
    try {
      if (p[0] === 'n') {
        const sem = wb.semesters.find((s) => s.id === p[1]);
        const v = sem && sem.reportNotes && sem.reportNotes[p[2]] && sem.reportNotes[p[2]][p[3]];
        return (v === undefined || v === '') ? undefined : v;
      }
      const sem = wb.semesters.find((s) => s.id === p[1]);
      if (!sem) return undefined;
      const sid = p[2], area = p[3], col = p[4], sub = p[5], f = p[6];
      if (area === 'obs') {
        const o = sem.observations && sem.observations[sid] && sem.observations[sid][col];
        if (!o) return undefined;
        return sub === undefined ? o : o[sub];
      }
      if (area === 'sp' || area === 'da') {
        const met = AREAS[area];
        const wk = sem[met] && sem[met][sid] && sem[met][sid][col] && sem[met][sid][col][sub];
        if (!wk) return undefined;
        if (f === undefined) return (wk.s === null && wk.t === null) ? undefined : wk;
        return (wk[f] === null || wk[f] === undefined) ? undefined : wk[f];
      }
      if (area === 'tst') {
        const rec = sem.tests && sem.tests[sid] && sem.tests[sid][col];
        if (!rec) return undefined;
        return sub === undefined ? ((rec.s === null && rec.t === null) ? undefined : rec) : ((rec[sub] === null || rec[sub] === undefined) ? undefined : rec[sub]);
      }
      return undefined;
    } catch (e) { return undefined; }
  }
  function cellSet(wb, key, value) {
    if (!wb || !key) return;
    const p = key.split('/');
    try {
      if (p[0] === 'n') {
        const sem = wb.semesters.find((s) => s.id === p[1]);
        if (sem) { sem.reportNotes = sem.reportNotes || {}; sem.reportNotes[p[2]] = sem.reportNotes[p[2]] || {}; if (value === undefined) delete sem.reportNotes[p[2]][p[3]]; else sem.reportNotes[p[2]][p[3]] = value; }
        return;
      }
      const sem = wb.semesters.find((s) => s.id === p[1]);
      if (!sem) return;
      const sid = p[2], area = p[3], col = p[4], sub = p[5], f = p[6];
      if (area === 'obs') {
        sem.observations = sem.observations || {}; sem.observations[sid] = sem.observations[sid] || {}; sem.observations[sid][col] = sem.observations[sid][col] || {};
        if (sub === undefined) { if (value === undefined) delete sem.observations[sid][col]; else sem.observations[sid][col] = value; }
        else if (value === undefined) { delete sem.observations[sid][col][sub]; if (!Object.keys(sem.observations[sid][col]).length) delete sem.observations[sid][col]; }
        else sem.observations[sid][col][sub] = value;
        return;
      }
      if (area === 'sp' || area === 'da') {
        const met = AREAS[area];
        sem[met] = sem[met] || {}; sem[met][sid] = sem[met][sid] || {}; sem[met][sid][col] = sem[met][sid][col] || {};
        sem[met][sid][col][sub] = sem[met][sid][col][sub] || { s: null, t: null };
        if (value === undefined) { delete sem[met][sid][col][sub][f]; if (sem[met][sid][col][sub].s === null && sem[met][sid][col][sub].t === null) delete sem[met][sid][col][sub]; }
        else sem[met][sid][col][sub][f] = value;
        return;
      }
      if (area === 'tst') {
        sem.tests = sem.tests || {}; sem.tests[sid] = sem.tests[sid] || {}; sem.tests[sid][col] = sem.tests[sid][col] || { s: null, t: null };
        if (value === undefined) { delete sem.tests[sid][col][sub]; if (sem.tests[sid][col].s === null && sem.tests[sid][col].t === null) delete sem.tests[sid][col]; }
        else sem.tests[sid][col][sub] = value;
      }
    } catch (e) {}
  }
  function lastExchangeAt(wb) {
    const ex = (wb && wb.exchanges) || [];
    return ex.length ? ex[ex.length - 1].at : 0;
  }
  function sameVal(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }

  /* Merge colleague's workbook (incoming) into the local one. PURE: returns a
     fresh merged workbook + a conflict list; never mutates the inputs. The
     caller applies conflict decisions (keep mine = already in `merged`;
     take theirs = cellSet(merged, key, remoteValue); proposal = requestChange). */
  function mergeWorkbooks(local, incoming, opts) {
    opts = opts || {};
    const by = opts.by || 'colleague';
    const now = opts.now || Date.now();
    const base = Math.max(lastExchangeAt(local), lastExchangeAt(incoming));
    const merged = JSON.parse(JSON.stringify(local));
    const conflicts = [];
    const stats = { taken: 0, kept: 0, addedSemesters: 0, addedStudents: 0, removedStudents: 0, addedNotes: 0 };

    /* ---- semesters: add new ones, merge shared ones ---- */
    for (const isem of (incoming && incoming.semesters) || []) {
      if (!isem || !isem.id) continue;
      let lsem = merged.semesters.find((s) => s.id === isem.id);
      if (!lsem) {
        merged.semesters.push(JSON.parse(JSON.stringify(isem)));
        stats.addedSemesters++;
        continue;
      }
      /* months: union, local order first */
      for (const m of isem.months || []) if (lsem.months.indexOf(m) === -1) lsem.months.push(m);
      /* students: additions + name conflicts + colleague removals */
      const inIds = new Set((isem.students || []).map((s) => s.id));
      for (const istu of isem.students || []) {
        const lstu = lsem.students.find((s) => s.id === istu.id);
        if (!lstu) { lsem.students.push(JSON.parse(JSON.stringify(istu))); stats.addedStudents++; continue; }
        if (!sameVal({ n: lstu.nameEn, c: lstu.nameCn }, { n: istu.nameEn, c: istu.nameCn })) {
          const rlog = (incoming.rosterLog || {})[istu.id] || {};
          const llog = (local.rosterLog || {})[istu.id] || {};
          if ((rlog.t || 0) > base && (llog.t || 0) > base) {
            conflicts.push({ kind: 'student', semId: lsem.id, sid: istu.id,
              local: { nameEn: lstu.nameEn, nameCn: lstu.nameCn, t: llog.t || 0, by: llog.by || '' },
              remote: { nameEn: istu.nameEn, nameCn: istu.nameCn, t: rlog.t || 0, by: rlog.by || '' } });
          } else if ((rlog.t || 0) > (llog.t || 0)) {
            lstu.nameEn = istu.nameEn; lstu.nameCn = istu.nameCn; stats.taken++;
          }
        }
      }
      for (const lstu of lsem.students.slice()) {
        if (inIds.has(lstu.id)) continue;
        const rlog = (incoming.rosterLog || {})[lstu.id];
        if (rlog && rlog.rm && rlog.t > base) {
          /* guard (2026-11-02): if WE edited or re-added this student since the
             last exchange, removing silently would eat our work — review first */
          const weEdited = Object.keys((local.cellLog || {})).some(function (k) {
            return k.split('/')[2] === lstu.id && (local.cellLog[k] || {}).t > base;
          });
          const lrl = ((local.rosterLog || {})[lstu.id] || {});
          const weAdded = !lrl.rm && lrl.t > base;
          if (weEdited || weAdded) {
            conflicts.push({ kind: 'student-del', semId: lsem.id, sid: lstu.id,
              local: { nameEn: lstu.nameEn, nameCn: lstu.nameCn, t: lrl.t || 0, by: lrl.by || '' },
              remote: { removed: true, t: rlog.t, by: rlog.by || '' } });
            stats.kept++;
            continue;
          }
          lsem.students = lsem.students.filter((s) => s.id !== lstu.id);
          for (const met of ['observations', 'spelling', 'daily', 'tests']) { if (lsem[met]) delete lsem[met][lstu.id]; }
          stats.removedStudents++;
        }
      }
    }

    /* ---- cells + notes: walk the union of both logs ---- */
    const keys = new Set([].concat(Object.keys((local && local.cellLog) || {}), Object.keys((incoming && incoming.cellLog) || {})));
    for (const key of keys) {
      const lv = cellGet(merged, key);
      const rv = cellGet(incoming, key);
      if (sameVal(lv, rv)) continue;
      const ll = (local.cellLog || {})[key];
      const rl = (incoming.cellLog || {})[key];
      const lchg = !!(ll && ll.t > base);
      const rchg = !!(rl && rl.t > base);
      if (lchg && rchg) {
        conflicts.push({ kind: key.charAt(0) === 'n' ? 'note' : 'cell', key: key,
          local: { v: lv, t: (ll && ll.t) || 0, by: (ll && ll.by) || '' },
          remote: { v: rv, t: (rl && rl.t) || 0, by: (rl && rl.by) || '' } });
      } else if (rchg && !ll) {
        /* our copy has no edit recorded for this cell: take the colleague's */
        cellSet(merged, key, rv); (merged.cellLog = merged.cellLog || {})[key] = { t: rl.t, by: rl.by }; stats.taken++;
      } else if (rchg && !lchg) {
        cellSet(merged, key, rv); merged.cellLog[key] = { t: rl.t, by: rl.by }; stats.taken++;
      } else if (!rl && ll) {
        /* colleague's copy never logged an edit but holds a different value
           (pre-log history): let a human decide */
        conflicts.push({ kind: key.charAt(0) === 'n' ? 'note' : 'cell', key: key,
          local: { v: lv, t: ll.t || 0, by: ll.by || '' }, remote: { v: rv, t: 0, by: '' } });
      } else if ((rl.t || 0) > (ll.t || 0)) {
        cellSet(merged, key, rv); merged.cellLog[key] = { t: rl.t, by: rl.by }; stats.taken++;
      } else stats.kept++;
    }

    /* ---- pending proposals + audit: union, no duplicates ---- */
    const haveP = new Set((merged.pending || []).map((p) => p.id));
    for (const p of (incoming.pending || []) || []) if (!haveP.has(p.id)) (merged.pending = merged.pending || []).push(JSON.parse(JSON.stringify(p)));
    const haveR = new Set((merged.review || []).map((r) => JSON.stringify(r)));
    for (const r of (incoming.review || []) || []) { const j = JSON.stringify(r); if (!haveR.has(j)) { merged.review.push(JSON.parse(JSON.stringify(r))); haveR.add(j); } }
    merged.audit = merged.audit || [];
    const auditSeen = new Set(merged.audit.map((a) => (a.t || 0) + '|' + (a.action || '') + '|' + (a.cell || '') + '|' + (a.note || '')));
    for (const a of (incoming.audit || []) || []) { const k = (a.t || 0) + '|' + (a.action || '') + '|' + (a.cell || '') + '|' + (a.note || ''); if (!auditSeen.has(k)) { merged.audit.push(a); auditSeen.add(k); } }
    if (merged.audit.length > AUDIT_MAX) merged.audit = merged.audit.slice(merged.audit.length - AUDIT_MAX);

    /* ---- pairing metadata: take the newer non-empty values ---- */
    if (incoming.eal && incoming.eal !== merged.eal) merged.eal = incoming.eal;
    if (incoming.support && incoming.support !== merged.support) merged.support = incoming.support;

    /* ---- the exchange point: both sides now share this base ---- */
    (merged.exchanges = merged.exchanges || []).push({ at: now, by: by, kind: 'file-merge' });
    logAudit(merged, { by: by, action: 'merge', note: 'merged a colleague class file: ' + stats.taken + ' cell(s) taken, ' + conflicts.length + ' conflict(s) found, +' + stats.addedStudents + ' student(s)' });
    return { merged: merged, conflicts: conflicts, base: base, stats: stats };
  }
  /* apply one conflict decision to a merged workbook (kept local by default) */
  function applyConflict(wb, c, decision, by) {
    if (!wb || !c) return;
    if (decision === 'theirs') {
      if (c.kind === 'student') {
        const sem = wb.semesters.find((s) => s.id === c.semId);
        const stu = sem && sem.students.find((s) => s.id === c.sid);
        if (stu) { stu.nameEn = c.remote.nameEn; stu.nameCn = c.remote.nameCn; }
      } else if (c.kind === 'student-del') {
        const sem = wb.semesters.find((s) => s.id === c.semId);
        if (sem) {
          sem.students = sem.students.filter((s) => s.id !== c.sid);
          for (const met of ['observations', 'spelling', 'daily', 'tests']) { if (sem[met]) delete sem[met][c.sid]; }
        }
      } else { cellSet(wb, c.key, c.remote.v); if (c.key) { (wb.cellLog = wb.cellLog || {})[c.key] = { t: Date.now(), by: by || 'merge' }; } }
    } else if (decision === 'proposal') {
      if (c.key && c.key.split('/')[3] === 'obs' && c.remote && typeof c.remote.v === 'number') {
        const p = c.key.split('/');
        requestChange(wb, { semId: p[1], sid: p[2], month: p[4], key: p[5], newValue: c.remote.v, by: by || 'merge', note: 'colleague value kept as a proposal during merge' });
      }
    }
    /* 'mine' = nothing to do: merged already holds the local value */
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
    cellKey: cellKey, stampCell: stampCell, stampRoster: stampRoster, cellGet: cellGet, cellSet: cellSet,
    mergeWorkbooks: mergeWorkbooks, applyConflict: applyConflict, lastExchangeAt: lastExchangeAt,
  };
});
