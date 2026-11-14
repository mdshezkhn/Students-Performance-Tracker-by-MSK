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

## Class mode (per-class workbooks, roles, approvals)

Each class can live in its own encrypted workbook with its own key: EAL
teachers edit their class and approve observation changes proposed by their
supporting teacher; managers see the whole school read-only; admins manage
accounts, pairing and migration. Agreed-rule control between colleagues —
see `docs/CLASS-MODE.md` for the full role matrix, the key model, the audit
log, the migration wizard and the honest-security notes.

## Development & tests

Everything runs from a clean clone — no build tools beyond Python 3 and Node:

    npm install          # jsdom, the single dev dependency (test browser)
    npm test             # calc regression + completeness + Excel import suites
    node tests/test-device-sync.js   # jsdom browser suite (device sync)
    python source/build2.py          # build dist/ + deploy/ (byte-stable)

CI (`.github/workflows/ci.yml`) runs the build, verifies the committed
`app/index.html` matches what the sources produce, and runs all four
suites on every push and pull request. The calc regression fixture
(`tests/fixtures/`) is synthetic; its expected values come from an
independent Python implementation of the workbook rules
(`tests/fixtures/generate_expected.py`).

---

# School Edition (secure FET/CET collaboration) — status 2026-11-14

This repository now contains TWO sync worlds, cleanly separated:

## 1. Personal/offline markbook (production demo)
The original app at the link above: browser-local, encrypted, Excel
import/export, offline PWA. Cloud sync via the legacy personal channels is
**read-contained** (the app refuses unauthenticated cloud writes; keys are
never in URLs; local copies sealed).

## 2. School server (staging, ready for deployment) — `server/`
A zero-dependency Node backend + PostgreSQL for real school use:

- **Individual teacher accounts** (scrypt, HttpOnly sessions, CSRF, login
  rate limiting, enforced first-login password rotation).
- **Server-enforced roles**: FET writes observations, CET writes
  spelling/tests/daily, admin manages, manager reads. School + class
  isolation on every query (45 adversarial HTTP tests).
- **Record-level sync** with versions, idempotency keys, conflicts that keep
  BOTH versions for deliberate resolution, durable offline outbox that
  survives browser restart.
- **Audit trail** immutable at the DATABASE layer (trigger), minimal fields.
- **Versioned migrations** (checksummed ledger), archive-not-delete student
  lifecycle, admin backup endpoint with a TESTED restore-into-isolation
  procedure, production boot guardrails (refuses default password /
  in-memory store / insecure cookies).
- **Local-only SPR Excel import & audit** — workbook parsing never leaves
  the browser (proven by running the whole matrix with the network
  disabled), calculation checks against the REAL grading engine.

### Verify it yourself (synthetic data only)
```
npm test                      # app suites incl. calc regression + boundaries
npm run test:server           # rbac/sync/migrations/backup/schoolsync/adversarial
npm run test:e2e              # 25-check two-browser FET/CET workflow (Edge)
npm run bench                 # scale: 20 classes x 25 students, zero failures
python source/build2.py       # rebuild the app bundle
```

### Deploy (when the school approves hosting)
See `docs/DEPLOYMENT-AND-OPERATIONS-GUIDE.md` (guardrails, TLS, rollback) and
`docs/EXTERNAL-APPROVALS-AND-DEPENDENCIES.md` for the outstanding school,
legal and owner actions. **No student data exists on any server today.**

Full evidence: `docs/ROUND29-FULL-ACCEPTANCE-REPORT.md` and
`docs/FINAL-RELEASE-READINESS-REPORT.md`.
