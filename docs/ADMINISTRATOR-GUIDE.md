# SPR — Administrator Guide

For the school administrator account (created on first backend setup; see
docs/DEPLOYMENT-GUIDE.md for server-side concerns, which stay with the
owner/operator, not with teacher accounts).

## Accounts
- One account per teacher. Never share logins; the audit trail depends on it.
- Create: Users → Add teacher → name, username, role (**FET** = foreign
  teacher, observations; **CET** = Chinese teacher, assessments), starting
  password (shown once; the teacher changes it at first sign-in).
- Deactivate the account the day a teacher leaves (Users → Deactivate):
  their sessions die immediately; records and history stay.
- Reset password: generates a one-use link/code expiring in 30 minutes.

## Classes and assignments
- Classes → New class (name follows the school convention, e.g. "Primary 4A").
- Assign BOTH teachers to a class: the FET and the CET see the class only when
  assigned. Assignment changes are audit-logged.
- Roles decide what each teacher can write — this is enforced by the server,
  not by the app interface, so it cannot be bypassed by a modified browser.

## Semesters
- Manage semesters at semester boundaries (end one, start the next). Old data
  stays available for cross-semester comparison; do not delete past semesters
  casually — deletion is audit-logged and recoverable only from backups.

## Audit history
- Admin → Audit: who signed in, who changed what and when, failed attempts,
  exports, imports, conflict resolutions. Filter by teacher/class/date.
- The audit never contains student names or observation text — only record
  identifiers — so it is safe to screenshot for management reporting.
- Review weekly: bursts of failed logins or unexpected exports deserve a
  question.

## Data protection duties (China)
- Keep docs/PRODUCTION-SECURITY-CHECKLIST.md current (initial items at
  go-live, weekly 5-minute checks).
- Guardians' consent records for under-14 students: school-managed (paper or
  school system); SPR only marks the flag — see docs/PIPIA-IMPLEMENTATION-DRAFT.md.
- Deletion/correction requests from guardians: export the student's records,
  apply the school's decision, record the action in the audit note field.
- Do NOT paste student data into external AI tools or send it abroad; the
  data-flow inventory (docs/DATA-FLOW-INVENTORY.md) lists what goes where.

## Backups (if you are also the operator)
- Nightly encrypted dumps are the recovery path — test a restore quarterly.
- On-staff handover: transfer the operator role by re-running the server
  setup with a new admin, then deactivate your own.

---

## Round 12–28 additions (2026-11-14)

New capabilities since the first edition of this guide:

| Action | How | Audited as |
|---|---|---|
| Archive a student (reversible; keeps all records) | `POST /api/admin/students/:id/archive` (school-server panel tooling) | `student.archive` |
| Restore an archived student | `POST /api/admin/students/:id/restore` | `student.restore` |
| Re-activate a deactivated account | `POST /api/admin/users/:id/activate` | `account.activate` |
| Revoke all sessions of a user (suspected theft / departure) WITHOUT disabling the account | `POST /api/admin/users/:id/revoke-sessions` | `account.revoke-sessions` |
| Full-school backup (JSON; contains password hashes — treat as sensitive) | `GET /api/admin/backup` (admin session) | `backup.create` |
| Migrations | automatic at boot; ledger in `schema_migrations` (versioned + checksummed) | — |

Operational rules:

1. **Bootstrap password**: the first admin is created with the password from
   `SPR_ADMIN_PW` (production refuses to start without it). With the DEFAULT
   password the account is locked to password-change until rotated — by
   design; rotate immediately in any environment.
2. **Admin-created teacher accounts** always force first-login password
   rotation; the teacher cannot use the API until they set their own
   password.
3. **Production guardrails** (SPR_ENV=production): owner-set admin password,
   PostgreSQL store (SPR_DB_URL), Secure cookies — the server refuses to
   boot otherwise. See DEPLOYMENT-AND-OPERATIONS-GUIDE.md.
4. **Restore drill**: monthly, run `node tests/test-backup-restore.mjs`
   procedure against a copy of the latest backup in an isolated directory.
