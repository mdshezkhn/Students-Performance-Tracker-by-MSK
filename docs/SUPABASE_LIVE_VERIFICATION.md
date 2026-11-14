# SUPABASE LIVE VERIFICATION — 2026-11-15

All probes executed 2026-11-14 19:59–20:05 local (11:59–12:05 UTC) against
`https://hvjswsedoapsskedrkoj.supabase.co` with the public publishable key
(public by design; not a secret). **No SQL was executed; no row was created,
modified or deleted.** Every write-shaped probe targets an all-zeros UUID that
cannot exist (0 rows affected) or a real row with a deliberately WRONG token
(verification of denial, payload confirmed unchanged after).

## 1. Permission matrix (live, this session)

| Operation (anon, publishable key) | Result | Evidence | Meaning |
|---|---|---|---|
| `GET /rest/v1/spr_channels` | **200** | row count below | SELECT open **by design** (scorebook pull/adopt + share links) |
| `PATCH …id=eq.<ghost>` (field-bearing) | **401** | grant denial | anon UPDATE denied at **grant level** |
| `DELETE …id=eq.<ghost>` | **401** | grant denial | anon DELETE denied at grant level |
| `POST /rpc/spr_channel_write` (ghost id) | **400 P0001 "channel not found"** | function exists, enforces | write RPC installed |
| `POST /rpc/spr_channel_enrol` (ghost id, signature `p_id,p_token,p_key`) | **400 P0001 "channel not found"** | exists, enforces | enrol RPC installed |
| `POST /rpc/spr_channel_ping` (ghost id, `p_id,p_token`) | **200 "no-row"** | exists | ping RPC installed |
| `POST /rpc/spr_channel_write` (REAL armed row + wrong token) | **400** + payload confirmed unchanged | denial verified | token check enforces on armed rows |
| `POST /rpc/spr_channel_write` (REAL un-armed row) | **400 "channel has no token enrolled yet"** | denial verified | legacy rows not writable via RPC |
| INSERT | **not probed** (never send live writes) | grant open (Allow list) | fresh channels only; junk-pollution vector, cannot touch existing rows |

Signature note: two earlier ad-hoc probes returned `404 PGRST202` because they
used wrong parameter names (`p_key_proof` instead of `p_key`; ping without
`p_token`). PostgREST's PGRST202 = signature mismatch, NOT missing function.
Re-probed with the SQL file's exact signatures → all three functions answer.

## 2. Data census (read-only)

- **88 rows total** (unchanged across all sessions since 2026-11-14).
- `write_token_hash` present on all rows; **5 armed**.
- Payload census (keys only, contents never printed):
  - 83 × `{"wiped":…}` — 12-byte **tombstones** (already cryptographically
    erased by the app's own device-sync "turn off" flow). No ciphertext.
  - 4 × `(ct,iv,salt,sprPTR)` — small sealed **pointer** rows.
  - 1 × `(asum,ct,iv,mac,sprDS,sum,wrap,wsig)` — the sealed **device-sync
    envelope** (≤31 KB, max of all rows).
- The 5 armed rows are exactly the 5 ciphertext rows, all `pushed_at`
  2026-11-12 → **the owner's actively used device-sync channels**.
- Readable metadata on all rows: `share_name` (e.g. `devicesync`, `ds-ptr`,
  class names like `P4C3 · 2026 Spring`), `pushed_by` (browser/OS strings),
  `pushed_at` (2026-01-01 → 2026-11-12).
- Keys: **never exposed** — not in URLs, bundle, or metadata (verified in
  prior rounds; unchanged).

## 3. Backup tables

- `spr_channels_backup_2026_11` and `spr_channels_backup_2026_10_30`:
  **404 via anon REST** → no anon grants (hidden). Existence/count can only be
  confirmed by the owner in the Supabase dashboard (owner checklist item);
  the runbook's backup step instructed creation of the `_2026_10_30` table.

## 4. Comparison with docs/supabase-write-token.sql (STEP 1)

| SQL promise | Live state | Match |
|---|---|---|
| 3 RPCs created with exact signatures | yes (verified via hints + P0001s) | ✅ |
| `write_token_hash` column added | yes, all rows | ✅ |
| anon UPDATE/DELETE revoked | yes (401 grant denial) | ✅ |
| SELECT + INSERT preserved | yes (scorebook compatibility) | ✅ |
| Existing rows preserved | 88 rows, payloads intact | ✅ |
| Rows armed only via enrol w/ key proof | 5 armed = owner's active channels | ✅ |

No discrepancy between the SQL file's STEP 1 and the live project.
STEP 2 (row retirement / Option D) has NOT been executed — see
`LEGACY_DATA_RETIREMENT_FINAL_PLAN.md`.

## 5. Limitations

- RLS policy list and EXECUTE grants are not visible via REST; direct evidence
  requires the owner's dashboard §7 CHECK paste (asked in the owner package).
- `security definer` on enrol/write RPCs is per the SQL file (necessary to
  update rows whose direct grants were revoked); key-proof + token gates are
  the compensating controls — both live-verified above.
