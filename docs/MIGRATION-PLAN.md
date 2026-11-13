# SPR Migration Plan — interim (Supabase/local) → school server

Principle: **nothing is migrated or destroyed until the new environment is provisioned, tested with synthetic data, and signed off.** Production stays on its current working local-first behaviour; the interim cloud path is already refused-when-unprotected (C1 fix), so there is no forced rush.

## Phase 0 — provision (external, see DEPLOYMENT-GUIDE §1)
ICP filed, VPS + PostgreSQL + TLS live, `server/` running, health probe green. **Gate: cannot start Phase 1 without this.**

## Phase 1 — staging with synthetic data (done once, repeatable)
- Admin creates 2 synthetic classes, 4 synthetic teachers (2×FET, 2×CET), ~10 synthetic students; runs the RBAC + SYNC suites against the real database (`SPR_DB_URL=... node tests/test-server-rbac.mjs` etc. — the suites boot their own ephemeral app, so ALSO do one manual walkthrough of the Definition-of-Success scenario: FET observation + CET spelling for the same synthetic student, both visible to both).
- Import wizard exercised with a synthetic SPR workbook (audit gate → import → verify record counts + one grade recomputation).

## Phase 2 — bulk migration of REAL records (with the school's approval)
1. **Freeze window**: pick an evening/weekend; teachers stop editing.
2. **Read-only capture**: on the owner's admin device (the freshest workbook per class), export each class (Excel per semester or full JSON backup) — this is the existing, working export path; no Supabase access needed.
3. **Import into the school server**: use the import wizard per workbook (audit gate catches broken cells BEFORE they enter); verify per class: student count, months, spot-check 3 students' final grades against the app's existing reports (the calc engine is unchanged — 329-check regression green, so numbers must match exactly).
4. **Teacher accounts**: admin creates real accounts + class memberships (FET/CET duties); teachers sign in, change passwords (`must_change_pw`).
5. **Verification checklist** (per class, recorded): roster count, per-category record counts, 3 grade spot-checks, audit trail shows the import events.
6. **Dual-run (48 h)**: teachers work on the new server; the old app stays available read-only for reassurance. Any discrepancy → ROLLBACK-PLAN §abort.

## Phase 3 — cut-over + retirement of the interim path
1. Ship the front-end configuration pointing at the school server (small, reviewed change on this branch; PWA cache-bump so devices pick it up).
2. Owner turns OFF device sync in the old app school-wide (owner control file can force read-only) — devices keep their local sealed copies as a final fallback.
3. **Supabase quarantine**: mark the project read-only (revoke anon write), keep 30 days as a safety copy, then export + **purge** (delete all `spr_channels` rows, then delete the project) — closes the cross-border finding (SECURITY-BASELINE C7). Screenshot the purge for the PIPIA file.
4. Update README + DATA-FLOW-INVENTORY to the target state.

## Failure handling
- Import mismatch → do NOT edit the server by hand; re-export the class, fix the workbook per the audit report, re-import (imports are idempotent per class/student id).
- Teacher cannot sign in → password reset + audit check; never share accounts.
- Need to go back → ROLLBACK-PLAN.md (the old app + local data + Supabase read-only copy are intact until Phase 3.3 completes).

## Explicitly NOT migrated
- Plaintext teacher-chat share links (legacy `#join=...&k=...`): they still parse, but the new server has no key-links; teachers stop using them after cut-over.
- The 88 historical sealed channel rows: purged with the project in Phase 3.3.
