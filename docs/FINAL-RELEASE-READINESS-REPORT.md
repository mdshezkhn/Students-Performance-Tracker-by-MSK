# Final Release Readiness Report — Rounds 11–30 Programme

Date: 2026-11-14. Branch: `feature/p2-secure-school`.

## 1. Executive summary

The Students Performance Tracker now contains, alongside the unchanged
production personal markbook, a complete school-edition backend
(individual accounts, server-enforced FET/CET roles, record-level sync with
real conflict handling, DB-immutable audit, versioned migrations, tested
backup/restore, production boot guardrails) plus a local-only SPR Excel
import-and-audit module. Everything technical in the mandate that can be
verified from this repository has been implemented AND tested — including a
25-check two-browser end-to-end workflow and 45 adversarial HTTP attacks.

**Classification: B — Technically release-ready; external approval pending.**
The code is verified; school hosting, domain/ICP filing, legal review,
legacy-data decisions and physical-device acceptance remain (all prepared,
none executable from here). No student data exists on any server.

## 2. Commits

- Programme start: `1217fca` (round 11 close).
- Programme commits: `53993a7` (R12+13) · `a6ffb09` (R14–20) · `a2b5f48`
  (R21–24) · `1d4ff66` (R25–29) · final commit: see §20 (this document's
  commit). Baseline snapshot preserved at `90e9bd6`; production `site`
  branch untouched throughout.

## 3–15. Architecture / verification map

| Area | State | Primary evidence |
|---|---|---|
| Architecture summary | PWA (unchanged) + zero-dependency Node/PostgreSQL school backend; adapter bridges the SPR cell model to records | MASTER-EXECUTION-BASELINE.md |
| Database | versioned migrations (001 baseline, 002 archive), checksummed ledger, forward-only with tested restore path | DATABASE-AND-MIGRATION-REVIEW.md · MIGRATIONS 21/0 |
| Authentication & roles | scrypt accounts, enforced rotation, CSRF, rate limits; FET/CET/admin/manager server-enforced | AUTHENTICATION doc · RBAC 43/0 · ADVERSARIAL 45/0 |
| FET/CET workflow | full 23-step two-browser chain incl. offline + conflict + reports + export | ROUND29 report · browser 25/0 |
| Synchronisation | record versions + idempotency; conflicts keep both versions; deliberate resolve | SYNC doc · SYNC 26/0 · SCHOOLSYNC 22/0 |
| Offline | durable outbox (default localStorage), restart survival, device replacement | OFFLINE doc · browser §5/§7/§8 |
| Excel import/export | local-only audit (network-disabled proof), real-engine checks, clean reimport of exports | EXCEL doc · IMPORT 18/0 · EXCEL 24/0 |
| Calculation integrity | engine UNCHANGED; 329 regression + 13 boundary checks; adapter/export grade-equality | CALCULATION doc |
| Security controls | findings register: 0 CRITICAL open, 1 HIGH (legacy, contained), fixed items F2–F4 | SECURITY-REVIEW doc |
| Privacy engineering | minimisation, retention draft, PIPIA + DPA packs, under-14 design | CHINA-PRIVACY doc |
| Backup & recovery | admin backup endpoint; RESTORE PROVEN into isolation; proposed RPO/RTO | BACKUP doc · BACKUP-RESTORE 10/0 |
| Performance | 1/5/20 classes zero failures; 2 000-row pull 281 ms; restart durable | PERFORMANCE doc · bench |
| Mobile & browsers | full suite on Edge + mobile emulation; physical devices = manual checklist | DEVICE doc |

## 16. Test statistics (final sweep 2026-11-14 on the final code/build)

| Suite | Checks | Failures |
|---|---:|---:|
| calc-regression | 329 | 0 |
| calc-boundaries (new R18) | 13 | 0 |
| classstore | 148 | 0 |
| completeness | 62 | 0 |
| round5 / round6 / round7 | 49 / 32 / 38 | 0 |
| data-safety / notices | 36 / 28 | 0 |
| excel-import (round trip) | 24 | 0 |
| spraudit / import-acceptance | 20 / 18 | 0 |
| spradapter | 38 | 0 |
| device-sync (jsdom) | 114 | 0 |
| sync-ux (browser-level) | all pass | 0 |
| server: RBAC | 43 | 0 |
| server: sync | 26 | 0 |
| server: migrations (+guardrails) (new R12/28) | 21 | 0 |
| server: backup-restore (new R24) | 10 | 0 |
| server: schoolsync | 22 | 0 |
| server: adversarial | 45 | 0 |
| browser e2e (Edge, 23-step + mobile) | 25 | 0 |
| npm audit (prod+dev) | 0 vulnerabilities | — |

(App-level suites were re-verified on the final bundle earlier the same day;
server + e2e + calc suites re-executed in the closing sweep —
`docs/qa/round29/final-sweep.log`.)

## 17. Known limitations (complete list, nothing hidden)

1. School server NOT deployed — no hosting/domain/ICP (external).
2. Legacy Supabase: 88 encrypted rows publicly readable until owner acts
   (writes blocked; app refuses unauthenticated writes).
3. Physical Android/iPhone/iPad acceptance outstanding (manual checklist).
4. Same-record different-field offline edits surface as a version conflict
   for deliberate resolve (no auto field-merge) — conservative by design.
5. No conflict inbox UI; conflicts resolve at write time.
6. No admin MFA yet (recommended before real student data — backlog).
7. Outbox not partitioned per account on shared devices (work kept, 403
   typed error for the other user; documented).
8. In-memory rate limiting (single-instance deployment model).
9. `.xls` legacy import best-effort, not acceptance-tested.
10. No fuzz harness for the calc engine (example-based coverage only).
11. RPO/RTO are proposed targets pending school approval.

## 18. Outstanding external dependencies

See EXTERNAL-APPROVALS-AND-DEPENDENCIES.md — hosting, domain+ICP, legal
review, Supabase decisions, physical devices, DPA sign-off, credentials
custody.

## 19. Deployment readiness

DEPLOYMENT-AND-OPERATIONS-GUIDE.md is complete and guardrail-tested; the
staging configuration is in the repo; rollback documented. Ready to execute
the moment the school provisions hosting.

## 20. Exact steps required before production

1. School: choose + subscribe Mainland hosting; provide `SPR_DB_URL`,
   `SPR_ADMIN_PW`, TLS/domain (after ICP filing).
2. Operator: deploy per the guide; create a SECOND admin; run the manual
   acceptance checklist on real devices.
3. Owner: execute the legacy Supabase containment (step 3 of the readiness
   doc) — reversible, 10 minutes.
4. School + counsel: approve PIPIA/DPA/retention; confirm guardian-notice
   approach; sign off.
5. Then: migrate real classes via the audited Excel import path with
   teacher confirmation at every step.

**This release is NOT marked production-ready.** It is technically
release-ready (classification B): every technical gate that can be closed
from this repository is closed and evidenced.
