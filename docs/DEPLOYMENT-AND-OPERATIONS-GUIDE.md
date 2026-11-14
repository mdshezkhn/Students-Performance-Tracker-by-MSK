# Deployment & Operations Guide — Round 28

For the person who will run the school server. Nothing here is deployed yet;
this is the verified procedure. Companion docs: PRODUCTION-SECURITY-CHECKLIST.md
(existing), MIGRATION-PLAN.md, ROLLBACK-PLAN.md, BACKUP-RESTORE-AND-DISASTER-RECOVERY.md.

## 1. Environments (strictly separated)

| Env | Store | Data | Where |
|---|---|---|---|
| Development | PGlite in-memory/file (devDependency) | synthetic only | laptop/CI |
| Test/CI | PGlite (same SQL, same code) | synthetic only | `npm test` + server suites |
| Staging | PostgreSQL (small instance) | synthetic only | school-approval pending |
| Production | PostgreSQL (Mainland China hosted) | real records | **not provisioned** |

No test credentials or fixtures exist in the server code path; the default
admin password is REFUSED in production (see guardrails below).

## 2. Build

```
python source/build2.py          # regenerates deploy/ (+ app/, index.html)
```
Generated files are never hand-edited; `source/` is authoritative. Verify
`git status` is clean before building. The bundle embeds a shell hash
(`spr-app-shell-<hash>`) for cache busting.

## 3. Production boot (guardrails enforced)

The server refuses to start in production mode unless ALL of these hold:

| Variable | Requirement |
|---|---|
| `SPR_ENV=production` | marks production mode (or NODE_ENV=production) |
| `SPR_ADMIN_PW` | MUST be set — the default bootstrap password is refused |
| `SPR_DB_URL` | MUST be set — in-memory dev storage is refused |
| `SPR_COOKIE_SECURE` | must NOT be `0` (unless `SPR_ALLOW_INSECURE_COOKIE=I-KNOW` for a stagingTLS exception) |

First boot creates the schema (versioned migrations), the school row and the
admin account with your password. Immediately sign in and change the password
(the account works but every other API call is blocked until rotation —
enforced server-side since round 13).

Recommended process supervision: systemd unit (`Restart=always`,
`User=spr`, `EnvironmentFile=/etc/spr.env` chmod 600) or Windows service
wrapper. One instance, one port (`SPR_PORT`, default 8787). Bind behind a
reverse proxy.

## 4. TLS

The app server speaks HTTP on localhost; TLS terminates at the reverse proxy
(nginx/caddy) in front. REQUIREMENTS: HTTPS only, redirect HTTP→HTTPS,
HSTS after the school confirms the domain, modern ciphers (proxy defaults).
Cookies are `Secure` by default in production.

## 5. Static app + API on one origin

`SPR_STATIC_DIR=app` serves the PWA from the same origin (no CORS anywhere —
the server never emits CORS headers, verified by adversarial §13b). This is
the supported deployment shape; the app's CSP allows same-origin API calls.

## 6. Database

- PostgreSQL 14+; user `spr` with rights ONLY on the SPR database (no
  superuser). Migrations run automatically and are recorded in
  `schema_migrations` (versioned, checksummed).
- Daily `pg_dump` cron + the JSON `/api/admin/backup` after significant
  changes (see BACKUP-RESTORE doc; restore is TESTED, not assumed).

## 7. Health & logs

- `GET /api/health` → `{ok, store, time}` (no data) — wire to uptime checks.
- Server console: startup lines only. No request payloads are ever logged.
  Operational history = `audit_events` (DB-immutable).
- Watch: disk space, DB connections, backup freshness.

## 8. Version identification

Each release: commit hash + bundle shell hash (`spr-app-shell-…` in
`app/sw.js`). `/api/health` reports the store kind; the admin UI shows the
school-server status. Record both hashes in the change log per deploy.

## 9. Rollback

1. Reverse proxy: point back to the previous instance (blue/green) or
   restart the previous systemd unit (kept as `spr@<hash>`).
2. Database: migrations are forward-only; restore from the pre-deploy
   backup if a migration must be reverted (ROLLBACK-PLAN.md).
3. App: the PWA is versioned by shell hash — serving the previous
   `app/` directory is a complete rollback.

## 10. Troubleshooting quick table

| Symptom | Cause / fix |
|---|---|
| "REFUSING TO START IN PRODUCTION MODE" | guardrails — set the named variables (never bypass for production) |
| `pg driver is not installed` | `npm install pg` on the server |
| 401 loops after deploy | cookie `Secure` over plain HTTP → put TLS proxy in front (or staging-only insecure flag) |
| CSRF 403 after login | client clock/session loss — sign in again; if persistent check proxy strips no headers |
| slow first boot | migrations + bootstrap on empty DB (seconds) |

## 11. What is NOT done (external)

Hosting subscription, domain, ICP filing, TLS certificate issuance, DNS —
all owner/school actions; see EXTERNAL-APPROVALS-AND-DEPENDENCIES.md.
