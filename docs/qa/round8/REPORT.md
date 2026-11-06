# SPR round8 report — one root cause, one gate

Branch `round8` (from `round7` b3577df). Not merged, not deployed; live site
untouched. Rollback tag `pre-round8` = round7 head.

## Root cause (two sentences)

A **background** (non-interactive) device-sync pull-check could open the
"A newer copy is in the cloud" **modal decision dialog** on an unguarded path
and hold every push (`dsHoldPush`) until a human answered it; on a slow
machine the check's compare lands *after* the admin's password reset changed
the local users array, so the dialog appears mid-task, nobody answers, and the
reset's data-row push is retried-held forever while the pointer re-seal (which
needs no push path) succeeds. Fixing that one hold clears the reset push and,
with it, the other seven S8 failures (bootstrap, tombstone travel, no
resurrection, self-correction).

## What changed

- `source/app.js`: non-interactive pull-checks NEVER open a modal (passive
  `cfg.cloudAhead` notice + toast; interactive "Check for newer copy" keeps
  its dialog); in-flight push coalescing (`dsRerunAfterFlight`); retry ladder
  4 s/8 s/16 s capped 30 s with `failCount`/`failSince`; user sees nothing for
  the first 2 minutes of failures, then the sync card says "Cloud copy is
  behind. Your data on this device is safe."; a push want that survives a
  reload re-arms its timer at boot; `SPR_DS_TRACE` push-decision trace (off by
  default, `window.__SPR_DS_TRACE`, test harness sets it from the env var).
- `tests/test-device-sync.js`: S12 (R1-R5 against the mock, incl. a
  deterministic replay of the S8 stuck-dialog race via a stretched row read),
  mock knobs (`__SB_SLOW_GET/__SB_SLOW_SAVE/__SB_FAIL_SAVE`), every
  crypto/network wait is a condition wait with a 60 s ceiling; round5/round6
  fixed sleeps converted likewise.

## Rule table

| rule | failing test (round7 build) | fixed |
|------|------------------------------|-------|
| R1 held/dialog | `R1: background pull-check opened NO decision dialog` + `R1(reset): re-keyed account reached the data row` | yes |
| R1 signed-out | (passed on round7; kept as guard) `R1(signed-out)` | yes |
| R1 in-flight | (passed on round7; kept as guard) `R1(in-flight)` | yes |
| R2 follow-up push | (passed on round7; kept as guard) `R2: the follow-up push carried the re-keyed account` | yes |
| R3 merge/tombstone | (passed on round7; kept as guard) `R3: tombstone wins` / `no resurrection` / `self-corrected` | yes |
| R4 ladder/silence | `R4: retry ladder` (measured 4.1, 30.4, 30.6 s on round7), `R4: silent while the failure is younger than 2 minutes`, `R4: after 2 minutes …` | yes |
| R5 reset timeliness | `R5: reset landed in 66463 ms`, `R5: fresh browser bootstraps …` | yes |

R5 number (fixed build): the reset's data-row push is prompt (0 ms debounce);
a fresh browser can bootstrap as soon as it lands — measured **~7.0 s** worst
case in the adversarial S12 replay (a pull-check held the row for its full
stretched read; the retry ceiling while held is one 4 s cycle), and ~1-2 s in
the plain S8 flow.

## Before / after (test-device-sync.js)

- Before, serial, this 2-core laptop: **19 of 20 passed** (1 unrelated flake:
  a 20 s login wait lost to PBKDF2 under a load spike — now a 60 s condition
  wait). The reviewer's S8 signature did not fire serially here (0/20).
- Before, deterministic (S12 R1a on the round7 build) + natural trace: the
  stuck background dialog observed live inside S8 (see diagnosis.md).
- Before under 4-parallel load (round7 build): see `before.txt` phase 2.
- After, gate (a): **30 of 30 passed**, 0 SKIP (`after.txt`).
- After, gate (b) with a parallel suite on the same 2 CPUs: **10 of 10** (`after-parallel.txt`).

## Gates

- (c) `npm ci --include=dev && npm test` ×3: all 16 suites green three times —
  last lines in `npmtest.txt`.
- (d) `app/index.html`, `app/sw.js`, `index.html` byte-identical to
  `python source/build2.py` output; live service worker hash unchanged (not
  deployed).
- (e) Real Chromium (Edge, Playwright), Supabase mocked at the network layer
  (no production cloud): sign-up → class → add teacher → pair (one-time
  password captured) → teacher second-browser cloud-lookup sign-in sees only
  their class → reset → fresh browser signs in with the new password → delete
  → third browser rejected. 0 page errors (`chromium-e2e.py` output below).

## Not done / not tested

Real Supabase (row policies, RPC write tokens) — the mock returns 404 for
RPCs, so the direct-write fallback is what the suite exercises; real iOS
browsers; real teachers. Device sync remains opt-in as before; no grading
(`calc.js`) or report-card layout changes.
