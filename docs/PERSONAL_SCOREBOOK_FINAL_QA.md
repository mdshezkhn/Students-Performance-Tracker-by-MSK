# PERSONAL SCOREBOOK — FINAL QA (2026-11-15)

Scope: the scorebook as shipped at `e4beda8` (bundle `f924b90a…`, all three
generated copies byte-identical). Live-project interactions verified
read-only; behavioural paths verified by the automated suites (full battery
results in `FINAL_SECURITY_TEST_RESULTS.md`).

| # | Requirement | Evidence | Verdict |
|---|---|---|---|
| A | Application initialization | browser e2e boots the real bundle, asserts globals + 0 console errors (25/0) | PASS |
| B | Local scorebook functionality | classstore 148/0, completeness 62/0, calc 329+13/0 — all local-only paths | PASS |
| C | Cloud connection test | round5 suite exercises the ping path incl. missing-RPC and 200 paths (49/0); live ping verified 200 | PASS |
| D | Cloud channel retrieval (`sbGet`) | device-sync adoption scenarios (114/0) + live read probes (200) | PASS |
| E | Channel adoption & pull | device-sync S-scenarios (adopt, converge, token-arming); live armed rows = owner channels | PASS |
| F | Token-gated save behaviour | round5 after-SQL path (armed insert → RPC write, 49/0); live wrong-token → 400, payload intact | PASS |
| G | RPC failure handling | round5/round6 refusal paths + backoff (data-safety 36/0); refusal text in bundle (2 hits) | PASS |
| H | Missing network handling | schoolsync network-fail suite (22/0), sync-ux offline states | PASS |
| I | Invalid channel handling | live ghost-id probes: `spr_channel_write/enrol` → 400 "channel not found", ping → 200 "no-row" | PASS |
| J | Cloud unavailable behaviour | round5 + round6 model 404/401 servers; app falls back to local-only with clear messaging | PASS |
| K | Legacy DELETE handling | the 2 best-effort DELETEs (app.js:6068, 6532) are try/catch-guarded; live DELETE → 401 grant denial; suites green with denials in force | PASS |
| L | Browser console errors | browser e2e asserts zero console/page errors across the FET/CET/offline flow | PASS |
| M | Generated bundle consistency | `app/`, `deploy/app/`, `dist/app/` all `f924b90a9c8c` (this session) | PASS |

## Cloud dependency statement (final form)

The scorebook's only cloud dependency is `spr_channels` on the legacy project:
anon **SELECT** (pull/adopt — required), anon **INSERT** (fresh armed channels
— required), and the three **RPCs** (token/key-proof gated — required for
push). UPDATE/DELETE are not required by any live code path (the two DELETE
calls are best-effort cleanups that now no-op safely under grant denial).
No Supabase Auth, Realtime or Storage is used anywhere.

## The five active channels (directive §3 attention item)

Verified **metadata-only** (no payload, key, token or content read):
the 5 armed rows are exactly the owner's live device-sync set — 4 × `ds-ptr`
cloud sign-in pointers (one per scorebook account; sealed `{chan,key}` under
each account password) + 1 × `devicesync` data channel (sealed workbook
envelope), all `pushed_at` 2026-11-12, all carrying `write_token_hash`.
Functional status: writes to them are token-gated by the RPCs (wrong-token →
400, payload intact — live-verified); reads by paired devices work through
`sbGet`; retirement impact of each class is documented per-procedure in
`LEGACY_DATA_RETIREMENT_FINAL_PLAN.md` (A/B). Their payloads were never
printed, stored or logged by this audit.

## Defects found & fixed this session

None in the scorebook itself. Tooling: `scripts/verify-containment.sh` was
upgraded twice — first adding enrol/write RPC existence checks, then (after
negative testing caught two real defects) making an explicit expected row
count a **hard FAIL on mismatch** (it previously still printed CONTAINMENT
VERIFIED) and wiring the `after-D` mode into the SELECT denial check.
Negative-test evidence: `docs/qa/final-drive/verify-containment-neg{1,2}.log`.
No application code was modified in this session — the scorebook is unchanged
from the `e4beda8` checkpoint (bundle hash identical).
