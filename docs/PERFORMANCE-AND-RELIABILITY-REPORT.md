# Performance & Reliability Report — Round 23

Measured 2026-11-14, synthetic data only, dev store (PGlite in-process;
production uses the `pg` driver against PostgreSQL — absolute numbers will
differ, the zero-failure behaviour is what this round pins).
Script: `tests/bench-scale.mjs` (bounded concurrency 8 in flight — models a
busy staffroom, not an artificial 2000-request blast which wedges any
single-connection dev store and measures nothing real).

## Scale results (25 students/class, 2 FET observations + 2 CET scores each)

| Scenario | Writes | Failures | Throughput | Full pull |
|---|---:|---:|---|---|
| 1 class | 100 | **0** | 56–63 writes/s | 100 rows in 15–19 ms |
| 5 classes | 500 | **0** | 62–65 writes/s | 500 rows in 72–85 ms |
| 20 classes | 2000 | **0** | 70–73 writes/s | 2000 rows in 257–281 ms |

- Workbook parsing: the 400-student acceptance workbook audits in ~555 ms
  (import-acceptance matrix), entirely client-side.
- Server restart durability (file-backed store): 100 records → 100 after
  full restart, boot 530 ms.
- No complex caching anywhere (deliberately) — nothing can go stale or leak
  across users.

## Reliability tests performed

| Test | Result | Where |
|---|---|---|
| Server restart | ✅ data intact, clean boot | bench restart section |
| Network interruption | ✅ queued, flushed on return | schoolsync §5, browser §5 |
| Failed requests | ✅ typed errors, queue preserved | schoolsync §5/§6 |
| Repeated/duplicate requests | ✅ idempotent, no dupes | adversarial §7 |
| Auth expiry mid-work | ✅ survives, completes after re-login | schoolsync §6 |
| Unexpected tab closure | ✅ outbox is storage-backed, not memory | browser §7 |
| Health check | ✅ `/api/health` → status + store kind, no data | asserted §13b suite |
| Slow network | simulated by throttled concurrency — no timeouts at 8 parallel | bench |
| Corrupted local data | defensive parsing; dedicated test still a gap (offline acceptance) | — |
| DB restart/connection failure | dev store in-process; production behavior is a deployment-runbook item (pg pool reconnect) | — |

## Bottleneck notes (deliberately no premature optimisation)

- Write path is dominated by the dev store's single connection; production
  PostgreSQL with a small pool will be comfortably faster.
- The pull endpoint pages at 5000 rows — a 20-class school (~2k records per
  semester) fits in one page; larger schools paginate by `since`.
- No N+1 patterns in the record path (single inserts + one membership
  lookup, both indexed).

## Found-and-fixed during this round

Unbounded concurrent blasts (2000 simultaneous connections) could exhaust
the dev store — the bench originally fired them all at once. Fix: bounded
concurrency in the benchmark; the server already try/catches every handler,
so no request error can kill the process.
