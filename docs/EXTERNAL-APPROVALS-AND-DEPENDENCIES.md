# External Approvals & Dependencies — Exact Outstanding Actions

Nothing in this list can be completed from inside the repository. Nothing
has been purchased, registered, filed, deleted or deployed. Each item: what,
why, who authorises, what is already prepared, exact remaining action, risk
if unresolved.

## 1. Mainland China hosting subscription
- **What**: a small cloud instance (Alibaba/Tencent/Huawei) + managed
  PostgreSQL in a Mainland region.
- **Why**: student records must stay in-region; the current demo host is
  overseas and holds no student data.
- **Authorised by**: school (payment + account ownership).
- **Prepared**: full deployment guide, guardrails, backup/restore procedure
  (tested), staging configuration, server sizing notes (bench data).
- **Remaining action**: school subscribes, supplies `SPR_DB_URL` +
  `SPR_ADMIN_PW` to the operator, TLS via the provider's certificate.
- **Risk if unresolved**: the school-server feature stays staging-only; no
  real-student deployment (local-only mode remains fully usable).

## 2. Domain + ICP filing (备案)
- **What**: a domain registered to the correct owner + ICP filing for the
  hosting provider; then typically the public-security filing (公安备案) —
  **obligations/timelines to be confirmed by counsel/filing agent**.
- **Why**: legally required to serve a public website from a Mainland host.
- **Prepared**: readiness doc evaluating providers; deployment guide covers
  TLS + domain wiring.
- **Remaining**: school/counsel decide the owner-of-record and file.
- **Risk**: the app cannot be legally served publicly in-country without it.

## 3. Legal review of the privacy pack
- **What**: PIPIA draft, DPA checklist, retention schedule, incident plan —
  reviewed by qualified Mainland China counsel; school's lawful basis and
  guardian-notice approach decided.
- **Prepared**: all documents drafted with explicit counsel questions.
- **Remaining**: school engagement of counsel.
- **Risk**: the platform must not be described as "compliant" until this is
  done; real-student-data use is gated on it.

## 4. Legacy Supabase decisions (owner)
- **What**: (a) tighten anonymous SELECT on `spr_channels` (reversible) or
  run the write-token SQL; (b) after retention decision + authenticated
  export, delete the 88 historical rows and retire the project.
- **Prepared**: 9-step plan + live-verified status (88 rows readable; writes
  blocked server-side; app refuses unauthenticated writes).
- **Remaining**: owner executes via the Supabase dashboard.
- **Risk**: low (encrypted envelopes; no keys exposed) but non-zero until
  steps run.

## 5. Physical device acceptance (school)
- **What**: Android Chrome + iPhone Safari + iPad passes of the manual
  checklist on real devices over real networks.
- **Prepared**: FINAL-MANUAL-ACCEPTANCE-CHECKLIST.md (exact steps).
- **Remaining**: a teacher/admin with the devices performs and signs off.
- **Risk**: engine-specific mobile quirks remain unconfirmed.

## 6. School data-processing approvals
- **What**: school approves the DPA with the chosen processor, the retention
  schedule, and the RPO/RTO targets.
- **Prepared**: checklists + proposed values.
- **Remaining**: school sign-off.
- **Risk**: operating without agreed terms is a governance gap.

## 7. Production credentials custody
- **What**: `SPR_ADMIN_PW`, `SPR_DB_URL`, TLS keys held by the school's
  chosen operator; a SECOND admin account created at provisioning.
- **Prepared**: guardrails refuse boot without them; runbook documents
  rotation.
- **Remaining**: custody assignment at provisioning time.
- **Risk**: weak custody undermines every technical control.

---

## Blocker-closure update (2026-11-14, evening)

Legacy-Supabase item status after closure work: repository preparation is
COMPLETE (hardened SQL, rollback, `scripts/verify-containment.sh`, corrected
evidence docs). The remaining action is unchanged and owner-only: execute
`docs/supabase-write-token.sql` STEP 1 in the Supabase SQL editor (after the
§2 backup), paste back the §7 CHECK result, then run the verification
script. No other item changed.
