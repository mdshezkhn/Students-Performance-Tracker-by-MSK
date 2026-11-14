# RBAC Security Acceptance — Round 14

Verified 2026-11-14 against the real backend (`server/spr-server.mjs`) by
direct HTTP attacks, not by reading the frontend. Evidence suites:
`tests/test-server-rbac.mjs` (**43/0**), `tests/test-server-adversarial.mjs`
(**41/0**, run with `SPR_SESSION_HOURS=0.0042`), `tests/test-server-sync.mjs`
(26/0). All data synthetic.

## Role model implemented (server-side)

| Capability | FET | CET | admin | manager |
|---|---|---|---|---|
| Read assigned class records/roster | ✅ | ✅ | ✅ (school-wide) | ✅ (read-only) |
| Write observation | ✅ | ❌ 403 role | ✅ | ❌ |
| Write spelling/test/daily | ❌ 403 role | ✅ | ✅ | ❌ |
| Create/archive/restore students | ❌ | ❌ | ✅ | ❌ |
| Create users, memberships, semesters | ❌ | ❌ | ✅ | ❌ |
| Deactivate/activate/reset password/revoke sessions | ❌ | ❌ | ✅ | ❌ |
| Read audit events | ❌ | ❌ | ✅ | ❌ (manager sees reports, not audit) |
| Class export | assigned only | assigned only | ✅ | ✅ |

Duty comes from `class_memberships` joined to the SESSION user — never from
the request body (`membershipsFor(store, ctx.user.id)`).

## Attack results (actual HTTP responses)

| Attack | Response | Suite |
|---|---|---|
| GET unassigned class records | **403** `not your class` | adversarial §1 |
| Write with unassigned class id in body | **403** `not assigned` | adversarial §1 |
| Foreign (other-school) class read/write | **404** `no such class` (no existence disclosure) | adversarial §2 |
| CET writing an observation | **403** `role cet cannot write category observation` | rbac, sync |
| FET writing spelling | **403** role rule | rbac |
| Record id of another class behind an assigned class id (BOLA) | **400** identity guard `record identity (class/student) cannot change` | adversarial §13 |
| Record id from another school | **404** `no such record` | adversarial §13 |
| Forged user id / school id / role in body | ignored — `/api/me` reflects the session | adversarial §4 |
| Expired session | **401** | adversarial §5 |
| Deactivated account (existing session) | **401** on next call | adversarial §6 |
| Re-login while deactivated | **401** (same message as wrong password — no enumeration) | adversarial §6 |
| Replayed successful write | **200** `{replayed:true}`, no duplicate row | adversarial §7 |
| Cross-site request without CSRF header | **403** `missing or wrong CSRF token` | rbac §1 |
| Export of unassigned class | **403** | adversarial §9 |
| Manager attempting an edit | **403** admin only | rbac |
| Teacher calling admin endpoints (incl. activate/revoke) | **403** | rbac, migrations §4 |
| Resolving another user's conflict (unassigned class) | **403/404** | sync suite |
| `must_change_pw` account using the API | **403** `set a new password before using the app` | rbac §1 (round 13) |

## Added this round

- `POST /api/admin/users/:id/revoke-sessions` — standalone revocation
  (session theft / teacher departure) without deactivating the account.
  Audited as `account.revoke-sessions`; verified dead-session-immediately +
  account-still-usable (adversarial §13).
- Explicit BOLA tests for record-id manipulation (both cross-school 404 and
  same-school identity-guard 400 paths).

## Known limitations

- Rate limiting is per-process in-memory — with multiple backend instances a
  shared store would be needed (single-instance deployment is the current
  model; documented in DEPLOYMENT-AND-OPERATIONS-GUIDE.md).
- The manager role is coarse (school-wide read). Fine-grained per-class
  manager visibility would need a product decision.
