# Legacy Supabase Retirement Readiness — Round 20

> **2026-11-15 final-drive census:** the 88 rows = 83 wiped tombstones + **5
> active owner device-sync channels** (4 `ds-ptr` sign-in pointers + 1
> `devicesync` data channel, all armed with `write_token_hash`). Decision-ready
> per-procedure retirement plans (A: tombstones / B: active channels) live in
> `LEGACY_DATA_RETIREMENT_FINAL_PLAN.md`; live verification evidence in
> `SUPABASE_LIVE_VERIFICATION.md`.

> **2026-11-14 (safety-gate session): STEP 1 containment FOUND EXECUTED on the
> live project** — all three RPCs installed (ghost-id probes: 400 P0001 /
> 200 "no-row"), `write_token_hash` column present, anon UPDATE/DELETE still
> grant-denied, SELECT/INSERT preserved by design, 88 rows intact. Write
> vector CLOSED. Read exposure (88 rows) remains open pending the Option D
> retirement decision. Full details + owner checklist:
> `docs/SUPABASE-CONTAINMENT-OWNER-PACKAGE.md` (status banner at top).

Live re-verification performed **2026-11-14** against the production Supabase
project (`hvjswsedoapsskedrkoj.supabase.co`, publishable key — the key is
public by design and is not a secret). **Corrected 2026-11-14 (blocker
closure, finding F2)**: the original table below claimed "PATCH → 401 =
anonymous writes blocked server-side". That 401 was an ARTIFACT — the probe
was sent without the `Authorization` header, so PostgREST rejected the
REQUEST, not the database permission. The corrected per-operation evidence
(all probes sent WITH both `apikey` and `Authorization` headers):

| Operation (anonymous, publishable key) | Result | Evidence quality |
|---|---|---|
| `GET /rest/v1/spr_channels` (SELECT) | **200, exactly 88 rows** | live-confirmed |
| `PATCH …/spr_channels?id=<row>` with a real field, **row id that cannot exist** (zero rows affected by construction) | **401 `42501 permission denied for table spr_channels`, hint: "GRANT UPDATE … TO anon"** | live-confirmed, grant-level denial (not RLS) |
| `DELETE …/spr_channels?id=<row>` (nonexistent row, zero rows affected) | **401 `42501`, hint "GRANT DELETE … TO anon"** | live-confirmed, grant-level denial |
| `POST` (INSERT) | **grant OPEN** (`Allow: GET, HEAD, POST, OPTIONS` — PostgREST advertises only privileges the anon role actually holds) and an anon INSERT policy is documented as pre-existing (`docs/OWNER-RUNBOOK-supabase.md` §1 expected policies: SELECT + INSERT + UPDATE) | **presumed permitted — NOT live-executed** (sending a real INSERT is prohibited by the closure mandate; junk-row creation is the only impact — see residual below) |
| `POST /rpc/spr_channel_write` / `spr_channel_enrol` / `spr_channel_ping` | **404 ×3** | live-confirmed — owner has still NOT run the write-token SQL |
| Row count after all probes | **still 88** | probes verified non-mutating |

An empty-body PATCH returning `204` (observed in the independent audit) is
**not** evidence of write permission: with no columns in the SET list,
PostgREST performs no column-privilege check and no row is touched. Only the
field-bearing probe above answers the permission question, and it is denied.

RLS note: the REST layer cannot read `pg_policies` / `relrowsecurity`. The
UPDATE/DELETE denials above are GRANT-level and hold regardless of policy
state. Whether row-level security is currently enabled on the table is
**NOT VERIFIED** (read-only owner dashboard query: `select relrowsecurity
from pg_class where relname = 'spr_channels';`). The hardened containment
SQL now enforces RLS explicitly, so this unknown cannot matter after
containment.

## Containment status (the new application)

Verified in code and by regression suites (round5 49/0, round6 32/0,
data-safety 36/0, device-sync 114/0):

1. **No anonymous cloud writes**: since round 10 the app REFUSES any cloud
   write when the server cannot authenticate it (no fallback path exists —
   the legacy fallback code was deleted, and round-5's suite now asserts the
   refusal contract).
