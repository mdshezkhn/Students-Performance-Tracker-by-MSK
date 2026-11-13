# SPR Data Retention Policy — DRAFT for school confirmation

Prepared 2026-11-13. Numeric periods are **proposed defaults**; the school must confirm them (they interact with the school's own record-keeping duties for student work and with PIPL minimisation).

## What is kept, where, for how long

| Data | Location | Online retention | Then |
|---|---|---|---|
| Student records (current academic year) | China-hosted PostgreSQL | while the class is active + current year | soft-delete, see purge below |
| Student records (previous academic year) | same | 1 previous year, read-only for reports | exported to the school's sealed archive, then deleted from the live DB |
| Cross-semester comparisons | derived live from the years above | n/a | recomputed, never separately stored |
| Audit events (`audit_events`) | same DB | **24 months** (security accountability) | oldest deleted by scheduled job |
| Sessions | `sessions` table | 12 h expiry, deleted/pruned daily | gone |
| Sync idempotency ops | `sync_ops` | 90 days | pruned |
| Teacher accounts | users table | while employed; deactivate on leaving | personal identifiers minimised to username after 12 months |
| Backups (pg_dump, encrypted) | China object storage/volume | 35 daily + 12 monthly | rolled |
| Browser local data (per teacher device) | sealed localStorage/IndexedDB | follows the device; "Erase this browser's data" removes it | gone |
| Teacher's downloaded backup files / Excel exports | wherever the teacher saved them | teacher/school policy — name it in the staff guide | school decision |
| Interim Supabase cloud copies | Seoul (to be retired) | until migration completes + verification | purged (MIGRATION-PLAN.md §5) |
| SPR audit reports from the import wizard | teacher's device | not stored by the app | teacher deletes after review |

## Deletion mechanics (implemented or specified)
- **Student**: `active=false` immediately hides from teachers; scheduled purge job removes the row (and its records) when the retention window lapses or the school confirms deletion. Deletion requests from guardians route through the administrator (ADMINISTRATOR-GUIDE.md) — target 15 working days.
- **Records**: soft-delete with version bump (auditable restore); purge follows the student.
- **Account**: deactivate + immediate session revocation (implemented + tested).
- **School exit**: export-then-destroy runbook — full `pg_dump` handed to the school, then DB dropped, backups destroyed per provider confirmation, browser data erased per device by staff.

## Special rules
- **Minors' data**: no separate longer retention is justified; shorter is fine once reports are issued.
- **Legal holds**: if the school is subject to a preservation duty (dispute, inspection), suspend purge for the affected records and note it in the audit file.
- **Backups are NOT immortal**: the monthly rotation is the hard limit on "forgotten" data surviving in backups.
