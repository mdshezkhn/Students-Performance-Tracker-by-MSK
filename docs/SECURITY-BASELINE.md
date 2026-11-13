# SPR Security Baseline — Phase 0 forensic audit

Status: **REVALIDATED 2026-11-13** against commit `90e9bd6` (branch `feature/p2-secure-school`, parent `edc1866` on `round10` — the branch GitHub Pages serves from `site` was built from `edc1866`-era code, see §4).
Scope: the whole published application (`app/index.html`, `app/sw.js`), its sources (`source/`), the deployed Supabase project, and the hosting chain. No production student records were read, downloaded or transmitted during this audit. Every "live-verified" claim below was checked today by direct probe; code claims cite file + function.

Severity scale: CRITICAL (exploitable now, protects student data or its integrity), HIGH (breach requires moderate effort or a single careless action), MEDIUM (defence-in-depth gap / compliance exposure), LOW (hygiene).

---

## 1. Executive summary

The application's *cryptography* (AES-GCM sealed sync payloads, per-user PBKDF2 local wraps) is genuinely implemented and tested. The application's *authorization* is not: every role, class pairing and edit permission is enforced only in browser JavaScript, the cloud table that carries the school's data is still **anonymously writable** because the round-5/6 write-token SQL has never been run on the production project (live-verified today), and the sync model is whole-workbook last-save-wins, which cannot support two teachers writing the same class concurrently without data loss risk. Additionally, encryption keys and write tokens are placed in URLs and QR codes by design, and data residency (Supabase Seoul, GitHub Pages, Cloudflare mirror, DuckDNS domain) does not meet the Mainland-China requirement.

One CRITICAL, four HIGH findings. The remediation plan is §8; what can be fixed in code is being fixed on this branch; the two items needing owner action are listed verbatim in §9.

---

## 2. Confirmed vulnerabilities (evidence revalidated against `90e9bd6`)

### C1 — CRITICAL (live-verified): production cloud channel is still anonymously writable
- **Evidence (live, 2026-11-13):** `POST /rest/v1/rpc/spr_channel_write` → **404** and `POST /rest/v1/rpc/spr_channel_ping` → **404** against `https://hvjswsedoapsskedrkoj.supabase.co` with the embedded publishable key; `HEAD /rest/v1/spr_channels?select=id&limit=1` → **200** (anon read works). A 404 on a PostgREST RPC means the function does not exist (or is not executable by anon) — i.e. `docs/supabase-write-token.sql` has **never been run** on the production project.
- **Evidence (code):** `source/app.js` — the `not-installed` branch (~line 4495-4499) explicitly says *"Pushes fall back to the old unprotected write"*. The app knows the protection is missing and writes anyway.
- **Impact:** anyone who obtains the public key (it ships in the app) can `PATCH` arbitrary bytes over the school's cloud row. Payloads are AES-GCM sealed, so confidentiality survives, but **integrity and availability do not**: the synced copy can be corrupted at will, and pointer rows (account→channel mapping) can be garbage-written.
- **Remediation:** (a) code: stop the unprotected fallback — when the protection RPC is absent, the app must refuse to push (implemented on this branch); (b) owner action: run `docs/supabase-write-token.sql` on the project (§9).

### C2 — HIGH (code-verified): no server-side authentication or authorization
- **Evidence:** accounts, roles (`admin`/`manager`/`owner`/`eal`/`support`), class pairing and edit rules live entirely in `source/app.js` (`getAuth()`, `classRole()`, `renderUsers`, proposal/approve flow in `source/classstore.js`). The only server-side gate ever designed is the write-token RPC (not installed, C1). Supabase anonymous key grants table access subject to RLS; RLS today allows anon SELECT (200 above) and (per round-5 notes) anon INSERT/UPDATE for the Save & Share flow to work.
- **Impact:** a teacher (or anyone) editing localStorage or using the REST API directly can assume any role, read any sealed blob (decryption still needs the key, but see C3/H2), or write channels they should not touch. Frontend-only permissions per se.
- **Remediation:** the standalone authenticated backend on this branch (`server/`) with server-enforced school/class/role checks; Supabase path retired for student data.

