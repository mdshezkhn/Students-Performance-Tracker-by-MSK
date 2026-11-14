# Backup, Restore & Disaster Recovery — Round 24

Implemented and TESTED 2026-11-14. Evidence: `tests/test-backup-restore.mjs`
(**10/0**) — a backup is taken through the real API, then RESTORED into an
isolated store and verified (users authenticate with their restored password
hashes; records return with their versions; roster, audit history and class
assignments all come back).

## What exists now

- **`GET /api/admin/backup`** (admin-only, audited `backup.create`):
  consistent JSON snapshot of schools, users (with password hashes),
  classes, memberships, students, semesters, records, audit_events and the
  migration ledger. Runtime state (sessions, idempotency ledger) is
  deliberately excluded.
- **Restore procedure** (tested): load the JSON rows into a fresh database
  (the test does exactly this with `on conflict do nothing`); the server
  boots normally afterwards because the first-run bootstrap sees existing
  users.
- Production PostgreSQL: use `pg_dump`/`pg_restore` in addition — the JSON
  backup is portable and human-auditable; pg_dump is the DBA-grade path.
  Both documented in DEPLOYMENT-AND-OPERATIONS-GUIDE.md.

## Sensitivity

The backup contains password hashes — it must be stored like a key store:
encrypted at rest (volume or archive encryption), access restricted to the
administrator role, never committed to the repository.

## Verified recovery objectives (proposed targets, pending school approval)

| Objective | Proposed target | Basis |
|---|---|---|
| RPO (max data loss) | 24 h with daily scheduled backup; 1 h if the school opts for hourly `pg_dump` on the production host | backup is a read-only API call / cron job; no product constraint |
| RTO (service restored) | under 1 hour for an experienced operator | restore test boots + reloads in <1 min locally; remainder is hosting-level (DNS/host) |

These are ENGINEERING targets. The school must approve the actual schedule
and the hosting-level arrangements (see EXTERNAL-APPROVALS doc).

## Recovery scenarios (mandate §24)

| Scenario | Status |
|---|---|
| Database loss | ✅ restore from JSON backup (tested) or pg_dump |
| Users recoverable | ✅ tested (hashes survive; users re-authenticate) |
| Class assignments recoverable | ✅ tested (duty restored) |
| Assessment + observation records recoverable | ✅ tested (versions intact) |
| Audit history recoverable | ✅ tested |
| Encryption keys recoverable | Class-mode keys: teacher's sealed storage + owner key custody (existing Owner Controls). School-server world: TLS/DB encryption keys are hosting-level, documented in deployment guide. Key escrow for the class-mode world is an OWNER decision documented in OWNER-CONTROLS.md, not auto-built. |
| Restore into isolated environment | ✅ the test itself IS an isolated environment |
| Backup integrity check | Restore IS the check (mandate: a backup command is not proof). Recommended ops habit: monthly restore drill — scripted by the same test. |

## Deliberate limitations

- No scheduled/automated backup yet: the endpoint + tested procedure exist;
  the cron/scheduler belongs to the hosting layer (checklist item).
- No incremental backups (full snapshot each time). At school scale
  (thousands of records) a full JSON snapshot is small; incrementals are
  unnecessary complexity for now.
- Backup encryption AT REST is a storage-layer control (where the admin
  saves the file / volume encryption) — the API transport is TLS in
  production.
