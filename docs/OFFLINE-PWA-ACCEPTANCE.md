# Offline-First PWA Acceptance — Round 16

Verified 2026-11-14. Evidence: `tests/round11_browser_fet_cet.py` §5/§7/§8
(real browsers + real backend), `tests/test-schoolsync.mjs` (durability),
`tests/test-data-safety.js` (36/0, storage hygiene), `tests/test-sync-ux.js`
(all pass, plain-language states), `tests/test-device-sync.js` (114/0,
jsdom offline worlds). All data synthetic.

## Local persistence — verified

- Pending writes persist in a durable outbox; **localStorage-backed by
  default** since round 11 §5 (previously a no-op stub — found by the
  browser restart test and fixed).
- Queue entries are removed ONLY on successful acknowledgement
  (schoolsync §2: queue drains on success; §5: network failure keeps the
  entry).
- Duplicate sync attempts cannot create duplicates (idempotency keys,
  adversarial §7).
- Browser restart with pending work → outbox survives, flushes on reconnect
  (browser §7 — a REAL page reload, not a mock).
- Sensitive storage: workbook safety copies are **sealed** (encrypted with
  the data key — data-safety suite); session cookie HttpOnly; CSRF token is
  not security-critical to hide but is never logged.
- Service worker caches the app shell (`spr-app-shell-<hash>`) and static
  assets; authenticated API responses are never cached (no cache handler for
  /api/*). The browser suite unregisters SWs to avoid stale-shell masking in
  tests; production behaviour is shell-only caching.

## States surfaced to the teacher (plain language, round5-enforced)

- Online / offline indicator.
- "Your changes are saved on this device" (pending work exists, not yet sent).
- Waiting for connection; changes being sent; changes synchronised.
- Failure states name the recovery step (Manage → Device sync) — verified by
  test-sync-ux.js, including the "the data on this device is safe" assurance
  after 2 minutes of cloud failure.
- A success message is never shown while data is only local (sync-ux suite).

## Recovery tests (mandate §9.3)

| Test | Result | Evidence |
|---|---|---|
| Storage persistence across reload | ✅ | browser §7 |
| Full browser restart | ✅ | browser §7 (new context navigation) |
| Offline editing + reconnect | ✅ | browser §5, schoolsync §5 |
| Failed server requests stay queued | ✅ | schoolsync §5 |
| Auth expiry during offline work | ✅ auth-typed error, work kept, completes after re-login | schoolsync §6 |
| Account deactivation with pending changes | ✅ forbidden after re-auth; pending work retained client-side | schoolsync §7 |
| Device replacement | ✅ fresh sign-in pulls everything | browser §8 |
| Export and recovery | ✅ admin export → adapter rebuilds a gradable semester | browser §9 |
| Storage corruption | Partially covered: malformed outbox entries are ignored (defensive parsing in schoolsync.js outbox()); no dedicated corruption test yet — **listed as a gap** |
| Storage quota | Not tested (synthetic data is small) — documented limitation |

## Account switching / device sharing

One signed-in user per origin at a time (cookie session). Switching accounts
logs out (session revoked server-side, outbox persists per storage, not per
account — see limitation). Logout does NOT clear unsynchronised work: the
outbox survives; on next sign-in as the SAME user it flushes. Work queued by
a different user is never flushed under another identity (each queued action
carries its creation context; the flush requires a session whose duty passes
the server check — mismatches surface as forbidden errors, not silent sends).

**Limitation:** the outbox is not partitioned per account. If teacher A logs
out with pending work and teacher B logs in on the same profile, B's flush
attempt of A's item gets a server 403 (duty/role) and the item stays queued.
Correct-but-rude; a per-account outbox partition is on the UX backlog
(Round 21 follow-up), documented here rather than hidden.

## Security review of the sync UI

`test-sync-ux.js` verifies error surfaces never leak URLs with secrets,
never show raw error dumps, and always offer a next step. `test-data-safety.js`
verifies no plaintext workbook in localStorage.
