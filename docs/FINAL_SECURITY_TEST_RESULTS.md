# FINAL SECURITY TEST RESULTS — 2026-11-15 completion drive

Environment: repo at `e4beda8` + this session's doc/script changes (commit
recorded in `FINAL_COMPLETION_REPORT_2026-11-15.md`). Bundle under test:
`f924b90a…` (all three generated copies byte-identical, unchanged this
session). Synthetic data only; no production student data anywhere.

## 1. Test battery (23 suites) — raw logs

- Battery log (mirrored): `docs/qa/final-drive/battery-2026-11-15.log`
- Adversarial true-exit rerun: `docs/qa/final-drive/adversarial-true-exit.log`
- Browser e2e true-exit rerun: `docs/qa/final-drive/browser-e2e-true-exit.log`

**Evidence-integrity note (found and fixed during this drive):** the battery
loop's `RC=` lines captured the exit code of `tail`, not `node` (pipeline
artifact), and one suite filename was mistyped (`test-adversarial.mjs` instead
of `test-server-adversarial.mjs`). Neither affected the application. All
suites therefore count as evidenced by their **printed summary lines** (each
suite prints its own ok/FAIL totals and exits nonzero on failure by design),
and the two suites that needed it were re-run capturing true process exit
codes. Counts below are from the summaries, not the RC lines.

| # | Suite (command) | Summary | Failed | True exit | Notes |
|---|---|---|---|---|---|
| 1 | `node tests/calc-regression.test.js` | 329 passed | 0 | — (summary) | grading engine |
| 2 | `node tests/calc-boundaries.test.js` | 13 ok | 0 | — | |
| 3 | `node tests/classstore.test.js` | 148 passed | 0 | — | |
| 4 | `node tests/completeness.test.js` | 62 passed | 0 | — | |
| 5 | `node tests/test-round5.js` | 49 ok | 0 | — | |
| 6 | `node tests/test-round6.js` | 32 ok | 0 | — | SQL policy harness |
| 7 | `node tests/test-round7.js` | 38 ok | 0 | — | |
| 8 | `node tests/test-data-safety.js` | 36 ok | 0 | — | |
| 9 | `node tests/test-notices.js` | 28 ok | 0 | — | |
| 10 | `node tests/excel-import.test.js` | 24 passed | 0 | — | |
| 11 | `node tests/spraudit.test.js` | 20 ok | 0 | — | |
| 12 | `node tests/test-import-acceptance.js` | 18 ok | 0 | — | |
| 13 | `node tests/spradapter.test.js` | 38 ok | 0 | — | |
| 14 | `node tests/test-server-rbac.mjs` | 43 ok | 0 | — | |
| 15 | `node tests/test-server-sync.mjs` | 26 ok | 0 | — | |
| 16 | `node tests/test-server-migrations.mjs` | 21 ok | 0 | — | |
| 17 | `node tests/test-backup-restore.mjs` | 10 ok | 0 | — | |
| 18 | `node tests/test-schoolsync.mjs` | 22 ok | 0 | — | |
| 19 | `SPR_SESSION_HOURS=0.0042 node tests/test-server-adversarial.mjs` | 45 ok | 0 | **0** | re-run w/ true exit; env is the suite's own anti-false-green guard |
| 20 | `node tests/test-device-sync.js` | ALL PASSED | 0 | — (banner) | ~10 min |
| 21 | `node tests/test-sync-ux.js` | ALL PASSED | 0 | — (banner) | |
| 22 | `C:/Python314/python.exe tests/round11_browser_fet_cet.py` | 25 ok | 0 | **0** | re-run w/ true exit (battery `python` lacked Playwright) |
| 23 | `npm audit` | 0 vulnerabilities | 0 | — | |

Total: **1,027 discrete passing checks, 0 failures.**

Skipped: none. Not executed here: physical Android/iOS devices (manual
checklist), school-server production deployment (unauthorized by design).

## 2. Build verification

No source file that feeds the bundle changed this session (docs + one script
only), so the committed bundle remains authoritative: `app/index.html`,
`deploy/app/index.html`, `dist/app/index.html` all sha256 `f924b90a9c8c…`
(verified §1 of `FINAL_EXECUTION_BASELINE.md`). No rebuild performed — a
rebuild would have produced a byte-different bundle and invalidated the test
evidence above for zero benefit.

## 3. verify-containment.sh — upgraded, then negative-tested

Defects found in my own earlier upgrade by negative testing (fixed this
session):

1. Explicit expected-count mismatch downgraded to WARNING yet still printed
   `CONTAINMENT VERIFIED` (false-negative risk after retirement steps).
2. The `after-D` mode argument existed but never wired into the SELECT check.

Both fixed. Current behaviour (evidence: `docs/qa/final-drive/verify-containment-*.log`):

| Scenario | Result | Exit |
|---|---|---|
| Current world, expect 88 | CONTAINMENT VERIFIED | 0 |
| Wrong expectation (87) | `FAIL row count 88 != expected 87` → CHECK FAILED | 1 |
| `after-D` vs current world | `FAIL anon SELECT still open (HTTP 200)` → CHECK FAILED | 1 |

Checks it now genuinely performs: anon SELECT open (200) in current mode /
denied in after-D mode; anon UPDATE denied (field-bearing PATCH on
all-zeros id); anon DELETE denied; `spr_channel_ping` responds (ghost id);
`spr_channel_write` / `spr_channel_enrol` exist and enforce (400
channel-not-found on ghost id); row count as a hard assertion when an
expectation is passed. All write-shaped probes target a UUID that cannot
exist — zero rows can be affected; no INSERT is ever sent.

**Cannot be verified through public interfaces (documented limitation):**
RLS-enabled flag, the policy list, authenticated/service-role behaviour,
backup-table existence (404 to anon — correct but also unverifiable from
outside). Those require one dashboard paste (SQL file §7/§8 CHECK) — owner
action, listed in the completion report.

## 4. Secret scan

`grep` for `service_role|sb_secret` across all files changed this session:
clean. The only key appearing in the repo is the publishable anon key (public
by design, documented as such since round 5).

## 5. Standing conclusion

All automated evidence is green at this commit. Security posture conclusions
live in `FINAL_COMPLETION_REPORT_2026-11-15.md` §C — passing tests are treated
there as necessary, not sufficient.
