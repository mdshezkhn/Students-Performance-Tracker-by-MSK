# Round 29 — Full End-to-End Acceptance Report

Executed 2026-11-14 against the FINAL code, final rebuilt bundle, real
backend process and real browser contexts (Edge, headless). Synthetic data
only. Primary artefact: `tests/round11_browser_fet_cet.py` — **25/0**.

## §22.1 The 23-step teacher workflow — where each step is proven

| # | Step | Result | Suite section |
|---|---|---|---|
| 1 | Admin creates school | ✅ (boot + guardrails) | fixture |
| 2 | Admin creates FET + CET | ✅ forced-rotation accounts | fixture |
| 3 | Admin creates class | ✅ | fixture |
| 4 | Synthetic students created | ✅ Student 08 | fixture |
| 5 | Both teachers assigned | ✅ duties fet/cet | fixture |
| 6 | FET signs in | ✅ | §2 |
| 7 | FET records observation | ✅ adapter-mapped cell | §2 |
| 8 | CET signs in, separate context | ✅ separate cookies/storage | §3 |
| 9 | CET enters spelling | ✅ | §3 |
| 10 | CET enters formal test | ✅ midterm | §3 |
| 11 | CET enters daily assignment | ✅ | §3 |
| 12 | FET refresh sees assessments | ✅ spelling 9/10, midterm 88/100 | §4 |
| 13 | CET sees observations | ✅ | §3 |
| 14 | Both keep working independently | ✅ record-level coexistence | §4 |
| 15 | Network interrupted | ✅ offline mode on | §5 |
| 16 | Offline entry queued | ✅ pending=1 | §5 |
| 17 | Connection restored | ✅ | §5 |
| 18 | Synchronisation verified | ✅ sent=1, pending=0 | §5 |
| 19 | Student report generated | ✅ gradeAll on live data | §10 |
| 20 | Class report generated | ✅ aggregate | §10 |
| 21 | Class SPR exported (Excel) | ✅ real exporter, real bytes | §10 |
| 22 | Export reimported (isolated parse) | ✅ fresh XLSX.read | §10 |
| 23 | Results compared | ✅ 0 critical audit findings | §10 |

Plus beyond the 23 steps: same-field conflict (§6, both versions + owner
resolve), browser-restart survival (§7), device replacement (§8),
backup→restore (§9), admin audit trail (§11), mobile viewport (§12),
security headers + no-CORS assertions (adversarial §13b).

## §22.2 Security attack simulation

All executed as direct HTTP against the running backend, responses recorded:
unauthorised school access (404), unassigned class (403), wrong-role edits
(403 role), expired sessions (401), revoked sessions (401 immediate),
deactivated accounts (401, no enumeration), CSRF attempts (403), replays
(200 replayed:true, no duplicate), duplicates (idempotent), IDOR/BOLA
record-id manipulation (404/400 identity guard), SQL injection shapes
(handled, no error leak), XSS surface (JSON-only + nosniff + CSP), export
authorisation (403), account enumeration (uniform), session fixation (new
session+CSRF per login), brute force (429), unauthorised admin actions
(403). Full table: RBAC-SECURITY-ACCEPTANCE.md; suite ADVERSARIAL 45/0.

## §22.3 Data consistency triangle

DB record ↔ browser state ↔ sync state: browser suite §3/§4 read back what
the other context wrote (version-visible). Calculation output ↔ report ↔
Excel export: §10 chain grades the live data, exports through the real
exporter, reparses and audits clean. Synced vs workbook data: spradapter
38/0 (gradeAll byte-equality). No unexplained discrepancies in any suite.

## §22.4 Full-suite execution

Final sweep on the final build (results in the final report's table): all
suites green — see FINAL-RELEASE-READINESS-REPORT.md §16 for the counts and
the log (`/tmp/spr-final30.log` mirrored into docs/qa/round29/).

## Limitations honestly stated

- One real browser engine family executed (Edge/Chromium) + mobile
  EMULATION; physical-device + WebKit passes outstanding (manual checklist).
- The 23 steps run in ONE machine's browser contexts, not three physical
  computers on three networks — the separation is real (contexts, cookies,
  storage, simulated network cut) but the mandate's "different internet
  connections" is emulated, not physical. The manual checklist includes a
  two-teacher two-network live drill.
