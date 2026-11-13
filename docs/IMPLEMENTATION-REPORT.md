# SPR Implementation Report — branch `feature/p2-secure-school`

Date 2026-11-13. Baseline commit `90e9bd6` (round10 + Nov-12 demo followups,
preserved as its own commit first). All work on the feature branch; production
(`site` branch / my-spr-with-mo.duckdns.org) **untouched**.

Status key: **Implemented+Tested** (code + automated evidence) · **Staged**
(runs locally/CI, awaiting infra) · **Awaiting external action** · **Not yet
verified**.

| Item | Status | Evidence |
|---|---|---|
| Baseline captured | Done | `90e9bd6`; `npm test` pre-change: CALC 329/0, DATA-SAFETY 36/0, NOTICES 28/0, LOAD 6/0, ROUND5 44+1(style), PAIR-OPEN 9/0, classstore 144/0 |
| Security baseline doc | Done | docs/SECURITY-BASELINE.md — findings C1–C9 revalidated against HEAD **and live-probed** (RPC 404 + anon table read = 200 on prod Supabase, 2026-11-13) |
| C1 unprotected cloud writes | **Fixed+Tested** | sbSave refuses: no token → typed `protectionMissing` error, nothing written; calm UI "Cloud saving is paused", 10-min backoff; ROUND5 49/0 incl. before-SQL refusal scenario; device-sync/sync-ux suites re-based onto protected-server mocks (tests/helpers/sb-protected-mock.js) |
| C3 keys in URLs/QRs | **Fixed+Tested** | shareLink/dsLink/classLink emit id-only links; key/token shown as separate secrets (own copy buttons); legacy key-bearing links still parse; classstore 148/0 (+4 assertions); QR payloads verified key-free |
| C5 plaintext safety copies | **Fixed+Tested** | sealed with the session data key (AES-GCM) on write; old plaintext entries migrated on next stash; restore path reads sealed form; unsealable leftovers dropped with notice |
| C6 anonymous channel enumeration | Partially (app side) | refusal stops new unarmed rows; deleting the 88 existing rows + running the arming SQL = **owner action** (checklist item 7/8) |
| Backend API (P2) | **Implemented+Tested (staged)** | server/spr-server.mjs + schema.sql — scrypt password hashing, HttpOnly+SameSite sessions, CSRF, login rate-limit, per-route RBAC (FET/CET/admin/manager), school+class isolation, record-level sync with versions/idempotency/conflicts-return-both-sides, soft delete, since-pulls, append-only payload-free audit. RBAC 40/0, SYNC 26/0 on PGlite (synthetic data) |
| SPR import & audit (P3) | **Implemented+Tested** | source/spraudit.js engine (profile → checks A–E → CRITICAL/WARNING/INFO findings with cell refs); wizard in app.js: local-only parse, mapping preview, traffic-light results, CSV/PDF-ready report download, explicit "Import now" gate; SPRAUDIT 20/0 |
| Teacher UX (P4) | Implemented (shipped in build) | dashboard button now "Import existing SPR" (primary); import flow plain-English, no jargon; FET/CET flows unchanged where already role-scoped (p1-classes work); full UX test = **Not yet verified** (needs the §12.6 tester pass) |
| Calculations | **Unchanged+Tested** | calc-regression 329/0 after all changes; no thresholds touched |
| Docs B/C/D | Done | SECURITY-BASELINE / SECURITY-INCIDENT-RESPONSE / PRODUCTION-SECURITY-CHECKLIST; PIPIA-DRAFT / DPA-CHECKLIST / DATA-FLOW-INVENTORY / DATA-RETENTION-DRAFT; DEPLOYMENT-GUIDE / MIGRATION-PLAN / ROLLBACK-PLAN / TEACHER-USER-GUIDE / ADMINISTRATOR-GUIDE |
| Deployment | **Awaiting external action** | Nothing provisioned: China region choice, domain + ICP filing, PostgreSQL instance, TLS, `pg` on server — exact ordered checklist in DEPLOYMENT-GUIDE.md §owner-actions |

## Definition-of-success walkthrough (§17 of the brief)

1–11 (two teachers, two computers, independent FET/CET writes surviving,
cross-visible, unauthorised access blocked): **verified at the API level**
(RBAC/SYNC suites); the browser wiring to this backend is the next build step
(app currently speaks to it only in staging tests).
12 unauthorised teacher: **tested** (403 paths).
13 offline edits preserved: **tested** (outbox semantics, SYNC suite);
browser-side offline UX exists from round9/10 (PWA).
14 same-field conflict detection: **tested** (409 carries both versions +
resolution is audit-logged).
15 workbook import+audit without cloud upload: **tested** (SPRAUDIT + wizard,
parse is local-only by design).
16 grading unchanged: **tested** (329/0).
17 no student data to unauthorised overseas services: live remediations C1/C3
stop the interim cloud path from silently persisting; final state after
migration per DATA-FLOW-INVENTORY.md §2. **Partially awaiting migration.**
18 admin access/modification history: **tested** (audit suite section 7).

## Honest gaps

- Browser→backend wiring (login screen against spr-server, record push/pull
  UI) is the remaining P2 front-end work; the API contract is stable and
  tested, the app-side adapter is not written yet. This is the top of the
  next work list.
- UX tester pass (§12.6) not performed.
- No real deployment exists; all infra actions are owner actions.
- The 88 legacy channel rows still sit in prod Supabase until the owner acts.
- ICP filing, provider contract (DPA checklist), PIPIA legal review: school
  obligations, prepared but not performed.
