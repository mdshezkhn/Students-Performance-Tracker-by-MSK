# Round 11 — Acceptance Tests & Evidence

Branch `feature/p2-secure-school`, 2026-11-14. All data in every test below is
**synthetic**. No production student record was read, transmitted or modified.
Nothing was deployed: production (`site` branch / my-spr-with-mo.duckdns.org)
is untouched.

Status vocabulary used below: **Implemented** (code exists) · **Unit tested**
(node-level suite) · **Integration tested** (real backend + real app bundle +
real browser) · **Security tested** (adversarial, direct API) · **Staged**
(runs locally behind a flag, awaiting infrastructure) · **Deployed** (live) ·
**Awaiting school action** · **Awaiting legal review**.

## 1. Baseline verification (§1)

| Check | Result | Evidence |
|---|---|---|
| Branch / commits present | PASS | `git log`: 90e9bd6 → 426c94a → fc32372/a6c52d1 → e2e1451 → 98fdc70 → d86c79c → 044a671 |
| Prior report accuracy | **PARTIAL — regression found** | The final device-sync run on the rebuilt bundle (post-token-fix) FAILED 6 checks (/tmp/spr-ds4.log). Root-caused (see §7 below) and fixed; final run green. |
| Working tree clean before work | PASS | only the intended files changed per commit |

## 2. SPR data adapter (§2) — Implemented + Unit tested

`source/spradapter.js`; suite `tests/spradapter.test.js` → **38 ok, 0 FAIL**.

