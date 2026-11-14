# OVERNIGHT SPR EXECUTION REPORT — 2026-11-15

## Starting repository state (verified, not assumed)

- Branch `feature/p2-secure-school` at `94cebe2`, clean tree, local = remote; production `site` branch untouched (`0b5b5d19`).
- Recovery bundle `e4beda8-final-drive-2026-11-15T0000.bundle` (sha256 `d9485032…be6f`) clone-verified — pre-existing, preserved.
- **Environment fact that shaped tonight's design** (from the 11 Nov pre-demo investigation, `workspace/demo-2026-11-12/BUG-LIST.md` S2): `*.supabase.co` is TLS-blocked on China school networks. Anything Monday-testable must work **locally/offline**; cloud sync is a home-only demo.
- The school testing URL in the brief (`school-secure.englishwithmo.pages.dev/teacher#/classes`) hosts the **ReadAloud School teacher dashboard**, a different app. SPR therefore got its own isolated deployment (below).

## What was built tonight

### 1. Demo classes mode (the Monday deliverable)
- **`source/sprdemo.js`** — deterministic synthetic dataset: 2 classes (P4-A Demo, P4-B Demo; 22 + 24 dummy students "Demo Student 01…24"), Sep+Oct data, FET observations (LO1/LO2 per skill per month), CET spelling (×20)/daily (×10) weekly scores, midterm/oral/written tests, realistic bands (strong→developing), deliberate missingness (blank weeks, unassessed components, an in-progress October), one **pending CET observation proposal** for the FET to approve. Fixed-seed PRNG → byte-identical on every install. Validated against the real calculation engine: 0 cells quarantined by `sanitizeSemester`, final + provisional grades produced (unit suite 16/0).
- **App wiring** (`source/app.js`, +~140 lines): one-click install from the welcome screen and the sign-in card; demo accounts (`fet-demo`, `cet-demo`, plus `owner-demo` only on devices with no accounts) created through the app's **real machinery** — classstore sealing, per-teacher keyrings under the tester-chosen password (min 8), v2 data-key wraps for every demo account (the fresh-browser first-sign-in trap was found and fixed), mode snapshot; signed straight in as the FET; persistent **DEMO banner** with one-click removal; reset restores the previous mode and removes only demo artifacts.
- Demo seeding is **local-only and silent**: the e2e proves ZERO cloud requests during the whole flow.

### 2. Deployment (isolated, authorized workflow reused)
- **https://spr-school-demo.pages.dev** — new Cloudflare Pages project in the existing account (same wrangler + token workflow already used for `englishwithmo`; no production site, DNS or Supabase touched). Static 3-file deploy: app bundle + sw.js + notice.html.
- Verified: served bytes **identical** to the tested local build (`cmp`), sw.js 200, pretty-URL redirect for notice only. Live browser pass reached install→class→roster before the late-night China→CF network degraded (transport-level, not app); the full 19-check flow is green locally on the same bytes.

### 3. Tests (all against the final bundle `71074c2e16`)
| Suite | Result | | Suite | Result |
|---|---|---|---|---|
| calc-regression | 329/0 | | device-sync | ALL PASS |
| calc-boundaries | 13/0 | | sync-ux | ALL PASS |
| classstore | 148/0 | | server-rbac | 43/0 |
| completeness | 62/0 | | server-sync | 26/0 |
| round5 / round6 / round7 | 49+32+38/0 | | server-migrations | 21/0 |
| data-safety | 36/0 | | backup-restore | 10/0 |
| notices | 28/0 | | schoolsync | 22/0 |
| excel-import | 24/0 | | adversarial | 45/0 |
| spraudit / import-acceptance | 20+18/0 | | **demo e2e (browser)** | **19/0** |
| spradapter / sprdemo | 38+16/0 | | npm audit | 0 vulnerabilities |

24/24 suites green (~1,100 checks). Honest note: the first battery run printed `test-server-backup.mjs RC=1` — that was a wrong filename in my harness (real name `test-backup-restore.mjs`, which passes 10/0); no app defect.

## Defects found and fixed tonight (with the fix's regression cover)
1. **Fresh-browser multi-account lockout**: only the first demo sign-in got a data-key wrap; the second account hit "No data key is stored". Fixed by wrapping the shared data key for every demo account after the first sign-in (mirrors `provisionUser`). Covered: e2e cet-demo sign-in check.
2. **Banner wiped by shell re-render**: banner now (re)renders after routing completes + on boot. Covered: e2e banner checks.
3. Demo install is slow (~5–9 s of PBKDF2 wraps) with no progress signal — mitigated with explicit button-disable + honest dialog copy (P3; a progress bar is future polish).
4. My own e2e initially matched the *dialog description text* instead of the real app state (false passes) — rewritten to wait for real completion signals (banner, `#app` scoping).

## Files changed
`source/sprdemo.js` (new), `source/app.js`, `source/build2.py`, `source/index.template.html`, `source/style.css`, `tests/sprdemo.test.js` (new), `tests/demo_flow_browser.py` (new), `scripts/patch-demo-mode.py` (new, reproducible patch record), rebuilt `app/index.html`; docs (this report, `MONDAY-SPR-TESTING-GUIDE.md`, `SPR-RELEASE-READINESS-MATRIX.md`). Deploy directory `workspace/spr-demo-deploy/` (outside the repo).

## Git
Milestone commit `bf5951c` (demo mode) + docs commit (see log). Pushed to `origin/feature/p2-secure-school`. `site` branch untouched; no Supabase SQL executed; legacy channels untouched.

## Remaining risks / owner actions
1. **Physical Android + iPhone pass** of the demo URL (matrix: PARTIAL — emulation only).
2. **Live-network flakiness** from China to pages.dev late at night — if Monday's load is slow, retry/refresh; the app is offline-capable after first load.
3. Home-only: two-device sync demo (school Wi-Fi blocks the SPR cloud — documented constraint, not a defect).
4. Production deployment remains gated on the school hosting/ICP/legal decisions (unchanged from the rounds 11–30 reports).
