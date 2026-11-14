# Master Execution Baseline — Rounds 11–30 Programme

Recorded 2026-11-14 at the start of the Rounds 11–30 mandate, after Round 11
was completed and pushed. This file records the state the programme starts
from so every later round can be judged against it.

## Starting state

| Item | Value |
|---|---|
| Starting commit | `1217fca` ("round11 §8+§9+§11: PIPIA round-11 legal appendix …") |
| Branch | `feature/p2-secure-school` (tracks `origin/feature/p2-secure-school`) |
| Working tree | Clean except one regenerated QA log (`docs/qa/round6/sql-policy-test-output.txt`, a test artifact) |
| Generated bundle | `app/index.html` — shell `spr-app-shell-2902c83200`, rebuilt from current `source/` |
| Production | `site` branch / https://my-spr-with-mo.duckdns.org — **untouched by rounds 10–11** |
| Parent chain | `90e9bd6` (baseline snapshot) → P1/P2 work → `98fdc70` (§4+§7) → `d86c79c` (§5) → `044a671` (§6) → `1217fca` (§8+§9+§11) |

## Application architecture

- **PWA**, single generated `app/index.html` built by `python source/build2.py`
  from `source/index.template.html` + inlined modules (`calc.js`,
  `classstore.js`, `app.js`, `spraudit.js`, `spradapter.js`, `schoolsync.js`).
  Service worker caches the **app shell only** (`spr-app-shell-<hash>`), never
  authenticated API responses.
- **Two sync worlds, cleanly separated:**
  1. *Legacy personal sync* (Supabase, encrypted whole-workbook envelope).
     Since round 10 the app **refuses** any cloud write the server cannot
     authenticate (write-token RPC required; no fallback to direct writes).
  2. *School server* (new backend, OFF by default, admin-configurable):
     record-level sync with individual accounts.
- **CSP**: `connect-src` allows same-origin (school server) + Supabase only.

## Database architecture (school backend)

`server/schema.sql` (idempotent `create … if not exists`) on PostgreSQL —
production driver `pg`, tests run the same SQL on PGlite. Tables: `schools`,
`users`, `sessions`, `classes`, `class_memberships`, `students`, `semesters`,
`records`, `idempotency`, `audit_events`. Every row carries `school_id`;
record uniqueness `(class_id, student_id, category, period, ordinal,
semester_id)`; audit_events protected by a **DB trigger** that raises on
UPDATE/DELETE (verified by adversarial suite §12).

## Authentication implementation

- Individual accounts; scrypt (node:crypto, OWASP parameters) password hashing.
- HttpOnly + SameSite=Lax session cookie; Secure unless tests disable it;
  per-session CSRF token; login rate limiting (per-username lockout + per-IP
  throttle, audited as `login.throttled`).
- Anti-enumeration: unknown user / deactivated / wrong password share one
  error path (verified this round by source inspection).
- `change-password` (self, revokes all other sessions), admin
  `reset-password` + `deactivate` + `activate`, `must_change_pw` flag,
  first-run bootstrap admin from `SPR_ADMIN_PW` (default `change-me-admin`).
- **Known gap (Round 13 will address)**: no production guardrail rejecting
  the default admin password; self-service forgot-password deliberately not
  built (no email infrastructure; admin-driven reset is the school model).

## Role model (server-enforced)

`teacher` with per-class duty `fet` | `cet`, plus `admin` (manage) and
`manager` (read-only school level). Enforced in every query (school_id +
membership + duty), verified by `test-server-rbac.mjs` (40 checks) and
`test-server-adversarial.mjs` (36 checks).

## Sync implementation (school server)

- Client-generated uuid ids; monotonic `version`; `expected_version`
  optimistic concurrency; `idempotency_key` with `(user_id, idem_key)`
  unique constraint (replays return the original result with
  `replayed:true`); conflicts return **both** server and incoming versions;
  `POST /api/records/:id/resolve` records the deliberate resolution.
- Browser client `source/schoolsync.js`: durable outbox (localStorage-backed
  by default since round 11), auth/forbidden/network-typed error handling,
  never drops pending work.

## Offline implementation

- PWA shell cache; workbook state in sealed localStorage safety copies
  (round 10 C5: sealed with the data key, not plaintext); school-server
  outbox persists across browser restart (browser-test §7, 18/0).

## Excel import / export architecture

- `source/spraudit.js`: local-only workbook audit (profile → findings → CSV /
  workbook report), original never modified. Checks include error cells
  (`#REF!`), out-of-range scores, duplicate students, formula cells in data
  areas, cached-average mismatch vs the real calc engine, inconsistent maxima.
- `source/spradapter.js`: deterministic cell ↔ record bridge, round trip
  certified by `calc.gradeAll` equality; stable hex ids prevent duplicate
  imports.
- App-side SPR Excel export (existing, preserved) writes the standard SPR
  workbook layout.

## Existing tests (all synthetic data)

`calc-regression` (329), `classstore` (148), `completeness` (62), `round5`
(49), `round6` (32), `round7` (38), `data-safety` (36), `notices` (28),
`spraudit` (20), `import-acceptance` (18), `spradapter` (38),
`test-server-rbac` (40), `test-server-sync` (26), `test-schoolsync` (22),
`test-server-adversarial` (36), `test-device-sync` (114, jsdom), `test-sync-ux`
(browser-suite, all pass), `round11_browser_fet_cet.py` (18, real Playwright
contexts), `npm audit` (0 vulnerabilities).

## Build process

`python source/build2.py` → `deploy/` (+ copies to `app/`, `index.html`).
Generated files are never hand-edited; source templates are authoritative.

## Known defects / open items at programme start

1. Legacy Supabase production project: 88 anonymously-readable channel rows;
   write-protection SQL still not run by the owner (live-verified 404 on the
   RPCs). Contained app-side; retirement plan documented, **not executed**.
2. No school deployment: no domain, no ICP filing, no hosting decision —
   external, owner/school actions.
3. Default admin password must be rejected in production (Round 28 guardrail).
4. Schema migrations are idempotent-create only — no versioned migration
   mechanism yet (Round 12).
5. Physical-device (Android/iPhone) acceptance outstanding (Round 27).

## External dependencies (unchanged)

GitHub (repo), Supabase (legacy personal sync, read-only containment),
DuckDNS + GitHub Pages (legacy demo deployment, untouched). No student data
leaves the device in any test in this repository.
