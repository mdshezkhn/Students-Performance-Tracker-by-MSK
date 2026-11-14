# Final Independent Verification Report — SPR Release Candidate

Audit date: 2026-11-14 (evening session). Auditor role: independent — this
session did NOT implement Rounds 11–30 and modified **no repository file
except this one**. Every claim below was re-derived from repository evidence,
live probes or independently re-executed tests.

Labels: **PASS** (independently verified) · **FAIL** (contradicted) ·
**NOT VERIFIED** (evidence unavailable) · **N/A** (out of scope).

---

## 1. Executive verdict

**B — TECHNICALLY RELEASE-READY, EXTERNAL APPROVAL PENDING** (independently
confirmed, not inherited). The final commit, remote state, bundle and the
substance of the closing test sweep are genuine and were re-verified; zero
unresolved CRITICAL technical defects. However the audit found **8
discrepancies** (none requiring code change, two requiring owner-visible
correction before handover), listed in §11.

## 2. Exact Git and remote state — PASS

| Check | Result | Evidence |
|---|---|---|
| Checked-out branch | `feature/p2-secure-school` | `git branch --show-current` |
| Working tree | **clean** (zero modified/untracked) | `git status --short --branch` |
| HEAD | `ab4217973df459e53a03fa2269cbc26d95b4b2ab` | `git rev-parse HEAD` |
| `ab42179` exists | YES | `git cat-file -e` |
| Remote branch | `origin/feature/p2-secure-school` = `ab42179…` — **identical, zero diff, nothing unpushed** | post-`fetch` `git diff --stat` empty |
| Ancestry | `1217fca` and `90e9bd6` both ancestors of `ab42179` | `git merge-base --is-ancestor` |
| Production `site` | `site` = `origin/site` = `0b5b5d19` — untouched; `ab42179` contained ONLY in the feature branch (not in `site`, not in `main`) | `git branch --contains ab42179` |
| Commit metadata | Author Mohammed Shehzad, 2026-11-14 14:15:16 +0800 | `git log -1 --format=fuller` |

Fetch side-effects (disclosed per audit rules): remote-tracking refs updated —
`origin/main` moved `91b8a6d`→`94edde2` and two foreign remote branches
appeared (`fix/local-owner-island`, `m0.5/rebuild-artifacts-notice-v2.1`).
No local branch or file was affected. Pre-fetch `show-ref` snapshot retained
in the session log. **F8 (INFO):** main advanced outside this programme —
worth the owner's awareness, no impact on this candidate.

## 3. Final commit and bundle — PASS

- Bundle id in `app/index.html`: `spr-app-shell-0f33db4300` (report's claim
  confirmed); round-11 bundle was `2902c83200`.
- sha256(app/index.html) = `f924b90a9c8c0e742e1032f15bd7aa620b1292183e284d17af821bf91638c4c8`;
  `git show ab42179:app/index.html` hashes **identically** → on-disk =
  committed.
- `deploy/app/index.html` and `deploy/app/sw.js` byte-identical to `app/` (`cmp`).
- **Entire bundle delta 1217fca→ab42179 = 4 changed lines** (one privacy-notice
  `<li>` string + build ids) — `git diff --stat` derived.
- Secrets: 0 occurrences of `change-me-admin`/`Spr-Admin-Rotated`/`SPR_ADMIN_PW`
  in the bundle. The Supabase **publishable** key present — by design, public,
  RLS-scoped (documented in `assets/supabase-setup.md`).
- Source→bundle correspondence verified WITHOUT rebuild: the corrected notice
  text ("shown separately when you share") present in the bundle; build ids
  consistent in `sw.js`.

## 4. Test-by-test reconciliation

Closing-sweep log (`/tmp/spr-final30.log`, 14 344 bytes, mtime 14:14, i.e.
1 minute before the final commit — and the identical stray copy at
`web/workspace/docs/qa/round29/final-sweep.log`, see F1):

| Suite | Log says | Exit | Audit action | Result |
|---|---|---|---|---|
| server RBAC | 43 ok, 0 FAIL | 0 | **independently re-executed** | 43/0 PASS |
| server sync | 26 ok, 0 | 0 | log + code inspection | PASS |
| server migrations (+guardrails) | 21 ok, 0 | 0 | log + code inspection (§9) | PASS |
| server backup-restore | 10 ok, 0 | 0 | log + code inspection (§8) | PASS |
| server schoolsync | 22 ok, 0 | 0 | log + code inspection | PASS |
| server adversarial | 45 ok, 0 | 0 | log + live re-probes of its claims | PASS |
| browser e2e (Edge, 23-step + mobile) | 25 ok, 0 | 0 | log only — re-run forbidden (would rewrite tracked screenshots) | PASS via recorded evidence; limitation noted |
| calc regression | 329 passed, 0 | 0 | log | PASS |
| calc boundaries | 13 ok, 0 | 0 | log | PASS |
| npm audit | 0 vulnerabilities | — | **independently re-executed** | 0 vulns PASS |

