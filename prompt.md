# SPR round 9 — CONTINUATION PROMPT (handoff between machines)

You are acting as the engineer finishing **round 9** of SPR (Student's Performance
Tracker) on the office machine. Everything through commit `b2d4d84` is DONE and
pushed to `origin/round9`. Your job is the remaining verification gates, two
known failures to fix, the final report, one last push. **Nothing else.**

---

## 0. Hard rules (from the owner's round-9 brief — still in force)

- Work ONLY on branch `round9`. **Never push to `main`. Never deploy.**
- No production Supabase. No real cloud calls.
- No change to grading (`source/calc.js`), report-card layout (one A4 page),
  or the owner-approved landing look. No design/CSS changes anywhere.
- Failing test first for any new fix. Report only what you actually ran.
- Never print, log or document the removed built-in account's password.
- Rollback tag `pre-round9` already exists — do not move it.

## 1. Set up on this machine (office, Windows, Git Bash)

```bash
git clone -b round9 https://github.com/mdshezkhn/Students-Performance-Tracker-by-MSK.git spr-repo
cd spr-repo
npm ci --include=dev          # MUST include dev: installs jsdom + @electric-sql/pglite
```

- `npm ci --include=dev` is **mandatory**. On the home laptop PGlite was missing
  and `test-round6` printed `SKIPPED` + exited 1, which killed the `&&` chain —
  looked like failures, wasn't. Fresh install avoids that.
- Python = `python` (not `python3`). For the real-Chromium gates:
  `python -m pip install playwright` (drives the system Edge via channel
  `"msedge"` — no browser download needed).
- Serve locally from the repo root: `python -m http.server 8000` →
  landing `http://localhost:8000/`, app `http://localhost:8000/app/`.
- Never hand-edit `app/index.html`, `app/sw.js`, `index.html` — they are build
  outputs. Edit sources, then `python source/build2.py` (script in `qa/` chains
  use `--force` when needed).

## 2. State of round 9 — DONE, do not redo

Branch `round9` @ `b2d4d84` (pushed). `origin/main` and the live site untouched.
History: `fd9933b` merge reconcile → `baec10e` task 1 → `40ab6a8` WIP checkpoint
→ `4522b80` task 3 → `ec62908` task 2 → `d7cdf60` cleanup → `ba10f41` round5
timing+prose fixes → `b2d4d84` report draft + gate scripts.

**Merge reconciliation (task 4a):** `origin/main` (`5f99a8a` landing redesign +
`001a3ad` Live board publish) merged into the round 5–8 line. Conflicts and
resolutions: `.gitignore` (union); `app/index.html` + `index.html` (resolved by
re-running `source/build2.py` — build output is the truth); `source/app.js`
(git auto-merge, semantically verified: main's Live-board hooks + built-in
account were taken in, then deliberately removed by tasks 1 and 3). `git log`
shows main's two commits as ancestors of round9. Use this list verbatim in the
report.

