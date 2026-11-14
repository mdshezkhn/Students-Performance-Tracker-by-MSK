# Legacy Supabase Retirement Readiness — Round 20

Live re-verification performed **2026-11-14** against the production Supabase
project (`hvjswsedoapsskedrkoj.supabase.co`, publishable key — the key is
public by design and is not a secret):

| Probe (anonymous, publishable key) | Result | Meaning |
|---|---|---|
| `GET /rest/v1/spr_channels` | **200, exactly 88 rows** | envelopes + metadata still anonymously readable |
| `POST /rpc/spr_channel_write` | **404** | owner has still NOT run the write-token SQL |
| `POST /rpc/spr_channel_enrol` | **404** | same |
| `PATCH /rest/v1/spr_channels?id=…` (direct write) | **401 denied** | anonymous writes are blocked server-side (RLS) |

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

Combined with the live 401 on direct writes, the residual exposure is:
**readable ciphertext + row metadata (names/timestamps) for 88 historical
channels; no write path at all.** Payloads are AES-GCM envelopes whose keys
never appear in URLs or the bundle.

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

LOW-to-MEDIUM and non-growing: historical ciphertext remains publicly
fetchable; no writes; no keys exposed. The exposure only shrinks as the owner
executes steps 3 (or 4) and 5–6.
