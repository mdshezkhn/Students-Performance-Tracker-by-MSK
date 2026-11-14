# China Privacy & Hosting Readiness — Round 25

Status: **ENGINEERING READY, LEGAL/HOSTING DECISIONS PENDING.** Nothing in
this document is a legal opinion or a compliance claim. Prepared 2026-11-14.

## Engineering controls implemented (verifiable in this repo)

| Requirement | Control | Evidence |
|---|---|---|
| Data minimisation | schema holds only: register no, names, gender, under-14 flag, scores, observations text, actor ids/timestamps. NO national ids, addresses, phone numbers, photos, biometrics, medical data | server/schema.sql; import validation rejects unexpected columns (spraudit) |
| Purpose limitation | one processing purpose (SPR assessment records + reports); no analytics, no ad SDKs, no third-party scripts | network inventory (DATA-FLOW-INVENTORY.md); bundle sweep |
| Access restriction | individual accounts, server-enforced FET/CET/admin roles, school + class isolation, DB-immutable audit | RBAC-SECURITY-ACCEPTANCE.md (45 attack checks) |
| Retention controls | archiving (reversible) vs deletion separated; retention schedule drafted for school approval | DATA-RETENTION-POLICY-DRAFT.md |
| Data-subject requests | correction = record edit (versioned, audited); deletion flow = archive + owner-executed DB deletion per policy | BACKUP-RESTORE doc + retention draft |
| Incident response | documented plan with containment, revocation, notification assessment | SECURITY-INCIDENT-RESPONSE.md |
| Security logging | audit_events (immutable, minimal — ids/versions/outcomes, no scores/names) | adversarial §12 |
| Cross-border transfer | by DEFAULT nothing leaves the device/backend; the only overseas service in the LEGACY path is Supabase (encrypted envelopes, retirement pending) | LEGACY-SUPABASE-RETIREMENT-READINESS.md |
| Under-14 safeguards | `students.under14` nullable flag; access via roles only; guardian notice/consent RECORDS designed for school management (PIPIA draft §under-14) | schema + PIPIA |

## What engineering CANNOT decide (school + counsel)

1. Lawful basis for processing minors' data and guardian
   notice/consent obligations (PIPIA draft lists the exact questions).
2. Retention periods (draft proposes; school approves).
3. The DPA terms with the chosen processor (checklist prepared).
4. Whether the under-14 flag is populated (school's lawful-reason decision).

## Hosting readiness (mandate §18.1) — assessment, NOT procurement

| Option | Data residency | ICP filing | Fit |
|---|---|---|---|
| Alibaba Cloud (ECS + RDS PostgreSQL) | Mainland region selectable | domain ICP 备案 required for a public web domain | ✅ primary recommendation |
| Tencent Cloud (Light server + TDSQL-C/PostgreSQL) | Mainland region selectable | same | ✅ equivalent |
| Huawei Cloud | Mainland | same | ✅ viable |
| Overseas host (current GitHub Pages demo) | outside Mainland | no ICP possible | ❌ for real student data |

Requirements regardless of provider: TLS certificate, domain registered and
ICP-filed under the correct owner (school or operator-as-processor with
school authorisation — counsel question), database volume encryption,
private network for the DB (no public DB port), backups in-region, access
logs retained per policy. The deployment guide covers the technical side.

## Public-security filing (公安备案)

After ICP filing, a public-security network filing (公安联网备案) is
typically required for websites operating in Mainland China within ~30 days
of going live — **exact obligation and timeline must be confirmed by the
school's counsel/filing agent for their situation.** Recorded as an open
item, not asserted.

## Documents in the privacy pack

PIPIA-IMPLEMENTATION-DRAFT.md (with the round-11 legal appendix separating
engineering from legal), DATA-PROCESSING-AGREEMENT-CHECKLIST.md,
DATA-FLOW-INVENTORY.md, DATA-RETENTION-POLICY-DRAFT.md,
SECURITY-INCIDENT-RESPONSE.md, EXTERNAL-APPROVALS-AND-DEPENDENCIES.md.