**Task 1 — Live board retired. DONE.** No `#/live` nav item; `#/live`
redirects to `#/dashboard`; `source/liveboard.js` + tests + build hooks deleted
(`grep -ri liveboard` = 0); Dashboard header shows "Saved X min ago" (+ "Cloud
copy: <time>" when device sync ran). Suite `tests/test-live-retire.js`
(13 checks) green. Bundle `app/index.html`: **1,918,078 → 1,909,330 bytes**.

**Task 2 — Users sheet (owner's model). DONE.** One account per person;
class assignments carry `class_role` (EAL / Supporting); pairing derived, never
stored; `can()` evaluates per class. Users screen has Sheet view (owner's 7
columns, grouped person+partner rows, filters), By-class view (click a cell to
change teacher, warns on duplicates), CSV download (UTF-8 BOM, School column)
and import with preview (role pickers, error list, nothing written before
confirm; username collisions offer keep/rename). Unassigning a teacher
re-keys the class (verified: kay loses P3C2). School name comes from one
Manage & setup setting (default "Demo School"). Header stays honest:
"Accounts on this device". Fixture: `tests/fixtures/roster-owner.csv` (owner's
13 rows). Suites: `tests/test-users-sheet.js` **49 checks green**;
`tests/test-users-roundtrip.js` 6 checks — see §3.2 (last verified state
ambiguous after a hard-to-read timing race; re-verify, don't assume).

**Task 3 — Built-in public-password account removed. DONE.** Code path +
toast deleted; first-run setup still offered. Old login attempts behave like
any wrong password (creates nothing). Source scanner rejects literal
password-like constants near login comparisons. Note added to
`docs/KNOWN-ISSUES.md` (password was public in the `5f99a8a` build; accounts
that used it must change passwords; cloud copies under it are exposed).
Suite `tests/test-recovery-gone.js` (9 checks) green.

**Task 4 — Landing verified (facts + weight).** All landing claims true
(9 skills, Written 20%, "Provided as is" + notice link present, no "All rights
reserved"); `prefers-reduced-motion` AND `Save-Data` stop the autoplay video;
`/app/` loads no video and no GSAP (verified). Fast-3G numbers still needed —
see §3.4.

**Docs/qa committed:** `docs/round9-REPORT.md` (DRAFT, placeholders),
`docs/qa/round9/` desktop screenshots (users-sheet-1280, by-class-1280,
import-preview-error-1280, dashboard-saved-1280 — desktop gate fully green:
report card 946 px < 1123 px A4, 0 page errors, Users sheet pixel-equal to the
owner's 13 rows).

`npm test` chain (20 suites, in order): completeness → calc-regression →
excel-import → classstore → help-security → data-safety → notices → round5 →
round6 → round7 → load → simple-ui → class-mode → device-sync → classes-escape
→ pair-open → live-retire → recovery-gone → users-sheet → users-roundtrip.
Locally verified green counts: ROUND5 43, NOTICES 25, DATA-SAFETY 36,
SIMPLE-UI 38, PAIR-OPEN 9, ESCAPE 20, ROUND7 38, USERS-SHEET 49,
LIVE-RETIRE 13, RECOVERY-GONE 9. A full clean-clone 3× pass has NOT yet
completed — that's your job.

## 3. Remaining work — do these in order

### 3.1 Triage the one fresh-clone failure, then run the full gate chain

The chain (`qa/round9_gate_chain.sh`, committed): fresh clone into
`.freshclone` → `npm ci --include=dev` → `npm test` ×3 (records each suite's
last line) → `python source/build2.py` byte-identical check on
`app/index.html`, `app/sw.js`, `index.html` → device-sync 30× pinned to 2
cores (PowerShell `ProcessorAffinity` mask 3 — Windows stand-in for
`taskset -c 0,1`).

Last run: STAGE 1 aborted at `test-simple-ui.js` —
`ERR Error: click target missing` at the "E: disable/enable" step
(~line 97). This suite passed 38/38 in earlier local runs; the known flake
pattern (jsdom timing on a busy Windows box) is documented in the suite's own
header. Steps:

1. `node tests/test-simple-ui.js` — three consecutive times on an IDLE
   machine (nothing else running). All green → it was load flake; proceed.
2. If it reproduces: it's a first-run/privacy-gate → login-card timing issue
   (the suite boots a fresh device). Fix the WAIT in the test, not the app,
   unless the app is genuinely broken at 1280px in real Chromium (spot-check
   with `qa/round9_gate.py`, which is green).
3. Then: `bash qa/round9_gate_chain.sh` and let it finish. Record the last
   line of every suite from each of the 3 runs.

If byte-identical fails, check `git config core.autocrlf` first (should be
false/input) before suspecting the build.

### 3.2 Verify `tests/test-users-roundtrip.js` (CSV round trip)

Run `node tests/test-users-roundtrip.js`. If
`FAIL: round trip: identical account+assignment state` appears: export→wipe→
import→export produced different CSVs. The export includes `school` +
`class_role`; the import collapses reciprocal pairs and unions classes for the
same username. Diff the two CSVs (add a temporary `console.log` in the test to
print both) — fix the app only if a real field is wrong; if it's ordering or
the admin "All classes" row, adjust the comparison. This suite runs its own
process on purpose (jsdom multi-window timers starve under parallel load).

### 3.3 Mobile 390 px gate — the one real open bug

`python qa/round9_gate.py` desktop section is fully green; the mobile section
(390×844, fresh device, same journey: ack privacy gate → first-run setup →
import `tests/fixtures/roster-owner.csv` → open class → Users sheet →
dashboard) times out at `set_input_files('#file-roster')` — the file input
never appears. `_dbg-mobile.png` in `docs/qa/round9/` shows where the journey
stalled — start there. Suspects, in order: (a) the first-run dialog sequence
(master-password recovery branch) not completing under slow emulation;
(b) at 390px the Users screen may render/hide the import control differently
— check the source before assuming; (c) hash navigation racing the class-mode
redirect. Deliverables: `docs/qa/round9/users-sheet-390.png` and
`dashboard-390.png`, plus "mobile page errors: 0".

### 3.4 Landing first-paint numbers

`qa/landing_weight.py` (committed) already does this: serves repo root, loads
the landing under Chromium Fast-3G throttling with cache off, reports seconds
to first contentful paint + total transferred bytes (`index.html` + assets),
and asserts the hero video does not block first paint. Run it, put the three
numbers in the report. If it errors on this machine, check the port it serves
on isn't taken.

### 3.5 Finish `docs/round9-REPORT.md`

Keep the existing draft; replace placeholders with REAL numbers only:
suite last lines from the 3× chain runs; bundle before/after (1,918,078 →
1,909,330); merge-conflict list from §2; first-paint numbers; the six-pair
class-access assertions are covered by `test-users-sheet.js` (49 green) —
reference it as proof. Keep the honest "could not test" list: real Supabase,
real iOS, real teachers. Under 300 words + the table (items 1–4, failing-test
name, fixed y/n, proof path).

### 3.6 Final push

`git add -A && git commit && git push origin round9` — then STOP. No main, no
deploy. Reply with the report table and the last line of every suite.

## 4. Landmines (lessons paid for on the home machine)

- **Never `git checkout -- <file>` over uncommitted work.** It silently ate
  six hours of `source/app.js` once. `git stash` first, always.
- **Commit after every green suite run; push round9 often.**
- **Run gates sequentially on an idle machine.** Parallel npm test + Chromium
  gates caused jsdom timer-starvation flakes (simple-ui click-target, roundtrip
  stalls) that wasted an hour.
- jsdom multi-window tests starve timers when several windows stay open —
  that's why roundtrip is a separate process and why windows are closed early.
- The gate logs under `/tmp/` on the home laptop are not in the repo — this
  prompt is the record. Trust only what YOU run.
- Windows Python is `python`; Playwright uses the `msedge` channel (system
  Edge). If `set_input_files` times out, dump `location.hash` +
  `document.title` + a screenshot before changing anything.

## 5. Key file map (round-9 changes)

- `source/app.js` — Users screen (both views, CSV import/export + preview,
  pair editor), `#/live`→`#/dashboard` redirect + class-mode no-semester guard
  order fix, "Saved X min ago" (+ cloud-copy line), first-run guard allows
  `#/users`, Manage & setup school field, built-in account REMOVED, `dsLog`
  strings use plain hyphens (round-5 em-dash scanner).
- `source/classstore.js` — per-class `can()`, `parseRosterCsv` (owner's 7
  columns + optional `class_role`, quoted CSV, BOM), preview model, `rekeyClass`
  wraps all keeper keyrings (passwordless-safe), single-rotation password
  flow during import, import flips the device to class mode.
- `source/calc.js` — UNTOUCHED.
- Landing: `Save-Data`/`prefers-reduced-motion` autoplay stop only (JS).
- New tests: `test-users-sheet.js`, `test-users-roundtrip.js`,
  `test-live-retire.js`, `test-recovery-gone.js`; fixture
  `tests/fixtures/roster-owner.csv`. Updated: `test-notices` (v2),
  `test-simple-ui` (sidebar `live` expectations), round-5 settle wait +
  em-dash fix.
- QA: `qa/round9_gate.py` (real Chromium), `qa/round9_gate_chain.sh`,
  `qa/round9_freshclone.sh`, `qa/landing_weight.py`; shots in `docs/qa/round9/`.
- `package.json` devDeps: `jsdom`, `@electric-sql/pglite@^0.5.13`.