App/excel suites (NOT in the closing sweep; ran 12:48 on the **pre-rebuild**
bundle — see F3). Independently re-executed by this audit **on the final
bundle `0f33db4300`**: round5 49/0 · round6 32/0 · round7 38/0 · classstore
148/0 · completeness 62/0 · data-safety 36/0 · notices 28/0 · excel-import
24/0 · spraudit 20/0 · import-acceptance 18/0 · spradapter 38/0 —
**493 checks, 0 failures**. Slow pair re-executed likewise:
device-sync **ALL PASSED (EXIT=0)**, sync-ux **ALL PASSED (EXIT=0)**.

Net: every suite in the final report's §16 table is now backed either by the
verified closing log or by this audit's own re-execution on the final bundle.

## 5. Authentication and RBAC — PASS (with citations)

`server/spr-server.mjs` unless noted:

| Control | Evidence (file:line, function) | Test |
|---|---|---|
| Password hashing | scrypt N=2¹⁷, r=8, p=1, 64 B (43-48; rationale documented vs Argon2id) | RBAC §1 |
| Anti-enumeration | single error path for unknown user / wrong password / deactivated | adversarial §2 |
| Rate limiting | per-username lockout + per-IP 20/10 min (112-121, `loginAllowed`); 429 + audit `login.throttled` (358-360) | adversarial |
| Forced rotation | `must_change_pw` gate blocks all non-auth routes (386-390); bootstrap arms it only for the default password (308-316) | migrations §5, RBAC |
| Pw change kills other sessions | 415 | RBAC |
| Admin reset kills sessions | 575 | adversarial |
| Deactivate kills sessions + auth | 584 + session join `u.active` (148-149) | adversarial §6 |
| Standalone revocation | `/api/admin/users/:id/revoke-sessions` (623 area) | adversarial §13 |
| Cookie | HttpOnly, SameSite=Lax, Secure-conditional (376); insecure escape needs double opt-in (741) | migrations §5 |
| Session expiry | enforced per-request (148, 154) | adversarial §5 |
| Duty matrix | `canWrite` (172) over `DUTY_CATEGORIES`; duty from memberships, never body (196-199) | RBAC, adversarial |
| School/class isolation | `classInSchool` → 404 (196); cross-school record → 404 (226) | adversarial §1, §13 |
| Body-id tampering | identity guard: class/student change → 400 (227); category change → 400 | adversarial §13 |
| Resolve scoping | school + duty re-check from DB row (491-493) | adversarial |

## 6. Synchronisation and offline — PASS

`source/schoolsync.js`: durable outbox defaulting to localStorage; queue
idempotency by key; flush classifies auth/network/forbidden/conflict; both
conflict versions returned (`server` + `yours`, spr-server.mjs 214-241) with
explicit `/resolve`. Verified by schoolsync 22/0, sync 26/0, and the browser
suite's offline/restart/device-replacement/conflict sections — plus this
audit's independent device-sync + sync-ux re-runs. Shared-device outbox is
NOT partitioned per account — correctly disclosed as limitation §17.7.

## 7. Legacy Supabase exposure — OPEN, containment overstated (F2)

Live probes (2026-11-14 evening, publishable key, zero mutations):
- `GET /rest/v1/spr_channels` → **200** — the 88-row anonymous-read exposure
  is **STILL OPEN** (row count 88 from the same-day inventory; readability
  re-confirmed now).
- `POST /rpc/spr_channel_write` → 404 — protection RPC still absent.
- `OPTIONS /spr_channels` → **`Allow: GET, HEAD, POST, OPTIONS`** — the
  authoritative grant list: anonymous **UPDATE not granted** (good), but
  anonymous **INSERT (POST) IS granted** — an undocumented row-creation/
  pollution vector.
- With a correct Authorization header, `PATCH` returns 204 (vacuous — zero
  rows matched), **not** the 401 that
  `docs/LEGACY-SUPABASE-RETIREMENT-READINESS.md:12` reports; that 401 was an
  artifact of a missing header in the original probe. The doc's conclusion
  "no write path at all" (line 33) is therefore **FAIL as worded**; the
  practical risk picture is: existing-row writes blocked (Allow list),
  new-row inserts possible, reads open.
