# Data-Processing Agreement Checklist (PIPL Art. 21) — SPR

**Status: checklist for the school to use when contracting providers. This is
NOT a signed agreement.** Any provider that stores, processes or can access SPR
student data (cloud/VPS host, database service, backup storage, domain/DNS
provider with data-plane access) must be covered by a contract containing at
minimum:

## Mandatory contract items (PIPL Art. 21)
- [ ] **Processing purpose** — "operation of the SPR student performance system for [school name], including storage, synchronisation, calculation and audit of student performance records".
- [ ] **Processing period** — term of service + survival clause for deletion obligations after termination.
- [ ] **Processing method** — hosted PostgreSQL + Node.js application API; encrypted volumes; no processing for the provider's own purposes; no advertising/analytics/AI training on the data.
- [ ] **Information categories** — student first names (CN/EN), register numbers, gender, performance scores and observation notes; teacher accounts; security logs (enumerate as in PIPIA §2).
- [ ] **Protection measures** — TLS, volume/backup encryption, access control, audit logging, breach notification duty to the school within an agreed short window (≤24 h suggested).
- [ ] **Rights and obligations of each party** — school remains the personal-information handler (个人信息处理者); provider is an entrusted processor (受托人) and processes only on documented instructions.
- [ ] **Subprocessors** — prior written notice + school right to object; provider remains liable; list attached as an annex and kept current.
- [ ] **Supervision** — school audit rights (or third-party audit reports, e.g. ISO 27001 / 等保 results); security-incident cooperation.
- [ ] **Return/deletion on termination** — complete return of student data in a documented format, then verifiable deletion from production, backups and archives within an agreed window (≤30 days suggested), with written confirmation.

## China-specific additions to require
- [ ] Data stored and processed **within Mainland China** (named region), replicas and backups included.
- [ ] No cross-border transfer without the school's prior written instruction and a lawful transfer mechanism.
- [ ] Provider's network-security obligations under the Cybersecurity Law and Data Security Law; if the system reaches the "important data" or CIIO thresholds later, re-assessment trigger.
- [ ] Cooperation with the school's ICP filing and, where applicable, public-security network-filing (公安联网备案).
- [ ] Breach cooperation with regulatory notification duties (the school remains responsible for notifying authorities/individuals under PIPL Art. 57).

## Practical notes
1. The big China providers (Alibaba Cloud, Tencent Cloud, Huawei Cloud) all have standard 个人信息处理协议/委托处理协议 templates covering most items above — check each box against the template, add the missing ones as a supplementary agreement.
2. GitHub (code), DuckDNS (name) and Supabase (interim encrypted sync) are **outside** the target processing scope after migration; the Supabase project must be purged per MIGRATION-PLAN.md so no DPA is needed for it long-term.
3. Keep the signed DPA + provider audit evidence with the school's PIPIA file (PIPIA-IMPLEMENTATION-DRAFT.md §16).
