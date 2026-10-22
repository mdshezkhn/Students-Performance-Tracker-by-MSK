|# Student's Performance Report

 ESL teacher's markbook: observations, spelling, daily assignments, tests, grading,
cross-semester comparative analysis (RAG / SWOT), Excel import-export in SPR format.
averages, auto-grading (A*/A/B/C/D/U), per-student charts, and Excel
import/export in the SPR workbook format. Offline-ready: after the first successful visit, the app reopens
without an internet connection (service worker).

**Open the app:** https://my-spr-with-mo.duckdns.org/

**No student data is stored in this repository.** All data stays in your
browser (localStorage, encrypted). Load your class via "Import SPR Excel"
on first use, and back it up via "Download full backup".

## Accounts & device sync (short guide)

- **Admin turns on device sync once** (Manage -> Device sync -> Turn on).
  After every change the whole markbook is sealed (AES-GCM) and mirrored to
  the school's private cloud channel. On any other system, **just sign in**
  with the admin account - accounts, settings and data arrive automatically.
- **Teachers get their own username + password** (Manage -> Sign-ins ->
  Add sign-in). With device sync on, a teacher can also sign in on any fresh
  system and the same data arrives (a small password-sealed pointer row is
  written when the admin creates or resets the sign-in). Everyone's saves
  sync to the same single channel - no forks.
- **Sharing into DingTalk / WeChat**: the share dialogs offer "Copy for
  DingTalk / WeChat" (paste-ready message + link), a QR code both apps scan,
  the phone share sheet, and an "Open in DingTalk" deep link. WeChat's own
  forward menu is used when the app already runs inside WeChat.
- **No surprise downloads**: opening a shared link or a cloud copy no longer
  drops a .json file into Downloads - the previous data is kept as an
  in-app safety copy (Manage -> Safety copies, newest three, Restore/Delete).

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
