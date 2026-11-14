# LEGACY DATA RETIREMENT — FINAL PLAN (Option D, decision-ready)

Status: **PREPARED — NOT EXECUTED.** No SQL below has been run. Executing any
destructive step requires explicit owner authorization (checkpoint §4).

## 1. What is actually exposed today (census 2026-11-15, read-only)

| Row class | Count | Contents readable anonymously | Real exposure |
|---|---|---|---|
| Tombstones `{"wiped":…}` | **83** | 12-byte marker + metadata | **none** (payloads already erased by the app's own "turn off" flow) |
| Sealed pointer rows (`sprPTR`) | 4 | ciphertext ≤1 KB + metadata | offline-bruteforce-only; keys never exposed |
| Sealed device-sync envelope (`sprDS`) | 1 | ciphertext ≤31 KB + metadata | offline-bruteforce-only; keys never exposed |
| Metadata (all 88 rows) | — | `share_name` (channel labels incl. one class name), `pushed_by` (browser/OS strings), `pushed_at` (2026-01→2026-11-12) | minor information disclosure (device usage patterns, one class label) |

**Correction to earlier risk language**: the "88 readable envelopes" framing
overstated it — 83 rows contain no ciphertext at all. The true exposure is
5 small sealed rows + 88 rows of lightweight metadata.

## 2. Dependency check (verified this session)

- The **5 ciphertext rows are the owner's ACTIVE device-sync channels**
  (all `pushed_at` 2026-11-12; exactly these 5 carry `write_token_hash`).
  Deleting them **breaks nothing permanently** but orphans the owner's
  current paired devices: on next pull the app sees "channel not found" and
  the device-sync UI reports the channel is gone; local data stays intact and
  device sync can be re-created fresh. (Behavior class covered by suites:
  device-sync R3 "no resurrection", round-5 refusal paths, sync-ux failure
  states.)
- The **83 tombstones are depended on by nothing**: they exist only so old
  paired devices learn sync was turned off. After deletion, an old device
  pulling its channel gets "not found" instead of `wiped` — same UI outcome
  (sync off), no data risk.
- **School platform**: zero dependency (see `SCHOOL_PLATFORM_ISOLATION_AUDIT.md`).
- **External clients**: none known (the project is single-owner; the key was
  never shared beyond the owner's devices — verified in round-9/10 history).
- **Retention/legal**: personal scorebook data, not student records collected
  by the school platform; no school PIPL retention obligation identified for
  tombstones. The one `sprDS` envelope may contain the owner's own class
  marks — owner judgement (it is the owner's own data).

## 3. Pre-retirement backup (owner, dashboard SQL editor — 2 min)

```sql
-- 3a. confirm the existing backup still covers everything
select count(*) from public.spr_channels_backup_2026_10_30;  -- expect 88 (if the table exists; if not, create:)
create table public.spr_channels_backup_2026_11_15 as select * from public.spr_channels;
select count(*) from public.spr_channels_backup_2026_11_15;  -- MUST print 88
-- 3b. restore-capability proof: the backup table can be counted AND
--     re-cloned back (rehearsal only, do NOT run the insert):
--     insert into public.spr_channels select * from public.spr_channels_backup_2026_11_15;
```

Keep the dashboard result (screenshot) as the backup evidence.

## 4. Owner authorization checkpoint (decision required)

Three choices, in the order they can be safely applied:

- **D1 = Procedure A only** — retire the 83 tombstones. Recommended first.
- **D2 = A + B** — also retire the 5 active channels (scorebook cloud sync ends).
- **D3 — defer** everything. Exposure unchanged (5 sealed rows + metadata;
  writes already token-gated). Acceptable while you decide.

Both procedures below are **self-contained**: each has its own dependencies,
backup, approval gate, SQL, pre/post checks, rollback and expected app
behaviour. Nothing has been executed.

---

## PROCEDURE A — retire the 83 tombstones (D1)

| Item | Detail |
|---|---|
| Scope | The 83 rows whose payload is exactly `{"wiped":true}` (12 bytes, zero ciphertext). |
| Dependencies | NONE. Verified: tombstones are read by nothing. An old paired device pulling its wiped channel gets "channel not found" instead of `wiped` — identical UI outcome (sync off), no data path exists. School platform: zero references. |
| Backup | §3 backup table must exist and count 88 FIRST (screenshot). |
| Owner approval | Required — say "run Procedure A". Dashboard SQL editor only. |
| Pre-checks (SQL) | `select count(*) from public.spr_channels where payload->>'wiped' is not null;` — must print 83. |
| SQL (exact) | `delete from public.spr_channels where payload->>'wiped' is not null;` — expect `DELETE 83`. |
| Post-checks | `select count(*) from public.spr_channels;` → **5**. Then `bash scripts/verify-containment.sh 5` → `CONTAINMENT VERIFIED`. |
| Rollback | `insert into public.spr_channels (id,payload,previous,pushed_by,pushed_at,share_name,write_token_hash) select id,payload,previous,pushed_by,pushed_at,share_name,write_token_hash from public.spr_channels_backup_2026_11_15 where payload->>'wiped' is not null;` → count back to 88. |
| Expected app behaviour | Nothing observable. Active channels untouched; sync keeps working; old offline devices see the same "sync off" states they already handle (covered by device-sync suite R3). |
| Risk if botched | Only if the WHERE clause is altered. As written, the predicate matches exactly the 83 wiped rows (verified by the pre-check count). |

## PROCEDURE B — retire the 5 ACTIVE device-sync channels (D2, after A)

What the 5 rows are (from source `source/app.js`, read-only):

- 4 × `share_name='ds-ptr'` — **cloud sign-in pointers**: one per scorebook
  account. Each holds `{chan, key}` sealed under that account's password
  (`ptrSeal`). Purpose: a NEW device signing in with username+password finds
  the account's sync channel (`dsChan(username)` → `sbGet` → `ptrOpen`,
  app.js ~6380). If the row is absent, cloud sign-in for that account returns
  "no cloud copy" and falls back to local login — **recovery-by-cloud-sign-in
  for that account stops**.
- 1 × `share_name='devicesync'` — the live **data channel**: the sealed
  workbook envelope paired devices push/pull. If absent, paired devices'
  next pull reports the channel is gone; **local data on each device stays
  intact**; "Turn on device sync" provisions a fresh channel.

| Item | Detail |
|---|---|
| Dependencies | ① Owner's local scorebook data must exist on every device you intend to keep using (check Manage → Download backup on EACH device first — this is your only remaining copy after B). ② Decide you no longer need cross-device cloud sync, or accept re-pairing manually afterwards. |
| Backup | §3 backup table (mandatory) + at least one exported local backup file per device (Manage → Download backup). |
| Owner approval | Required — say "run Procedure B" (A may already have run). |
| Pre-checks (SQL) | `select count(*) from public.spr_channels;` → **5** (after A). `select id, share_name from public.spr_channels order by share_name;` → expect 4 × `ds-ptr`, 1 × `devicesync`. |
| SQL (exact) | `delete from public.spr_channels where payload->>'wiped' is null;` — expect `DELETE 5`. |
| Post-checks | `select count(*) from public.spr_channels;` → **0**. Then `bash scripts/verify-containment.sh 0` → `CONTAINMENT VERIFIED`. Optional final hardening (only if you will never use scorebook cloud again): see §8. |
| Rollback | Same INSERT as A but `where payload->>'wiped' is null` → restores exactly the 5 rows → count 5 (or 88 if A also rolled back). Paired devices pull → channel + data return. Caveat: if the app provisioned a NEW channel after B, its row id may collide on restore — delete the new row first (ids are unique). |
| Expected app behaviour | Paired devices: sync card shows the channel is unavailable; local scorebook fully usable; new cloud sign-in for those accounts says no cloud copy. New devices: must pair fresh (or via exported backup file). |
| Risk | Losing the last copy of scorebook data IF some device never had a local backup — mitigated by dependency ①. |

## 5. (superseded — see Procedures A/B above)

## 6. Post-retirement verification (both procedures)

`bash scripts/verify-containment.sh <expected-count>` — exit 0 + `CONTAINMENT
VERIFIED` is the gate. The script's count is now a hard assertion; `after-D`
mode additionally proves anonymous SELECT is closed if you also apply the §8
hardening.

## 7. Rollback — now inside each procedure (A and B keep their own)

## 8. Residual state + optional hardening after full D2

- `spr_channels` empty; anon SELECT/INSERT grants remain (harmless on an
  empty table); RPCs remain (harmless); backup tables keep the 88 rows until
  separately dropped — retain at least one indefinitely (owner judgement; no
  identified legal retention duty for your own scorebook data).
- Optional final hardening (ONLY after D2 + backup retention decision):
  `revoke select, insert on public.spr_channels from anon;` — permanently
  disables scorebook cloud channels until re-granted
  (`grant select, insert on public.spr_channels to anon;` reverses it).
  After applying, verify with `bash scripts/verify-containment.sh 0 after-D`.
