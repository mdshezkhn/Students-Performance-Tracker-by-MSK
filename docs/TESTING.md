# Testing SPR

Everything here is development tooling. Nothing in this file ships in the app.

## From a fresh clone

```bash
npm ci --include=dev     # installs jsdom + @electric-sql/pglite (test-only)
npm test                 # runs every suite in order, stops on the first failure
```

`npm test` covers, in order: completeness, calc-regression (grading rules),
excel-import, classstore (crypto), help-security, data-safety, notices,
round5, round6 (includes the real-Postgres SQL proof via PGlite), simple-ui,
class-mode, device-sync, classes-escape, pair-open.

If PGlite is missing, `test-round6` prints
`SKIPPED: real-Postgres proof needs PGlite` and the run FAILS on purpose.
It should never be a silent pass.

## SQL harness (real Postgres engine, locally)

```bash
node tests/sql-policy-test.mjs docs/supabase-write-token.sql
```

Runs the SQL file against PGlite (in-memory Postgres + pgcrypto) in three
policy scenarios (old policy named as guessed / differently named / ALL
policy) plus the Save & Share request shapes. Every "direct UPDATE" line must
say `REFUSED: permission denied`. See `docs/OWNER-RUNBOOK-supabase.md` before
running anything against the real Supabase project.

## Browser checks (real Chromium / WebKit / Firefox)

```bash
C:/Python314/python.exe docs/qa/round7/browser.py          # core flows x3 engines
C:/Python314/python.exe docs/qa/round7/phone.py            # 390/768 layout checks
C:/Python314/python.exe docs/qa/round7/evidence.py         # full desktop walkthrough
```

These need Python + Playwright with the `msedge` channel (Chromium) and the
`webkit` / `firefox` browsers installed (`python -m playwright install`).
They are NOT iOS Safari; see the honest note below.

## Score entry on phones

The score grid keeps the student-name column pinned; the score columns scroll
inside the grid's own box (`overflow: auto`), never the page.

## Manual checklist: real iPhone / iPad (NOT tested by these scripts)

Playwright WebKit is not iOS Safari. Before relying on phones, check on a
real device, on the school network:

- [ ] Sign-in works; the notice gate checkbox ticks and the button enables.
- [ ] Create a class; add a teacher; pairing code shows and works.
- [ ] Enter scores; dashboard updates; leave and re-open: data still there.
- [ ] Manage & setup shows "Persistent storage: granted" or "not granted".
- [ ] Download backup: the file lands in Files (iOS) and opens.
- [ ] Restore from that backup on the same device works.
- [ ] Leave SPR unused for ~1 week, reopen: data still there (iOS may clear
      site data after 7 days of non-use; SPR shows a warning in Manage, see
      "Show the iPhone/iPad warning again").
- [ ] Share link opens in the SAME browser it was sent to (no app takeover).
- [ ] Report card prints to PDF: one A4 page.

## Build

```bash
python source/build2.py     # rebuilds index.html, app/, notice.html from source/
```
