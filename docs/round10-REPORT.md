# Round 10 report — MSK as the protected owner with a signed "pull the plug"

Branch `round10` (rollback tag `pre-round10` = round9 tip `a49a233`). Not merged to main, not deployed.

| # | Item | Failing test written first | Fixed | Proof |
|---|---|---|---|---|
| 0 | Reviewer patch: Users Back button + per-pair import | `tests/test-users-import-ux.js` (13 checks) | yes | suite green; build `1f6a33a87c` byte-verified |
| 1 | Owner account protected (no disable/delete/rename/demote/reset/re-pair by anyone else; forged `data-action` refused; import row skipped; sync merge keeps owner) | `tests/test-owner-master.js` P (UI absent + forged clicks + CSV + merge) | yes | suite green |
| 2 | Exactly one owner; second owner by any route fails | P + `addUser` guard ('Owner role cannot be created') + `ensureOwnerAuth` demotes extras | yes | suite green |
| 3 | Owner opens every class incl. later classes, removed teachers, reset passwords (key escrow + heal) | E section (13-class fixture, delete+reset, new class, wrap-loss heal) | yes | suite green |
| 4 | Owner recovery kit (ECDSA P-256, sealed under master pw; first-run download gate; fresh-browser restore; wrong pw writes nothing) | P2 + K sections | yes | suite green |
| 5 | Signed control record: valid sig accepted; tampered/wrong-key/replay/future rejected; fetch failure keeps mode; never-accepted = normal; readonly/locked effects; local data byte-identical; lift restores | C1–C5 sections | yes | suite green |
| 6 | Notice v2 EN+ZH owner disclosure + school-agreement checkbox + gentle reminder | `tests/test-notices.js` D (v2, EN owner sentence, ZH owner sentence) | yes | suite green |
| 7 | Users tab / CSV interplay (Owner row, export lists Owner, import skips with note, second-owner row = error) | P3/P6/P7 | yes | suite green |
| 8 | Real Chromium two-browser lock + banners + 390px | `qa/round10_gate.py` | yes | shots in `docs/qa/round10/` |

## What was built

- Role `owner` (username `msk` preferred). First-run creates it; pre-round10
  devices auto-promote it at boot (`ensureOwnerAuth`); a sync merge can never
  remove, downgrade or tombstone it; every mutating handler re-checks
  (`ownerGuard`); `rotateUserPassword` has a belt-and-suspenders refusal.
- Key escrow: every class key is wrapped under a 32-byte escrow key that lives
  (a) sealed in the owner kit under the **master password** and (b) in the
  owner's own keyring. Missing wraps heal at owner sign-in. `docs/OWNER-CONTROLS.md`.
- `control.json`: ECDSA-P-256-signed `{version, counter, issued_at, mode,
  message, sig}`; devices fetch on boot + every 10 min; signature, counter
  (strictly increasing, replay-proof) and 24 h future-window verified; failure
  NEVER locks anyone. readonly = one choke-point blocks mutations, pushes stop,
  viewing/printing/backups stay; locked = only the owner can sign in.
- Owner kit download is forced at first run (Continue stays disabled until the
  real download event); restore path on the sign-in card; Manage card for
  re-download + Owner controls card (issue + history + status).

## Honest limits (in the UI and docs)

Cannot reach devices that never go online; cannot delete/change local data;
cannot stop already-exported data; the record file is public (no names in the
message); wrong clocks handled by counter not time; server-side write-token
revocation out of scope (KNOWN-ISSUES); ZH notice paragraph needs a native
read before go-live (REVIEW-NOTES).

## Suite last lines

Full chain (`npm test`, head `7fcf39f`, 2026-11-08, this machine — log `/tmp/chain_r10fix4.log`):

```
completeness: 62 passed, 0 failed
calc-regression: 329 passed, 0 failed   (grading untouched)
excel-import: 24 passed, 0 failed
classstore: 145 passed, 0 failed
HELP-SECURITY: 38 ok, 0 FAIL
DATA-SAFETY: 36 ok, 0 FAIL
NOTICES: 28 ok, 0 FAIL
ROUND5: 45 ok, 0 FAIL
ROUND6: 32 ok, 0 FAIL
ROUND7: 38 ok, 0 FAIL
LOAD: 6 ok, 0 FAIL
SIMPLE-UI PASSED (44)
ALL CLASS-MODE CHECKS PASSED
ALL DEVICE-SYNC CHECKS PASSED
ESCAPE-CHECK PASSED (20)
PAIR-OPEN PASSED (9)
LIVE-RETIRE: 13 ok, 0 FAIL
RECOVERY-GONE: 9 ok, 0 FAIL
USERS-SHEET: 51 ok, 0 FAIL
ROUND-TRIP: 6 ok, 0 FAIL
USERS-IMPORT-UX: 13 ok, 0 FAIL
OWNER-MASTER: 80 ok, 0 FAIL (217s)
```

## Endurance + gate (this machine, 2 cores, sequential)

- Owner suite ×10 consecutive: **10 × "80 ok, 0 FAIL"** (marathon attempt 2, 2026-11-08, `/tmp/marathon10b.log`).
- Device-sync ×30 consecutive: **30 × exit=0** (same marathon; Windows has no `taskset`, runs were sequential).
- Real-Chromium gate `qa/round10_gate.py`: **16 ok, 0 FAIL** — owner first-run (forced kit download), Users sheet (protected Owner row), Owner controls card, two-browser readonly banner, two-browser locked sign-in, normal lift, 390 px owner row; 0 page errors; screenshots + signed records in `docs/qa/round10/`.
- Build byte-identity: `source/build2.py` output committed unchanged at every push (`spr-app-shell-7b29c58ad5` on the final head); app artifacts identical from `e3fe53e` through `7fcf39f` (test-only commits after `e3fe53e`), so the marathon endurance evidence covers the shipped build bit-for-bit.

## Fresh-clone gate (origin/round10)

<!-- FC-LINES: filled when the fresh-clone chain completes -->

## Real bugs found by the endurance gate (fixed, disclosed)

1. Cloud adoption re-keyed the channel to the signing teacher (every "find the admin" lookup matched `role === 'admin'`, which no longer matches the promoted owner) — 8 sites + classstore patched to accept owner.
2. Owner merge rule could strip a fresher cloud `login` from a stale pre-round10 device (owner lockout there) — replaced with field-level merge (role/keyring protected, login newest-wins).
3. `classesFor` hid all classes from the owner on the chooser path.
4. Owner-kit download could crash closed windows (`URL.createObjectURL` teardown race) — hardened.

Harness migrations (test-only, 6 suites: help-security, notices, device-sync, round5/6/7 + class-mode/pair-open checks): the round10 forced owner-kit first-run needs a `URL.createObjectURL` stub jsdom does not ship; two stale round9 expectations (v1 notice line; "disabled 3.5 s later" timing) rewritten; the zero-network privacy checks now exclude same-origin `control.json` polls (spec-mandated).

## Not tested here

Real Supabase (fake REST only), real iOS Safari, real teachers, devices that
stay offline, real DuckDNS network path. Windows has no `taskset`; the
device-sync runs used sequential execution instead.

## Migration note (disclosed)

Existing devices hold the owner account as a plain `admin` (pre-round10 shape).
At boot `ensureOwnerAuth` promotes the account named `msk` (else the sole
admin) to `owner` and the first-run recovery dialog now requires the owner kit.
The owner should set a master password and download the kit from
Manage & setup if the first-run step was completed on an older build.