- App-side refusal of unauthenticated cloud writes: verified in source
  (`sbSave`, `sprProtectionErr`) and by round5/6 + device-sync suites —
  unchanged. The new backend has zero Supabase dependency.

## 8. Backup and recovery — PASS (one dangling reference, F4)

`GET /api/admin/backup` (681-693): admin-only, audited, per-table school
scoping (join for `class_memberships`), sensitive-content flag (password
hashes). Restore proven into an isolated store by `test-backup-restore.mjs`
10/0 (users re-authenticate, records/versions, roster, audit, duties). The
code comment at line 680 references `scripts/restore-from-backup.mjs` —
**no `scripts/` directory exists** (F4): the tested procedure lives in the
test, not an operator script.

## 9. Production guardrails — PASS

spr-server.mjs 729-741: `SPR_ENV=production` is the explicit opt-in; bare
`NODE_ENV=production` is advisory only (correct — this repo's own test shell
exports NODE_ENV=production); refuses default admin password, dev store,
insecure cookies (double-flag escape). Tested in migrations suite §5.
Guide omissions: `SPR_SESSION_HOURS` (operational knob) and
`SPR_ADMIN_USER`/`SPR_SCHOOL_NAME` undocumented (F6, LOW).

## 10. External blockers — NOT VERIFIED (genuinely external)

Hosting subscription · domain · ICP (+possible public-security) filing ·
legal/PIPIA review · DPA & retention sign-off · RPO/RTO approval · production
credential custody · **legacy Supabase containment decision** · physical
Android/iOS acceptance. All prepared in
`docs/EXTERNAL-APPROVALS-AND-DEPENDENCIES.md` (7 sections) — none executable
from the repository; none claimed complete. PASS as documentation, NOT
VERIFIED as facts.

## 11. Discrepancies vs the previous report

| # | Sev | Finding |
|---|---|---|
| F1 | HIGH (evidence-trail, not code) | `docs/qa/round29/final-sweep.log` **does not exist in the repository** despite being cited by the ab42179 commit message, FINAL-RELEASE-READINESS-REPORT.md:73 and IMPLEMENTATION-REPORT.md:90. Cause: the mirror `mkdir/cp` ran from `web/workspace/` (one dir above the repo). Raw log exists and was audited (genuine, pre-commit mtime 14:14). **Owner action: commit it.** |
| F2 | MEDIUM | Legacy doc's "direct PATCH → 401 / no write path at all" not reproducible with correct headers; anonymous INSERT granted (Allow list) and undisclosed. Containment wording must be corrected before handover. |
| F3 | MEDIUM (wording; risk closed by audit) | "App-level suites re-verified on the final bundle earlier the same day" is false — they ran 12:48 on the pre-rebuild bundle (rebuild 13:53; delta 4 lines). This audit re-ran all of them on the final bundle: all green. |
| F4 | LOW | Dangling comment referencing `scripts/restore-from-backup.mjs` (never created). |
| F5 | LOW | Mandated `SCHOOL-ADMINISTRATION-GUIDE.md` absent; content lives in `ADMINISTRATOR-GUIDE.md` (no broken references). |
| F6 | LOW | Deployment guide omits `SPR_SESSION_HOURS` (+2 cosmetic env vars the code reads). |
| F7 | INFO | Backup SQL tolerance `or school_id = ''` (692) — benign, worth a comment. |
| F8 | INFO | `origin/main` advanced during the audit fetch (activity outside this programme). |

## 12. Remaining risks (ranked)

- **HIGH (known, external)**: 88 legacy rows anonymously readable (and now
  also insert-pollutable) until the owner executes containment — reversible,
  10 minutes, documented.
- **MEDIUM**: F1 evidence-trail break (handover packaging), F2 doc correction.
- **LOW**: F4-F6 hygiene items; disclosed product limitations
  (no admin MFA, in-memory rate limiting, no conflict inbox UI, shared-device
  outbox, `.xls` best-effort) — all already listed in the report's §17.

## 13. Final release decision

**Classification B stands — independently.** The engineering substance of the
Rounds 11–30 report survived a hostile audit: every technical claim tested was
either reproduced or re-executed green on the final bundle. Before the
release package is handed to the school, the owner should (a) commit the
final-sweep log (F1), (b) correct the legacy-containment wording (F2) and
(c) note F3. Real student data must NOT be introduced until those plus the
§10 external blockers are closed.

## 14. Exact remaining owner/school actions

