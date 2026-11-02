# Round 9 report — Live board retired, Users sheet on the owner's model, public-password account removed

Branch `round9` (rollback tag `pre-round9` = round8 tip). Not merged to main, not deployed.

| # | Item | Failing test written first | Fixed | Proof |
|---|---|---|---|---|
| 1 | Retire Live board (nav, `#/live` redirect, delete `source/liveboard.js` + build hook + scoped CSS; keep `spr-last-save-at`; Dashboard header "Saved X ago" + optional "Cloud copy: \<time\>"; never the word LIVE; hero/icons/avatars/cups NOT moved) | `tests/test-live-retire.js` (13 checks, was 11 FAIL) | yes | suite green; `docs/qa/round9/dashboard-saved-1280.png` |
| 2 | Users sheet = owner's model (one row per person+partner, derived pairing, By-class view, CSV BOM round trip, import with pickers/errors/no-guess, unassign re-keys) | `tests/test-users-sheet.js` (49 checks) + `tests/test-users-roundtrip.js` (6) | yes | suites green; `tests/fixtures/roster-owner.csv`; `docs/qa/round9/users-sheet-1280.png`, `by-class-1280.png`, `import-preview-error-1280.png` |
| 3 | Remove built-in public-password account (empty device stays empty; same as wrong password; no literal near login compare) | `tests/test-recovery-gone.js` (9 checks, was 5 FAIL) | yes | suite green; `docs/KNOWN-ISSUES.md` |
| 4 | Reconcile main + landing facts/weight | `qa/landing_weight.py` (FCP, bytes, video-gating) | yes | numbers below |

## Bundle size (app/index.html)

- main `5f99a8a`: **1,918,078 B** → round9 final: **1,909,330 B** (net −8,748).
- Live board removal itself: −29,975 B (30,297 B `liveboard.js`); Users-sheet code adds the rest.

## Merge conflicts (origin/main `5f99a8a` into round9)

- `.gitignore` — union of both ignore lists (`.pw/`, `qa_root/`, `qa-shots/`).
- `app/index.html`, `app/sw.js`, `index.html` — resolved by re-running `python source/build2.py --force` (main's committed build had `unsafe-inline`; round8's build hashes CSP) and copying `deploy/` up.
- `source/app.js` — auto-merged; verified both sides present (Live board + MSK hooks, later removed by tasks 1/3).

## Landing (owner-approved look untouched; facts only)

- Claims true: 9 components ✓, Written weight 0.2 ✓, notice link ✓, "Provided as is" ✓, no "All rights reserved" ✓.
- Fast 3G, cache off, 1280px: **FCP 1.39 s**, index.html **34,446 B**, total transferred **1,095,491 B** (14 requests, **0 video requests** — video never blocks text).
- `prefers-reduced-motion` and `Save-Data` both stop the autoplay video (poster fallback) — Save-Data handling added to the video watchdog in `source/landing.template.html`.
- `/app/` loads no video and no GSAP (0 refs).

## Suite last lines

<!-- SUITE-LINES -->

## Not tested here

Real Supabase (no production project touched), real iOS Safari, real teachers, real DuckDNS network path. Windows has no `taskset`; the 30× device-sync runs used `ProcessorAffinity` pinned to 2 cores instead.

## Incident (disclosed)

An accidental `git checkout -- source/app.js` discarded uncommitted task-2/3 app-side work mid-round; tasks 2/3 were re-implemented from their failing tests (commit `40ab6a8` marks the boundary). All current suites run against the rebuilt files.
