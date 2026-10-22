# Device Sync — cell-level three-way merge: design & decisions

Branch `improve/sync-merge-and-claims`. Written **before** coding (Step 0 of the
brief); every claim below was verified against the code at commit `8853c36`.

## 1. Verified data model

**Local state (plaintext, in memory / sessionStorage mirror)**
`DB = { v:1, currentSemesterId, semesters[], credit, author, settings:{autoTotal, spTotal, daTotal, lastBackupAt, …} }`

**Encrypted at rest** — `localStorage['p4c4-markbook-v2']`:
`{ fmt:2, wraps:{ <username>:wrap, __master__:wrap }, data:sealDB(DB, dk), ts }`
The 256-bit data key `dk` is random, wrapped once per user password (PBKDF2 →
AES-GCM wrap); `SESSION.dk` lives only in memory + sessionStorage.

**Device-sync payload** — `dsSeal()` seals under the random 256-bit *sync key*
(a completely separate key that lives only in the pairing link / JSON backups):
`{ sprDS:1, ts, sum, users:[{username,hash,name,role}], v2:{fmt,wraps,data,ts} }`
→ stored as `payload` of one `spr_channels` row (`share_name='devicesync'`),
with `pushed_by` (`"<device> — <username>"`) and `pushed_at`.

**Semester** (verified in `normalizeSemester` + seed):
`{ id, name, school, className, teachers[], months:[names], students:[{id,nameCn,nameEn,gender,…}], observations[sid][month]["<Skill>-LO1|LO2"], spelling[sid][month][weekIdx]={s,t}, daily[sid][month][weekIdx]={s,t}, tests[sid][kind]={s,t}, reportNotes[sid] }`
Grading (`calc.js`, untouched): 8 components × 10 % + Written 20 %; bands
A\*>84 / A>74 / B>64 / C>54 / D>49 / U; `FINAL_MIN_ASSESSED = 6` of 9;
`gradeStudent().gate` is already `'not-assessed' | 'provisional' | 'final'`.

**Accounts** — `localStorage['spr-auth-v1'] = { users:[{username,hash,name,role}] }`.
`hash` is FNV-1a of the password; the matching data-key wrap sits in
`v2.wraps[username]`. Password change ⇒ **both** `hash` and `wrap` change together.

## 2. What is wrong today (verified)

`dsPushNow` computes a digest of *local* state and compares it with the cloud
row's digest. If they differ it simply PATCHes — it never asks whether the
**cloud** changed since this device last agreed with it. Two teachers on two
paired devices ⇒ the second push silently replaces the first teacher's fresh
scores in the cloud (and the next pull on device 1 would offer to clobber
device 2 in return). Last-save-wins is only honest for one author per channel.

## 3. Merge design

### 3.1 Unit of merge
Every editable thing is addressed as a (semester, student, section, month,
week/key) cell or a standalone record:

| Section | Unit | Key |
|---|---|---|
| observations | one LO score (number 0–10) | `sid / month / "<Skill>-LO#"` |
| spelling, daily | one weekly `{s,t}` record | `sid / month / weekIdx` |
| tests | one `{s,t}` record | `sid / kind` |
| students | one student row | `id` (never the name) |
| months list | the semester's month list | union, base order first |
| reportNotes | one note blob | `sid` |
| semesters | one semester container | `id` |
| settings, currentSemesterId, credit | per key | key |
| users + wraps | one account (hash+wrap move together) | `username` |

### 3.2 The pure function — `source/merge.js` (UMD, like `calc.js`)

```
SPRMerge.merge(base, local, cloud) -> { merged, conflicts[], stats }
```

* Inputs/outputs are **sync-state objects**: `{ users:[…], db:{…} }`.
  (`wraps` are handled as part of the account unit — see 3.4 — so the caller
  passes `users` and `db`; the wrap map is merged by the *app* alongside the
  account list, keyed identically. Deviation from the naive "one blob" model,
  made because a hash without its matching wrap would lock everybody out.)
* `merged` follows `local`'s shape and always keeps the owner's credit fields
  (`credit`, `author`) from local — a merge may never strip the credit.
* A **conflict** = same cell changed to *different* values on both sides
  (edit-vs-edit, or edit-vs-delete). Conflict items carry
  `{ unit, semesterId, semName, sid, studentName, section, month, week, key,
  label, base, local, cloud }` — everything the dialog needs except *who/when*,
  which the app adds from the cloud row (`pushed_by`/`pushed_at`) and this
  device. `SPRMerge.applyChoice(merged, conflict, 'mine'|'theirs')` applies a
  decision in place (path-safe, pure with respect to inputs' identity).
* Rules: one-sided change → take it; identical both sides → take it;
  delete-vs-unchanged → delete; delete-vs-edit → conflict; adds with different
  ids/usernames → keep both; **0 is a real score** — presence is tested with
  `hasOwnProperty`, never truthiness; `{s:0,t:20}` is data, `{}` is not.
* No DOM, no network, no storage; inputs are never mutated (deep-copied result).

### 3.3 Base snapshot (the "both sides agreed" state)
`localStorage['spr-dsbase-v1'] = { ts, sum, by, env:{sprBase:1, iv, ct, mac} }` —
the agreed `{users, db}` sealed with the **sync key** (AES-GCM + the same HMAC
construction as cloud payloads). Sealed, never plaintext, so it satisfies
"encrypted at rest"; using the sync key (not `dk`) means any paired user can
read it — exactly the audience that can already read the cloud copy. Updated
after **every** successful push, pull-install or merge; removed by *Turn off*.

### 3.4 Accounts: hash + wrap + master wrap move as one unit
Per `username`: if `hash` differs from base on exactly one side, take that
side's `users[i]` **and** `v2.wraps[username]` together (a password reset must
not arrive half-applied). Different hashes on both sides ⇒ conflict on that
account (password changed twice — human decides). `__master__` wrap follows the
same rule. Users added on one side are kept; removed on one side and unchanged
on the other are removed; `mo` can never be removed (existing rule preserved).

