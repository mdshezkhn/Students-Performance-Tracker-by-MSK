# Database & Migration Review — Round 12

Reviewed and extended 2026-11-14. Schema: `server/schema.sql` + versioned
migrations in `server/migrations/`. Tests: `tests/test-server-migrations.mjs`
(**21/0**, includes the production-guardrail checks).

## Entity model (as built — mapped, not inflated)

schools · users (role, active, must_change_pw) · sessions (revocable) ·
classes · class_memberships (duty fet/cet) · students (active, archived_at,
under14) · semesters · records (category observation|spelling|test|daily,
period, ordinal, version) · sync_ops (idempotency) · audit_events
(DB-immutable) · schema_migrations (ledger).

The mandate's list maps onto this without extra tables: "assessments /
assessment categories" are the record `category` + `period` + `ordinal`
(the SPR model has no separate assessment entities — adding them would be a
rewrite, not a gap). "Import sessions / export records / device
registrations" are covered by audit events (import/export audited) and
sessions; standalone tables would duplicate state.

## Integrity — implemented and tested

- PKs everywhere; FKs with `on delete cascade` for genuine deletes only.
- Uniques: `(school_id, username)`, `(school_id, class name)`,
  `(class_id, student_no)`, `(class_id, student_id, category, period,
  ordinal, semester_id)` for records, `(user_id, idem_key)` for replays.
- Indexes on membership/session/student/record lookups (query paths used by
  every request).
- School isolation in every query (school_id scoping) — verified by 45
  adversarial checks, not assumed.
- Version consistency: `expected_version` optimistic check on writes.
- Archive vs deactivate vs correction vs deletion: **archive** = reversible
  flag (002 migration + API, tested); **deactivate** = account-level; a
  **correction** = a new record version (audited); **deletion** = never
  offered by the API (retention-expiry deletion is an owner-executed DB
  procedure under the retention policy).

## Migration mechanism (round 12)

- `schema_migrations` ledger (version, name, sha256 checksum, applied_at).
- 001 = the original idempotent baseline (recorded-only for DBs that predate
  the ledger — detected by existing tables + empty ledger; tested §2).
- 002 = archive semantics (partial index included).
- Boot applies unapplied migrations in order; a failure aborts startup
  (fail-closed). Rollback strategy: migrations are forward-only; restore the
  pre-deploy backup (BACKUP-RESTORE doc) — documented, tested procedure.
- Clean-DB and populated-DB upgrade paths both tested (§1/§2), re-boot
  stability tested (§3).

## Honest limitations

- No down-migrations (forward-only by design; rollback = restore).
- Single-node PostgreSQL target; no replication topology configured
  (hosting-layer decision, see deployment guide).
