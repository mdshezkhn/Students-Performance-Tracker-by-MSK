# SPR RELEASE READINESS MATRIX — after the overnight execution (2026-11-15)

Evidence legend: suite = automated suite in `tests/` (all green in the overnight battery,
`docs/qa/final-drive/battery-2026-11-15.log` + overnight re-run); e2e = real-browser test
(`tests/demo_flow_browser.py`, 19/0 local, partially live); live = verified against the
deployed https://spr-school-demo.pages.dev; manual = needs a human on a device.

| Area | Status | Evidence | Remaining blocker |
|---|---|---|---|
| Authentication (class mode, per-teacher accounts) | PASS | demo e2e (fet-demo + cet-demo sign-in, session restore); classstore login-wrap suites; battery round5/6/7 | — |
| FET workflow | PASS | demo e2e opens P4-A Demo as fet-demo; role matrix `can()` unit tests 148/0; approval queue seeded | manual feel-check Monday |
| CET workflow | PASS | demo e2e signs in as cet-demo, sees classes; score-edit rights + propose-obs path unit-tested | manual feel-check Monday |
| Class access control (school roles) | PASS | classstore permission matrix tests; server RBAC 43/0 + adversarial 45/0 (backend, staged) | — |
| Student records (local, encrypted) | PASS | class blobs AES-GCM sealed; keyring wraps; data-safety 36/0 | — |
| Offline functionality (PWA shell + local data) | PASS | e2e offline section (browser restart survival) in round11 suite; SW shell caching; demo e2e reload persistence | physical-device spot check |
| Synchronisation (school backend, record-level) | PASS (staged) | server-sync 26/0, schoolsync 22/0, device-sync 114/0 | backend not deployed (hosting decision) |
| Conflict handling | PASS (staged) | adversarial/sync suites: both versions kept, owner resolution, replay-safe | — |
| Excel import/export + audit | PASS | excel-import 24/0, spraudit 20/0, import acceptance 18/0 (local-only parsing proven) | real school workbook shapes Monday |
| Reports and calculations | PASS | calc regression 329/0 + boundaries 13/0; demo data graded by the real engine | — |
| Desktop usability | PASS | e2e 1280×900; QA rigs across the project | — |
| Android testing | PARTIAL | 390×844 emulation in e2e (no overflow); no physical Android device tonight | owner: physical phone pass |
| iPhone testing | PARTIAL | same emulation only | owner: physical iPhone pass |
| Backup and restore (local) | PASS | backup/restore 10/0; class export/import round trip | — |
| Security (bundle + backend) | PASS | 0 secrets in bundle; npm audit 0 vulns; adversarial 45/0; audit-log DB trigger | production hosting hardening later |
| Deployment (demo environment) | PASS | https://spr-school-demo.pages.dev live, byte-identical to the tested build | — |
| Production deployment (real school) | NOT TESTED | deliberately not started | owner hosting + ICP + legal decisions |
| Legacy Supabase containment | PASS (contained) | RPCs enforcing (live-verified); app refuses unauthenticated writes; census documented | owner decision: retire the 88 rows |

Deployed demo bundle: `71074c2e16` (spr-app-shell). Feature branch: `feature/p2-secure-school`.