2. **No secrets in URLs**: links never embed class keys or tokens (round-10
   C3; classstore suite asserts it; legacy key-bearing links still parse).
3. **No plaintext workbook copies** in localStorage (sealed safety copies).
4. **Normal application functionality does not depend on legacy channels**:
   the school-server path is record-level sync with accounts; the local-only
   mode is fully functional offline. Legacy sync is a personal-device
   convenience that now requires the protection SQL to have been run — and
   therefore simply stays paused until the owner acts.
5. **The new backend shares nothing with Supabase** (zero dependencies).

Combined with the corrected per-operation evidence above, the residual
exposure is: **readable ciphertext + row metadata (names/timestamps) for 88
historical channels; anonymous INSERT grant open (junk-row/DoS vector only —
a junk row can never be read by anyone else without that channel's key,
cannot overwrite an existing channel (primary key), and cannot be modified
afterwards (UPDATE grant denied)); anonymous UPDATE and DELETE denied at the
grant level.** Payloads are AES-GCM envelopes whose keys never appear in URLs
or the bundle. The write-token SQL (hardened 2026-11-14: now also enables
RLS explicitly and re-verified by the round-6 real-Postgres harness, 32/0)
deliberately keeps INSERT open — new channels need it — inside token-armed
semantics: direct UPDATE/DELETE stay revoked and every write goes through the
RPCs.

## Row ownership / contents (inventory)

Rows are historical encrypted workbook envelopes (channel id, share name,
pushed_by, pushed_at, base64 sealed payload). The owner can inventory them
authenticated (Dashboard → Table Editor → spr_channels). No student data is
readable without the per-class keys, which live only in teachers' sealed
browser storage.

## Retirement readiness (owner-executed; NOTHING has been executed)

The full 9-step plan remains `docs/LEGACY-SUPABASE-DECOMMISSION.md`. Readiness
state per step:

1. Authenticated export of any rows the school must retain — scriptable via
   the dashboard; **retention decision pending school**.
2. Confirm no other application consumes these channels — the only consumer
   is this PWA (owner confirmation pending).
3. Disable anonymous SELECT on `spr_channels` (RLS) — REVERSIBLE, recommended
   immediate step; owner action.
4. Run `docs/supabase-write-token.sql` — only if legacy personal sync is
   still wanted during transition; otherwise skip to 5.
5. Delete rows after retention decision — IRREVERSIBLE; requires owner
   approval + verified export.
6. Drop legacy tables/policies — IRREVERSIBLE; after 5.
7. Remove Supabase from CSP `connect-src` in a later app release — code
   change we will make when the owner confirms steps 3–6.
8. Decommission the Supabase project — owner action.
9. Update docs + notices — this document tracks it.

## Risk if unresolved

MEDIUM and non-growing: historical ciphertext remains publicly fetchable,
and the open INSERT grant permits junk-row spam against the table (nuisance /
storage growth only — no readable or modifiable data). UPDATE/DELETE are
grant-denied. No keys exposed. The exposure only shrinks as the owner
executes steps 3 (or 4) and 5–6.

## Containment execution + verification (owner-authorised; NOT executed)

Prepared and verified in-repo; requires the owner's dashboard authority:

1. Backup (runbook §2, reversible) — `docs/OWNER-RUNBOOK-supabase.md`.
2. Run `docs/supabase-write-token.sql` (STEP 1, whole file — now hardened
   with `enable row level security`; the exact file re-verified by
   `tests/test-round6.js` → real-Postgres harness, 32/0, artifact
   `docs/qa/round6/sql-policy-test-output.txt`).
3. Paste back the CHECK result (SQL §7): must show ONLY
   `spr_channels_read (SELECT)` + `spr_channels_insert (INSERT)`.
4. Independent post-check (one command, non-mutating):
   `scripts/verify-containment.sh` — expects SELECT still 200 (share links
   keep working), field-bearing PATCH still 42501, DELETE still 42501,
   `spr_channel_ping` now responding (not 404), row count unchanged.
5. Rollback: runbook §6 (restores the old policy + grants, plus the
   truncate+insert restore from the §2 backup if any row ever looks wrong).
