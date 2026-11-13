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
