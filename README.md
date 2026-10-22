|# Student's Performance Report

 ESL teacher's markbook: observations, spelling, daily assignments and tests,
auto-grading (A*/A/B/C/D/U), class averages and per-student charts,
cross-semester comparative analysis (RAG / SWOT), and Excel import/export in
the SPR workbook format. Offline-ready: after the first successful visit, the
app reopens without an internet connection (service worker).

**Open the app:** https://my-spr-with-mo.duckdns.org/

**No student data is stored in this repository.** All data stays in your
browser (localStorage). Load your class via "Import SPR Excel" on first
use, and back it up via "Download backup (JSON)".

## Building & publishing (read before editing the landing page)

The published site at the repo root is **generated** by `source/build2.py`:

- landing `index.html` <- `source/landing.template.html` + `landing.css` + `landing-fonts.css` (AEROFOLD azure theme, self-hosted `media/` video)
- `app/index.html` <- `source/index.template.html` + the JS sources

**Never hand-edit the root `index.html`** — the next rebuild silently overwrites
it (that is how the azure theme was accidentally lost once). Edit the
templates under `source/`, then:

    python source/build2.py        # refuses if root files were hand-edited
    cp deploy/index.html index.html && cp deploy/app/* app/   # publish

The build **aborts** when the published files no longer match the last
committed build (`deploy/`), so hand edits cannot be clobbered unnoticed.
Override with `--force` only if you really mean to discard them.
