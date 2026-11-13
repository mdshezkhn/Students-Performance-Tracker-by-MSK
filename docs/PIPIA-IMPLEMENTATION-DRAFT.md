# PIPIA Implementation Draft — SPR (Students Performance Report)

> **TECHNICAL DRAFT — requires school review and qualified legal counsel before
> any claim of PIPL compliance is made.** Prepared 2026-11-13 on branch
> `feature/p2-secure-school`. This document supports, and does not replace, a
> formal Personal Information Protection Impact Assessment (个人信息保护影响评估,
> PIPL Art. 55/56).

## 1. Processing purposes
Record, calculate and report English-subject performance (observations, spelling, daily assignments, tests) for primary-school classes; replace the school's shared Excel SPR workbook; let the two teachers of each class (FET + CET) work concurrently; give school management aggregate oversight.

## 2. Categories of personal information processed
| Category | Fields | Minimisation decision |
|---|---|---|
| Student identity | internal UUID (client-generated / server UUID), school register number (class roster), Chinese name, English name, gender (M/F, optional) | national ID, home address, phone numbers, photos, biometrics, medical data, family/financial data are **not collected and are rejected by design** (schema + import validation) |
| Performance | observation ratings 0–10 per skill, spelling/daily scores with maxima, test scores, free-text observation notes | notes guidance limits to professional, education-focused remarks; server caps note length at 2000 chars |
| Age-related flag | `under14` boolean (nullable) — capability for PIPL minors' rules | **no birthdate stored**; school determines whether it has a lawful basis to hold even this flag |
| Teacher identity | username, display name, role, duty, password (scrypt hash only) | no teacher national IDs |
| Security metadata | session ids (hashed), CSRF tokens, audit events (actor, action, target ids, timestamps, request ids) | **no scores, notes or names in logs** (tested) |

## 3. Data subjects and users
Students (minors, primary school → nearly all under 14), teachers (FET/CET), school administrators, school management (read-only role).

## 4. Processing operations and flows
See `docs/DATA-FLOW-INVENTORY.md` (verified endpoint-by-endpoint). In the target state: browser ⇄ China-hosted API ⇄ China-hosted PostgreSQL; sealed local caches; audit trail.

## 5. Storage locations
Target: one Mainland-China VPS (application) + PostgreSQL (same host/region) — provisioning checklist in `DEPLOYMENT-GUIDE.md`. Interim (must be closed by migration): Supabase Seoul holds **encrypted-only** workbook ciphertext; GitHub Pages holds code only.

## 6. Third-party providers
Target state: the cloud/VPS provider + domain registrar only. Each requires a data-processing agreement per `DATA-PROCESSING-AGREEMENT-CHECKLIST.md` (PIPL Art. 21) and, where they act as entrusted processors, the contract items of Art. 21 + security obligations under the Data Security Law.

## 7. Retention
See `DATA-RETENTION-POLICY-DRAFT.md` (default: current + previous academic year online; older = exported sealed archive; deletion requests within 15 working days).

## 8. Access permissions
Server-enforced matrix (`server/spr-server.mjs`, tested in `tests/test-server-rbac.mjs`): FET writes observations; CET writes spelling/test/daily; both read their own classes; management reads all, writes nothing; admin manages accounts and reads audit. No frontend-only checks remain for student data.

## 9. Risks to students & controls
| Risk | Control | Residual |
|---|---|---|
| Overwriting/tampering with records (the Excel problem) | authenticated record-level writes, version conflicts, append-only audit | low |
| Cross-class/cross-school leakage | school+class scoping derived from the session on every operation (tested) | low |
| Key material in chat links (old design) | links carry no keys (C3 fix); keys are separate secrets; accounts replace keys in target state | medium until legacy links die out |
| Teacher device theft/shared classroom PC | local data sealed under password-derived keys; sessions 12h; sign-out revokes | medium (device hygiene is a school policy matter) |
| Cloud copy vandalism (pre-upgrade server) | app refuses unprotected writes (C1 fix); write-token SQL on the interim host | low once SQL is run (owner action) |
| Excessive free-text notes about children | input guidance + length cap; PIPIA recommends periodic spot-check by admin | medium (behavioural) |
| Insider misuse (teacher reads other classes) | membership enforcement + audit trail with actor on every read-export | low-medium |

## 10. Encryption controls
TLS in transit (China host, HSTS recommended); scrypt password hashing (N=2^17,r=8,p=1); AES-GCM for local at-rest (PBKDF2-wrapped keys) and for the interim cloud channel; PostgreSQL at-rest encryption = provider volume encryption (deployment checklist item); keys never in URLs or logs.

## 11. Backup and recovery
Nightly `pg_dump` (encrypted storage, 35-day rotation) + weekly restore drill; browser-side: sealed full-backup file (user-initiated) + sealed safety copies. Backups carry the same access restrictions; restore is admin-audited.

## 12. Deletion procedures
Student: soft-delete + purge job after retention window; account: deactivate + session revoke (immediate, tested); school exit: export-then-destroy runbook in RETENTION doc; Supabase quarantine-and-purge in MIGRATION-PLAN.

## 13. Incident response
`SECURITY-INCIDENT-RESPONSE.md` (containment, session revocation, rotation, restoration, evidence, notification assessment per PIPL Art. 57 and the Network Data Security Management Regulations).

## 14. Cross-border transfer assessment
Current interim path (Seoul, encrypted) has **no assessed lawful mechanism** → treated as a defect to be closed by migration, not accepted. Target state: no cross-border transfer of student personal information. Code hosting on GitHub involves no student data.

## 15. Under-14 (minors) specifics
`under14` capability flag; school must determine the notice/consent approach for guardians (PIPL Art. 31; Children's PI Network Protection Rules); dedicated handling rules (access restricted to the child's teachers + admin), guardian request channel (correction/deletion) documented for the admin guide. **Teacher authentication does not substitute guardian consent where consent is the required basis — the school must decide the basis with counsel.**

## 16. Residual risks & sign-off
To be completed with the school: (1) lawful-basis decision for minors' data; (2) guardian notice text; (3) retention period confirmation; (4) provider selection + DPA execution; (5) ICP filing. Until then the deployment remains **staging-only with synthetic data**.

_Sign-off (school): ____________ date ______ · (legal review): ____________ date _______