| Test | Method | Result | Limitation |
|---|---|---|---|
| Forward mapping (students, observations, spelling, daily, tests, maxima) | node unit | PASS | — |
| Deterministic ids (re-import safe, hex-only to satisfy the server's uuid guard) | unit | PASS | — |
| Round-trip fidelity certified by the CALC ENGINE (`gradeAll` identical before/after) | unit | PASS | This is the strongest available proof that no parallel grading logic exists |
| FET/CET independent delta merge (one record each, both survive) | unit | PASS | — |
| Missing score with known max preserved as null (never zero) | unit | PASS | — |

## 3. FET/CET browser integration (§3) — Integration tested

`tests/round11_browser_fet_cet.py`: REAL backend process (PGlite + static
same-origin hosting of the REAL published bundle), two isolated Playwright
(msedge headless) contexts, synthetic Primary 4A. → **18 ok, 0 FAIL**.

| Scenario | Result | Evidence |
|---|---|---|
| FET signs in, records observation for Student 08 | PASS | sent=1 |
| CET (separate machine context) sees the observation | PASS | value=8, version=1 |
| CET enters spelling 9/10 + midterm 88/100 | PASS | sent=2 |
| FET sees CET updates; own observation untouched | PASS | version still 1 |
| Network cut mid-session → entry queued, not lost | PASS | pending=1, network error typed |
| Reconnect → queued change delivered | PASS | sent=1, pending=0 |
| Same-field stale write → conflict with BOTH versions | PASS | server=8, incoming=5 |
| Owner resolves conflict | PASS | final=8, audited |
| Browser closed with pending change → restart → outbox survives → flushes | PASS | default localStorage persistence |
| Device replacement: fresh context signs in, pulls everything, rebuilds semester | PASS | 5 records, adapter output valid |
| Backup→restore round trip (admin export → adapter → gradable semester) | PASS | 5 records, 3 observations |
| Audit trail shows the whole workflow | PASS | login.ok, record.create/conflict/conflict.resolve; 28 events |

En-route defects found and fixed: CSP `connect-src` lacked `'self'` (school
backend unreachable from the app); client's default persist store was a no-op
(durability now the default, JSON-store safe).

## 4. Adversarial permission testing (§4) — Security tested

`tests/test-server-adversarial.mjs` → **36 ok, 0 FAIL** (direct HTTP, no
frontend). Every rejection is documented with its actual HTTP response.

| Attack | Response |
|---|---|
| GET unassigned class records (same school) | 403 `not assigned to this class` |
| Write with foreign class id (same school) | 403 membership rule |
| Other school's class (row-level isolation) | 404 `no such class` (school-scoped lookup — no existence leak) |
| FET writing CET-only spelling | 403 `duty does not allow this category` |
| CET writing FET-only observations | 403 |
| Forged `user_id`/`role`/`school_id` in body | ignored — session is authoritative (200 reflects session identity) |
| Expired session (any call) | 401 `sign in first` (per-request expiry check) |
| Deactivated account live session | 401 immediately; login → 401 |
| Replay of a successful write (same idempotency key) | 200 `replayed:true`, exactly 1 row |
| Anonymous export | 401 |
| Export of unassigned class | 403/404 |
| CET resolving an observation conflict | 403 (category ownership) |
| Anonymous resolve | 401 |
| Missing / wrong CSRF token | 403 `missing or wrong CSRF token` |
| SQL-injection-shaped query params | parameterised queries → 200/400, no effect, audit intact |
| 404 / error disclosure | no stack traces in any response |
| **Direct DB UPDATE/DELETE of audit_events** | **exception (DB trigger)** — immutability is engine-enforced, not app-promise |

Defects this suite found and fixed: **`/api/admin/users/:id/activate` did not
exist** (deactivation was a one-way door); SESSION_HOURS now env-overridable
(clamped) so expiry is actually testable.

## 5. Offline & recovery (§5) — Integration tested (see §3 table)

Items proven: offline entry, network interruption, reconnect sync, duplicate
replay, same-field conflict resolution, browser restart with pending changes,
device replacement, cleared-storage recovery path (= device replacement, since
the server is the source of truth), backup→restore round trip.

**Key recovery documentation** (TEACHER-USER-GUIDE / ADMINISTRATOR-GUIDE):
forgot password → admin reset (sessions revoked, `must_change_pw`); lost
device → sign in on a new device, records are server-side; the LOCAL vault
stays sealed under the login password (PBKDF2-310k wrap). No recovery
mechanism bypasses authentication — an unauthorised person with a device
cannot decrypt local caches without the account password, and the server
requires the session.

Limitation: "restart the computer" was approximated by page close + new page
in a fresh process-level context; storage semantics are identical
(localStorage persists per profile).

## 6. SPR import acceptance (§6) — Unit + Integration tested

`tests/test-import-acceptance.js` → **18 ok, 0 FAIL**, with `fetch` and
`XMLHttpRequest` **throwing for the entire run** (local-only proof by
construction). Matrix: normal · modified formulas · missing data · duplicate
students · renamed worksheets · inconsistent maxima · impossible scores ·
error cells (#REF!) · all-low legitimate class (0 false data errors) ·
400-student soak (555 ms).

Engine gaps found BY the matrix and fixed: error-typed cells never scanned
(now CRITICAL `error-cell` with sheet+cell); inconsistent maxima across rows
were silent (now WARNING `max-inconsistent` vs class modal).

Teacher-approval gate and no-silent-overwrite: covered by the round-10 suites
(test-completeness.js 62/0, test-notices.js 28/0) and unchanged this round.
Duplicate-free re-import: deterministic adapter ids (§2).

## 7. Backend security review (§7) — Security tested

| Item | Result |
|---|---|
| SQL injection | every query parameterised ($n); zero concatenated SQL (grep sweep + injection-shaped requests in §4) |
| Broken object-level authz | §4 matrix green (school+class+category enforced server-side per query) |
| Session fixation | fresh 32-byte token per login; cookie set only on success |
| CSRF | double-submit header, per-session token, verified wrong/missing → 403 |
| Login brute force | per-username+IP limiter (429) — exercised in round-10 RBAC suite |
| Cookies | `HttpOnly; SameSite=Lax; Path=/` (+`Secure` unless SPR_COOKIE_SECURE=0 for local tests) |
| CORS | no CORS headers at all — same-origin only |
| Error disclosure | no stacks, no SQL text in responses |
| Audit immutability | **DB trigger** blocks UPDATE/DELETE for ANY writer (§4) |
| Dependencies | `npm audit` (prod + dev): **0 vulnerabilities** |
| Backup exposure | backups are server-side ops (pg_dump per DEPLOYMENT-GUIDE); no backup endpoint exists; audit-export is admin-only |

**Device-sync regression (found in §1, root-caused here)**: the write-token
design stored ONE token hash per cloud row while every paired device minted
its own token → second device's pushes rejected. Fixed: the channel token now
rides INSIDE the sealed envelope (readable only by sync-key holders, who can
already decrypt the workbook), adoption converges on it, and enrol re-arms
with key proof (SQL updated). Final device-sync run: **114 ok, 0 FAIL**
(/tmp/spr-ds6.log).

## 8. China data-protection documentation (§8) — reviewed, Awaiting legal review

PIPIA/DPA/retention/data-flow docs re-reviewed: no compliance claims, no
invented statutory deadlines, engineering-vs-legal separation made explicit
in a new Round-11 appendix to the PIPIA. Amended-CSL (2026-01-01) effects,
guardian-consent mechanism, handler-vs-processor roles, and ICP/公安备案
applicability are marked as counsel questions. **These documents remain
drafts requiring school + qualified Mainland China legal review.**

## 9. Legacy Supabase decision (§9) — Plan only, Awaiting school/owner action

`docs/LEGACY-SUPABASE-DECOMMISSION.md`: state table, why-not-delete-now, a
9-step owner-executed wind-down (inventory → recover → verify → delete → lock
→ rotate → close), reversibility notes, and confirmation that the new backend
has zero Supabase dependency. **Nothing executed**: rows intact, SQL not run,
sync stays refused. 

## 10. Release gate (§10)

| Gate | Status |
|---|---|
| FET/CET integration works | ✅ proven (§3) |
| Direct API permission tests pass | ✅ (§4) |
| Offline changes survive restart | ✅ (§3) |
| Conflict resolution works | ✅ (§3) |
| SPR import verified | ✅ (§6) |
| Calculation regression green | ✅ 329/0 (round-10 suite, engine untouched this round) |
| Backup restoration demonstrated | ✅ at API+adapter level (§3); full pg_dump restore rehearsed in DEPLOYMENT-GUIDE only |
| No unresolved critical/high vulns | ✅ in code; **the production Supabase exposure (rows anonymously readable, RPCs absent) remains OPEN until the owner runs the SQL or deletes the rows** — tracked in SECURITY-BASELINE as C1-live |
| Hosting & data residency verified | ❌ **not yet — awaiting school infrastructure decision** (China hosting + domain + ICP) |
| School approved processing arrangements | ❌ not yet |

**Verdict: NOT production-ready.** The application code meets the functional
and security bar demonstrated above; the remaining blockers are the two ❌
gates plus the owner's Supabase action — none of which can be closed from
inside this repository.
