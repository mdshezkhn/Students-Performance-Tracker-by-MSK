# SPR Security Incident Response

Version 2026-11-13. Roles: **Owner** (school staff member operating SPR, currently Teacher Mo), **Admin** (SPR administrator account), **Provider** (China cloud host). Keep this printed/offline: a compromised system may require steps that the attacker can see.

## 0. Severity quick triage
| Signal | Severity | First move |
|---|---|---|
| Suspected teacher-password compromise / unknown device activity | HIGH | §2 revoke sessions, §3 reset |
| Cloud copy overwritten with garbage / undecryptable | HIGH (availability) | §4 restore |
| Data exposed to people outside the school (link/key leak) | **CRITICAL** | §2 + §5 + start §6 clock |
| Provider breach notification | CRITICAL | §6 + provider DPA cooperation |
| Single teacher device lost | MEDIUM | §2 for that account + local wipe |

## 1. Breach identification
- Signals: audit trail anomalies (`GET /api/audit`: logins at odd hours, `admin.denied`, export spikes), teacher reports of unknown changes, Supabase/China-host console alerts, failed-integrity pull-checks on devices.
- Preserve evidence FIRST: export the audit window (`/api/audit?limit=500`), snapshot the DB (`pg_dump`), copy provider logs, note timestamps in Beijing time. Do not "clean up" before evidence is captured.

## 2. Immediate containment
1. Admin: deactivate affected accounts (`POST /api/admin/users/:id/deactivate`) — sessions revoke instantly (tested).
2. If the compromise is wider: rotate ALL teacher passwords (reset-password endpoint forces `must_change_pw`), and revoke every session by restarting the API with `SPR_LOCKDOWN=1`-style maintenance mode (or stop the process — availability loss is acceptable during containment).
3. Interim Supabase path: if the cloud channel is the suspect vector, turn device sync OFF school-wide (owner control file supports read-only/locked modes) and delete the affected channel rows from the Supabase dashboard.

## 3. Credential rotation
- Teacher + admin passwords: reset via admin; users must change on next sign-in.
- Interim channel write tokens: turn device sync off/on per class (regenerates + re-arms).
- Provider/database credentials: rotate in the provider console; update `SPR_DB_URL`; restart API (sessions survive in DB — also revoke by clearing `sessions` if the DB credential itself leaked).
- If ANY key material appeared in a chat/photo: treat those channels as burned; rotate via the flows above.

## 4. Data restoration
1. Identify the last good nightly backup (or the `previous` payload on the interim channel).
2. Restore per ROLLBACK-PLAN.md §restore (pg_restore into a fresh database, point the API at it, verify with record-count + spot grade checks via the calc regression sample).
3. Teachers' offline devices reconcile on next sync — conflicts surface as 409 dialogs, never silent overwrites.

## 5. Evidence preservation
Freeze (do not delete): audit exports, DB snapshot, provider incident ticket numbers, affected chat messages/screenshots (for link/key leaks). Store with the PIPIA file. Chain of custody: who collected what, when.

## 6. Notification assessment (China law — engage qualified counsel)
- **Regulators**: PIPL Art. 57 requires notifying the personal-information protection department when a leak/incident occurs (补救措施、通知义务); the Network Data Security Management Regulations and 2026 CSL amendment set notification duties for network incidents. Counsel decides content + timing (notification without undue delay is the safe reading; include categories, causes, harm, remedies).
- **Guardians/students**: PIPL Art. 57 notice to individuals when harm may occur; the school decides scope + wording (guardian notice template recommended; minors' data involved here by definition).
- **Provider**: DPA breach-cooperation clause (see DATA-PROCESSING-AGREEMENT-CHECKLIST.md).

## 7. Internal escalation
Owner → school principal (approval for external notifications) → provider support ticket → (if criminal conduct) local police via the school's established channel. Record each step.

## 8. Recovery verification
- All suites green on the restored instance (`npm test` locally; `node tests/test-server-rbac.mjs` + `test-server-sync.mjs` against staging).
- Audit trail shows the restore + rotation events.
- 48 h heightened watch on `audit_events` (login.fail spikes, admin.denied).

## 9. Post-incident
Update SECURITY-BASELINE.md, the PIPIA residual-risk table, and this runbook with what actually happened. Rotate any secret an attacker could have seen. Timeline of the incident (detection → containment → resolution) into the school file.