### 3.5 Flow changes in `app.js`
* `dsPushNow` (after the digest-equal shortcut and `sbGet`):
  * no base snapshot and cloud newer than boot ⇒ **legacy fallback**: the
    existing "newer copy is in the cloud" confirm + safety backup — documented
    as first-sync-after-upgrade only.
  * `base.sum === row.payload.sum` ⇒ cloud unchanged since agreement ⇒ push.
  * else ⇒ `merge(base, local, cloud)`:
    * 0 conflicts ⇒ install merged locally (validated, safety backup when it
      differs from local), push merged, save new base;
    * N conflicts ⇒ hold the push, show the conflict dialog; *Postpone* keeps
      both sides intact (local untouched, cloud untouched — nothing is lost;
      the next push/pull re-runs the same deterministic merge and re-offers).
* `dsPullCheckInner`: local unchanged vs base ⇒ straight install (today's
  behaviour, backup + confirm); local **and** cloud changed ⇒ the same merge
  flow as above.
* `dsInstall` / `dsFreshInstall` also write the base snapshot, so a freshly
  paired device never triggers a spurious merge on its first push.
* Installing a merged/fresh state happens **without a reload** when a session
  is live (`dsInstallState`: validate → normalize → re-seat `DB` → re-seal
  under the unchanged `SESSION.dk` → write V2 + auth → re-render); the dk is
  identical on every paired device because `wraps`+`data` travel as one unit.
* Debounce (4 s), 30 s failure retry and `dsHoldPush` (held while a decision
  dialog is open, audit fix F-1) all remain, and now also guard the conflict
  dialog.
* Status line (header chip + Manage card): `Synced · 2 min ago`, `Merging…`,
  `Cloud unreachable — your data is safe on this device`, `2 conflicts need
  your decision`. Calm colours; offline is informational, never red.

### 3.5 Conflict dialog (keyboard-operable)
One row per conflict: student display name, component label, month/week,
`This device` value vs `Cloud` value with author+time. Two radio groups per row
(natively focusable), `All mine` / `All theirs` shortcuts, `Postpone`, and
`Apply decisions`. Focus starts on the first radio; `Esc` = postpone. Actions
are disabled while a save is in flight; nothing is written to the cloud before
the user confirms.

## 4. Tests (Task 4)

`tests/merge.test.js` (plain node, `require`-based, zero dependencies) covers
the brief's matrix: identical edits; one-sided edits; disjoint
observations-vs-spelling edits; same-cell conflict with correct
student/component/month metadata; edit-vs-delete; delete-only; student added on
both sides; `{s}` without `t`; genuine 0 preserved; idempotence; symmetry;
input non-mutation; 30 students × 10 months × 5 weeks performance; a grading
regression proving `Calc.gradeAll` output is byte-identical on a fixed fake
dataset; and a two-device protocol simulation against an in-memory `sbGet`/
`sbSave` fake (push → edit on both → merge-push → pull-merge → no edit lost).

## 5. Decisions & deviations (per the brief's instruction)

1. **Merge inputs are `{users, db}` pairs, wraps merged by the app** — a hash
   without its wrap (or vice versa) would brick sign-in; keeping them as one
   atomic unit is the conservative choice.
2. **Base snapshot sealed with the sync key**, not `dk` — same exposure class
   as the cloud copy (paired devices can read both), zero new key management.
3. **Postponing re-derives the conflicts next time** instead of persisting a
   queue: the merge is deterministic and both sides' data is untouched, so a
   persisted queue adds state that can go stale for no benefit.
4. **Legacy fallback retained only where the brief allows**: no base snapshot
   and a newer cloud ⇒ existing confirm+safety-backup dialog, never a silent
   overwrite (today's silent replace is the bug we are fixing).
5. **`dsSyncActive()` (all signed-in users push) stays**, as the brief's item 9
   instructs; docs are updated to match the code.
6. **Web-app manifest: skipped** (SW notes say intentionally omitted; proving
   it cannot perturb the version hash is not worth the risk before a demo).
7. **Weights/bands stay literal in `calc.js` computation**; the "How grades are
   calculated" panel reads `COMPONENTS_ALL`, `FINAL_MIN_ASSESSED` and the
   existing literals via new *exports only* — no computation is edited (the
   regression test pins the outputs).

## 6. Task order

plan (this file) → Task 1 landing claims → Task 2 storage persistence →
merge.js + build wiring → app.js integration → tests → Task 5 hardening doc +
doc updates → Task 6 quality items → PR.

## Decisions

## Decisions (task 6 round)

- **Web-app manifest: SKIPPED.** The service worker's version string is the
  SHA-256 of the app HTML; a manifest file is one more cached asset whose
  update cadence could disagree with the shell hash during staggered deploys.
  The offline shell already installs and updates correctly without it, and the
  owner's SW notes record the omission as intentional. Not worth the risk
  before the presentation.
- **Sample data**: values regenerated deterministically around per-student
  ability targets (A*/A/A/B/C/D for the six fully-assessed students; the six
  partial students intentionally demonstrate provisional / not-yet-assessed).
  Structure, names, ids and coverage patterns unchanged; no real data.
- **Grading text**: the weights/bands legend and the new "How grades are
  calculated" dialog are generated from `calc.js` exports (`WEIGHTS`, `BANDS`,
  `FINAL_MIN_ASSESSED`) so the text can never drift from the engine.
- **Version/About**: `window.SPR_BUILD` (hash + date) is injected by
  `build2.py`; the About dialog reads it. Owner credit kept verbatim.
