# Authentication & Account Lifecycle — Round 13

Verified and hardened 2026-11-14. Evidence: RBAC 43/0, ADVERSARIAL 45/0
(incl. §5 expiry, §6 deactivation, §13 revocation), MIGRATIONS 21/0
(production guardrails), browser suite 25/0 (real sign-ins).

## Implementation summary

- Individual accounts only — no shared passwords anywhere (school rule
  enforced by design: one account per teacher).
- Passwords: scrypt via node:crypto, OWASP-parameterised (N,r,p fixed),
  per-user salt; ≥12 chars minimum on create/change.
- Sessions: server-side rows (id, csrf, expires_at, revoked_at) + HttpOnly ·
  SameSite=Lax · Secure-by-default cookie; 12 h default (env-tunable for
  tests only, clamped).
- CSRF: per-session token required on every non-GET (asserted).
- Rate limiting: per-username lockout + per-IP throttle → 429 with retry
  time; audited (`login.throttled`).
- Anti-enumeration: unknown user / deactivated / wrong password share one
  path and message.
- **must_change_pw is ENFORCED server-side (new in round 13)**: until the
  password is rotated the account can only call /api/me, change-password and
  logout. Applies to the default-password bootstrap admin AND every
  admin-created account.
- Bootstrap rule (new): `SPR_ADMIN_PW` env = owner-chosen password (no
  forced rotation); the DEFAULT password always forces first-login rotation.
  Production additionally refuses to boot without `SPR_ADMIN_PW`.

## Lifecycle operations (all admin-only, all audited)

| Operation | Endpoint | Note |
|---|---|---|
| Create account | POST /api/admin/users | forces first-login rotation |
| Deactivate | POST /api/admin/users/:id/deactivate | revokes sessions; cannot self-deactivate |
| Activate | POST /api/admin/users/:id/activate | added round 11 (was missing) |
| Admin password reset | POST /api/admin/users/:id/reset-password | revokes sessions, forces rotation |
| Revoke sessions only | POST /api/admin/users/:id/revoke-sessions | added round 14 |
| Self password change | POST /api/auth/change-password | revokes all OTHER sessions |
| Sign out | POST /api/auth/logout | revokes current session |

## Recovery scenarios (mandate §6.1)

- **Forgotten password**: teacher asks the administrator; admin resets →
  teacher rotates at next login. No email self-service BY DESIGN (no email
  infrastructure; eliminates reset-token phishing). Documented trade-off.
- **Lost device**: sessions are server-side — nothing secret beyond the
  cookie is on the device; admin revokes sessions (or the teacher signs in
  elsewhere); offline outbox on the lost device stays sealed.
- **Teacher departure**: deactivate (keeps records + audit history intact).
- **Administrator recovery**: a second admin account (recommended at
  provisioning) or owner-side DB reset of the hash (runbook in deployment
  guide) — there is deliberately no unauthenticated recovery path.
- **Reactivation**: activate endpoint (audited).
- Recovery never bypasses authorisation: every recovery op is admin-only and
  audited; no secret-bearing links exist.

## Known limitations

- Rate limiting is in-memory per process (single-instance model).
- No MFA yet (mandate asks "where feasible" — TOTP is a backlog item for the
  admin role before real student data; recorded in the final report).
- Session device list (which devices are signed in) is not surfaced in the
  UI yet — the data exists in the sessions table.