### C3 — HIGH (code-verified): encryption keys and write tokens distributed in URLs / QR codes
- **Evidence:** `shareLink()` `source/app.js:4956-4960` builds `#join=<channel>&k=<key>&t=<writeToken>`; `dsLink()` ~line 5519 builds `#pair=<channel>&k=<key>`; join parsers at ~5337/5345; the share dialogs render these into QR codes and DingTalk/WeChat paste text (README documents this flow). URL fragments are not sent to the server, but they persist in browser history, screenshots, chat-app message logs and printed QR codes.
- **Impact:** the class sync key (and worse, the *write token*) leaks into low-security channels by design; possession = write access to that channel's row (until C1 is fixed, even without the token).
- **Remediation (this branch):** stop generating key-bearing links/QRs — link carries only the channel id, the key is displayed as a separate copyable secret with explicit handling guidance; existing key-bearing links continue to *parse* (teachers' chat history) but never get generated. Long-term: keys disappear entirely once the backend issues authenticated accounts.

### C4 — HIGH (architecture, unchanged): whole-workbook last-save-wins sync
- **Evidence:** `sbSave`/`sharePush`/`cloudEnvelope` path seals the entire workbook per push; the staleness guard (deploy `89cf36d`, 2026-10-19) only warns when the remote `pushedAt` is >90s newer — a human dialog decides. `tests/repro-deadlock-20261112.mjs` documents the failure modes on stale rows.
- **Impact:** two teachers saving the same class concurrently can silently lose the earlier save's records (whoever pushes last wins the whole workbook). This is the exact Excel-problem the app set out to replace, moved online.
- **Remediation:** record-level versioned writes with server-side expected-version checks, idempotency keys and explicit conflict responses — implemented in `server/` on this branch (§8).

### C5 — MEDIUM (code-verified): plaintext safety copies in localStorage
- **Evidence:** `stashSafetyBackup()` `source/app.js:256-267` stores `{t, label, db: DB}` raw — full student roster + scores — under key `spr-safety-backups-v1` (last 3 copies). The primary store is PBKDF2-wrapped; these copies are not.
- **Impact:** any script or person with device access reads full records; violates the app's own encrypted-at-rest posture.
- **Remediation (this branch):** seal safety copies with the same data key as the primary store (transparent restore; if no key is available — pre-first-login — the copy is refused rather than stored plaintext).

### C6 — MEDIUM (live-verified): anonymous enumeration of channel metadata
- **Evidence:** anon SELECT on `spr_channels` returns 200 (today). Historically ~88 rows were enumerable (audit 2026-10). Payloads are sealed, but channel existence, sizes, and `pushed_at` timestamps leak to anyone.
- **Remediation:** backend moves rows behind authentication; for the interim Supabase life, acceptable only because payloads are sealed — documented, not fixed client-side (a server-side change).

### C7 — MEDIUM (deployment): data residency + dependency chain does not match the Mainland-China requirement
- **Evidence:** app hosted on GitHub Pages (`my-spr-with-mo.duckdns.org`, DuckDNS domain) + Cloudflare Pages mirror (`spr-with-mo.pages.dev`); sync + account pointers on Supabase **Seoul** region (`SUPABASE.url` `source/app.js:4912`); QR/logo assets self-hosted (good). Student **records** are processed by: the browser (anywhere), Supabase Seoul (sync payloads + pointer rows). No analytics/error-reporting/AI calls found in the bundle (grep: no sentry/GA/external fetch beyond Supabase + the app's own origin).
- **Impact:** PIPL/DSL cross-border processing without an assessed mechanism; Seoul storage of encrypted-but-school-attributable data; GitHub Pages reachability from mainland networks is unreliable.
- **Remediation:** China-hosted backend + PostgreSQL (this branch, `server/` + `docs/DEPLOYMENT-GUIDE.md`); Supabase retired from the student-data path after migration; ICP filing obtained by the school/owner before serving from a China host (§9 external).

### C8 — LOW (hygiene): `qa/voice/` working media nearly committed; secrets hygiene
- The Supabase **publishable** key in the bundle is by design (client-side Supabase), not a leak — but it grants C1's anon surface. No other hardcoded secrets found (`git log -p` scanned for `sb_secret`, `service_role`, `password =` patterns — clean). Git history was purged of the one real-student leak in 2026-10 (memory of that incident: `d2c0ad4` rewritten; verify no re-introduction: `git grep JJT221 $(git rev-list --all)` — clean today).

---

## 3. Potential vulnerabilities requiring further verification

- **P1** — `spr_channels` anon INSERT/UPDATE policies: presumed still open (the write-token SQL that revokes them never ran). *Verify in the Supabase dashboard (§9 owner step will fix it either way).* Do not test by writing to production.
- **P2** — Service worker cache policy: `sw-template.js` caches the app shell; verify no authenticated API responses are cached once the backend exists (currently no authenticated API exists — will be enforced + tested on this branch).
- **P3** — School-network TLS interference with Supabase (measured resets, see `SPR-REVIEW-STATUS.md`) may push teachers toward personal hotspots; treat as an operational risk, not a code fix.

## 4. Safeguards that are genuinely implemented (retain)

| Safeguard | Evidence |
|---|---|
| AES-GCM sealed sync payloads + HMAC integrity check; undecryptable payloads refused, never overwrite local data | `cloudEnvelope`/pull-check path; `tests/repro-deadlock-20261112.mjs` |
| Per-user local encryption at rest (PBKDF2 600k v2 wraps of a random master key) | `source/classstore.js` `deriveKeyBits`/`makeWrap`; `tests/test-class-mode.js` |
| XSS escaping sweep on all render sinks; import validation (`validateDB`) on every import path | round P0/P1.1 commits; `tests/test-classes-escape.js`, `test-class-mode.js` |
| 329-check calculation regression suite + independent fixtures; grade thresholds untouched | `tests/calc-regression.test.js` |
| Build-time seed stripping + `JJT221` absence assert | `source/build2.py` |
| Publishable-key-only embedding (no secret keys in the bundle) | grep clean |
| Staleness dialog before push overwrites newer remote (mitigates but does not fix C4) | `staleCloudDlg` |
| Write-token SQL designed + 3-scenario tested on a real Postgres engine — blocked only on being run | `docs/supabase-write-token.sql`, `docs/qa/round6/` |

## 5. Retain / replace decision

- **Retain:** calc engine (`calc.js`), class store & proposals (`classstore.js` — proposals re-scoped, see §8), Excel bridge (`excel.js`), analysis (`analysis.js`), PWA shell + offline, build system (`build2.py`), entire test suite.
- **Replace:** cloud transport (Supabase whole-blob channel → authenticated record-level backend), account model (client-side → server sessions), share/pairing links (key-in-URL → authenticated accounts + secret-out-of-band).
- **Retire after migration:** Supabase project for student data (keep the project read-only quarantined during migration window, then export + purge — `docs/MIGRATION-PLAN.md`).

## 6. Test baseline (this branch's starting point)

- Commit `90e9bd6`; `npm test` (23 suites) result: recorded in `docs/IMPLEMENTATION-REPORT.md` §Baseline (run in progress at audit time; the same suite was green on `edc1866` per round-10 report `docs/round10-REPORT.md`).
- CI: GitHub Actions runs on PRs (`.github/workflows`, fresh clone, `62/329/24/144` historical counts).

## 7. Secrets & credentials exposure register

| Secret | Where | Owner action |
|---|---|---|
| Supabase publishable key | bundle by design | none (retire project post-migration) |
| Supabase service_role key | **never in repo** (dashboard only) | none |
| Class sync keys / write tokens | teacher chat logs + QR history (C3) | rotate: turn device sync off/on per class after C1 fix |
| Teacher passwords | client-wrapped only (C2) | migration to backend accounts resets all passwords |

No production student records were used for any test or fixture in this work (synthetic rosters only, `tests/fixtures/`).

## 8. Remediation implemented / in progress on this branch

| Finding | Fix | State |
|---|---|---|
| C1 | app refuses to push when protection RPC absent (`not-installed` → block, no fallback) | implemented (see IMPLEMENTATION-REPORT) |
| C1/C6/C7 | `server/` authenticated China-hostable backend (sessions, RBAC, record-level sync, conflicts, audit) + tests | implemented + tested locally |
| C2 | server-side school/class/duty enforcement on every operation | implemented + tested |
| C3 | no key-bearing links generated; key shown as separate secret | implemented |
| C4 | record-level versioned writes, idempotency, 409-with-both-versions conflicts | implemented + tested |
| C5 | safety copies sealed with the user's data key | implemented |

## 9. Exact external (owner) actions — blockers for deployment, not for code

1. **Run `docs/supabase-write-token.sql`** in the Supabase SQL editor (3 steps in the file header). Until then the interim cloud path stays read-only-by-policy (app-side refusal, C1) — local-only operation is unaffected.
2. **Provision the China host** per `docs/DEPLOYMENT-GUIDE.md` (domain + ICP 备案 + VPS + PostgreSQL + TLS). Nothing student-data-related may be cut over before that; staging uses synthetic data only.

Both are tracked in `docs/IMPLEMENTATION-REPORT.md` as *Awaiting external action*.
