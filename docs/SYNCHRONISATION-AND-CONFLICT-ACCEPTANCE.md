# Synchronisation & Conflict Acceptance — Round 15

Verified 2026-11-14. Evidence: `tests/test-server-sync.mjs` (26/0, real
backend, PGlite), `tests/test-schoolsync.mjs` (22/0, client library against
the real backend incl. offline/network/auth failure injection),
`tests/test-device-sync.js` (114/0, jsdom, legacy personal sync),
`tests/round11_browser_fet_cet.py` (18/0, two real Playwright browser
contexts against a real backend process). All data synthetic.

## Mechanism (as implemented)

- Client-generated uuid record ids; server-side monotonic `version`.
- Optimistic concurrency: writes carry `expected_version`; a mismatch returns
  **409** with BOTH `server` and `yours` payloads plus a resolve hint.
- `idempotency_key` with `unique (user_id, idem_key)` in `sync_ops`: replays
  return the original result with `replayed:true` — never a duplicate.
- Record uniqueness `(class_id, student_id, category, period, ordinal,
  semester_id)`: an insert colliding with an existing row is refused and
  surfaced as a conflict, not merged away.
- Every write: authenticated actor (`updated_by`), server timestamp, audit
  event (ids + versions only, no scores/notes in the log).
- Deliberate resolution: `POST /api/records/:id/resolve {server|incoming}`
  — duty-checked, audited, idempotent.

## Conflict taxonomy behaviour (mandate §8.2)

| Scenario | Behaviour | Evidence |
|---|---|---|
| 1. Independent records by different teachers | Both stored; both visible to the other teacher | sync §2–3, browser §3–4 |
| 2. Edits to different fields (different records) | Merge naturally — record-level, no whole-workbook overwrite | sync §3, browser §4 |
| 3. Same field, concurrent | 409 with both versions; deliberate resolve; audit | sync §4, browser §6, schoolsync §4 |
| 4. Offline edit | Durable outbox; queue survives restart | schoolsync §2/§5, browser §5/§7 |
| 5. Changed by another teacher before reconnection | Stale `expected_version` → conflict, both versions kept | schoolsync §4 |
| 6. Record deleted/archived while a device holds an older version | Archiving never deletes rows; old versions still conflict-checked by version, not existence | migrations §4 |

**No last-write-wins anywhere in the record path.** The legacy personal-sync
world is whole-envelope by design (single teacher, multiple devices) and is
being retired (LEGACY-SUPABASE-DECOMMISSION.md).

## Multi-device / network matrix (mandate §8.3)

- FET browser context A + CET context B, separate cookie jars and storage —
  browser suite §2–4 (18/0).
- Concurrent independent writes — sync suite.
- Network interruption (fetch rejected) → queued, error surfaced, nothing
  dropped — schoolsync §5, browser §5.
- Recovery → flush succeeds, duplicates suppressed by idempotency key —
  schoolsync §5 (replayed request verified twice).
- Browser refresh and full restart with pending work — browser §7
  (outbox survives; localStorage-backed by default).
- Device replacement: fresh context signs in and pulls the full record set,
  adapter rebuilds a gradable semester — browser §8.
- Duplicate requests — adversarial §7 + schoolsync §5.
- Conflicting updates — sync §4 + browser §6.

## Limitations (honest)

- Field-level merge (two edits to DIFFERENT fields of the SAME record while
  both offline) still surfaces as a version conflict requiring resolve, not
  an automatic field merge. This is deliberate (conservative for assessment
  data) but teachers will see a review step. Product decision pending.
- The conflict list is delivered per-write; there is no standing
  "unresolved conflicts" inbox yet — the browser test resolves immediately.
  An inbox view is a Round 21+ UX backlog item.