1. Commit `final-sweep.log` into `docs/qa/round29/` (evidence packaging).
2. Correct LEGACY-SUPABASE-RETIREMENT-READINESS.md lines 12/33 (PATCH/401 →
   Allow-list facts; add the INSERT vector) — or have the next engineering
   session do it.
3. Execute the reversible legacy containment (readiness doc step 3).
4. Provision Mainland-China hosting + DB; domain; ICP/public-security filing.
5. Legal review + school sign-off (PIPIA, DPA, retention, RPO/RTO).
6. Run `docs/FINAL-MANUAL-ACCEPTANCE-CHECKLIST.md` (27 checks) on real
   devices, two teachers, two networks.
7. Only then migrate real classes via the audited Excel import path.

---

# CLOSURE ADDENDUM (2026-11-14, blocker-closure mandate)

Original findings preserved above, untouched. Resolution status:

| Finding | Original severity | Action taken | Evidence | Test result | Final status |
|---|---|---|---|---|---|
| F1 missing raw log | HIGH | Verified original (both copies byte-identical, sha256 `6ceedd3ddb9e0c15732449174fb0c22812da2999b458e68916f06bbabe64e0b9`, mtime 24s before the release commit), copied into `docs/qa/round29/final-sweep.log`; independent reruns preserved separately as `docs/qa/round29/audit-independent-reruns.log` | `git log ab42179`, `cmp`, file mtimes | contents match every suite total in the commit message | **PASS** |
| F2 inaccurate permission claim ("PATCH → 401 = blocked") | MEDIUM | Root-caused (missing Authorization header = request-level 401, not a DB denial). Re-probed live with valid headers using write-shaped requests against a nonexistent row id (zero rows affected by construction; no INSERT sent). Corrected LEGACY-SUPABASE-RETIREMENT-READINESS.md, IMPLEMENTATION-REPORT.md, dated addendum in SECURITY-BASELINE.md | this report §7 + corrected readiness doc | probes reproduced twice (audit session + closure session), row count 88 unchanged | **PASS** (claim corrected) |
| Anonymous SELECT exposure | HIGH | Not changeable from the repository (share-link feature needs it); containment prepared | live 200 ×2 sessions | n/a | **BLOCKED BY OWNER** (retirement step 3/4) |
| Anonymous INSERT exposure | to establish | Grant OPEN (advertised) + documented pre-existing policy → presumed permitted, never executed (mandate prohibits); impact = junk rows only (cannot read/modify existing rows: PK + UPDATE-denied). Containment keeps INSERT inside token-armed RPC semantics | `Allow: GET, HEAD, POST, OPTIONS`; OWNER-RUNBOOK §1 | no live execution — by design | **NOT VERIFIED** (live insert execution deliberately not performed; unnecessary: containment closes it) |
| Anonymous UPDATE exposure | to establish | **DENIED at grant level — live-confirmed** (42501, "GRANT UPDATE … TO anon" hint) | closure probes above | reproduced, deterministic | **PASS** (denied) |
| Anonymous DELETE exposure | to establish | **DENIED at grant level — live-confirmed** (42501) | closure probes above | reproduced | **PASS** (denied) |
| Legacy application dependency | to establish | Classified: URL+key exist ONLY in `source/app.js` (personal markbook Save & Share / device sync) and the built bundle; **zero references** in the school-edition stack (`server/*`, `schoolsync`, `spradapter`, `spraudit`). Personal-edition pushes are refused client-side until the owner runs the write-token SQL (C1, round5 49/0 + device-sync 114/0) | grep across source+bundle | suites green | **PASS** (classified; personal-edition dependency dormant-by-refusal, school edition independent) |
| F3 stale-bundle wording | MEDIUM (wording) | Closed by evidence: all app-level suites re-run on the final bundle by the auditor (see audit-independent-reruns.log) | `docs/qa/round29/audit-independent-reruns.log` | 493 checks + device-sync + sync-ux, 0 fail | **PASS** |
| Containment SQL hardening | (new, closure) | Added `enable row level security` to `docs/supabase-write-token.sql` (policies alone do not bind with RLS off); exact modified file re-verified by the round-6 real-Postgres harness | `tests/test-round6.js` → `docs/qa/round6/sql-policy-test-output.txt` | ROUND6: 32 ok, 0 FAIL | **PASS** (prepared — execution still owner-gated) |

Post-containment verification is scripted (`scripts/verify-containment.sh`,
non-mutating) and must be run by/for the owner after they execute the SQL;
until then "containment executed" must not be claimed anywhere.
