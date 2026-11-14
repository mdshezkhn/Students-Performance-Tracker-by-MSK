# Round 11 Verification — Rounds 12–30 Programme Opening Audit

Performed 2026-11-14 at programme start (commit `1217fca`), BEFORE any
round-12+ changes, by re-running the suites against the rebuilt bundle.
Classification per the mandate: **Reproduced** (test re-executed, passed) ·
**Source-verified** (inspection only) · **Not reproduced** · **Failed** ·
**N/A**.

## Claims audit

| Round-11 claim | Classification | Evidence |
|---|---|---|
| SPR adapter, calc-certified round trip | **Reproduced** | spradapter 38/0 re-run |
| FET/CET browser workflow | **Reproduced** | browser suite 18/0 re-run on Edge |
| Adversarial suite | **Reproduced (with findings)** | first re-run 34/2 — the 2 failures were the suite's missing-env case, fixed with a fail-fast guard; now 45/0 |
| Offline persistence / restart survival | **Reproduced** | browser §5/§7 |
| Device replacement + export/restore | **Reproduced** | browser §8/§9 |
| Workbook import acceptance (local-only) | **Reproduced** | import-acceptance 18/0 with fetch+XHR throwing |
| Audit-log DB trigger immutability | **Reproduced** | adversarial §12 |
| SQL parameterisation | **Source-verified + swept** | zero concatenated SQL (grep) + injection-shaped probes |
| CSP same-origin API support | **Reproduced** | browser suite (school-server calls succeed from the app) |
| Dependency audit 0 | **Reproduced** | npm audit re-run |
| PIPIA documentation | **Source-verified** | drafts reviewed; correctly marked as drafts |
| Legacy Supabase retirement plan | **Reproduced + updated** | live re-probe 2026-11-14: 88 rows readable, RPCs 404, direct write now 401 (improvement) |
| device-sync green on final bundle | **Reproduced** | the in-flight strict re-run completed: ALL PASS, EXIT=0, UX=0 |
| Bundle = source | **Reproduced** | rebuilt and compared before the sweep |
| calc 329 regression | **Reproduced** | 329/0 |

## Discrepancies found during verification (all resolved in rounds 12–14)

1. The final device-sync run at round-11 close had initially been reported
   from a stale build; the strict re-run on `2902c83200` was still in flight
   when the round closed. It completed green — recorded here for honesty.
2. The adversarial suite silently under-tested session expiry without its
   env — now fail-fast (exit 2 with instructions).
3. `must_change_pw` existed but was NOT enforced (found in round 13 opening
   review, fixed + tested).
4. Deactivate had no counterpart activate (found round 11, fixed).

Nothing in the Round-11 report was found to be false; two controls were
weaker than reported (item 3) and were strengthened with tests.
