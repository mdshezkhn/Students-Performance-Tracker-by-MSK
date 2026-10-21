# SPR — Pre-Presentation Audit Report

**Target:** https://my-spr-with-mo.duckdns.org (landing + `/app/`)
**Build audited:** live service worker `spr-app-shell-df7ae1fdc2`, commit `51ecc3f` (includes the fix below)
**Date:** 2026-10-21 · **Method:** Playwright sweeps against production, all local regression suites, fresh-eyes code review of the Device Sync feature (skills: browser-qa, security-review, ai-regression-testing)

---

## Verdict: SHIP — ready for tomorrow's presentation

One real bug was found and **fixed and redeployed tonight** (see F-1). Everything else passed. Residual items are known, accepted, and none can derail a demo.

---

## What was tested (and result)

| Area | Checks | Result |
|---|---|---|
| Live functional sweep | 22/22 — landing→app links, cold load, first-run, sample data, all 8 nav views, Ranking per role, Excel export (65 KB file verified), XLSX import (2→3 semesters), Device Sync live push (CSP proof), offline reload via service worker, session restore | **PASS** |
| Regression suites | qa_master 22/22 · qa_ranking 0 fail · qa_reset 5/5 · completeness unit tests pass · qa_devicesync 21/21 (after fix) | **PASS** |
| Roles | Admin sees everything; Management sees Ranking; Teacher has no Ranking, no sign-ins panel, no reset/add buttons | **PASS (live)** |
| Mobile / tablet | 390 px and 768 px: zero horizontal overflow; rail collapses to a top bar (visually verified) | **PASS** |
| Console / network | Zero page errors, zero console errors, zero 4xx/5xx across all journeys | **PASS** |
| Security (new code) | All dynamic strings escaped (`U.esc`), HMAC integrity check rejects tampered/foreign cloud rows, rollback blocked by timestamp check, pairing key never leaves the link/backups | **PASS** |

## Findings

### F-1 (fixed tonight) — Device Sync push could overwrite the newer cloud copy mid-decision
After sign-in, the debounced auto-push fired ~4 s later. If the "A newer copy is in the cloud" dialog was still open at that moment, the push would overwrite the newer cloud data before the user chose. **Fix:** pull-checks now hold all pushes for their entire duration (including the dialog) and resume afterwards. Verified: qa_devicesync 21/21. Commit `51ecc3f`, live since 23:4x +08.

### Investigated and confirmed NOT bugs
- **`/app/manifest.webmanifest` 404** — by design ("no web-app manifest" is documented in the service worker); nothing references it, no console error.
- **Post-first-run screen has no sidebar/Sign out** — by design: the "Set up your first class" welcome replaces the shell until a class exists. Returns to the full shell after creating/importing/loading a class.
- **`net::ERR_ABORTED` on one Supabase call** — the best-effort DELETE racing the offline test; the tombstone overwrite (which actually destroys the ciphertext) was verified to land.
- **Export button not on Analysis/Reports** — by design; it lives on Enter scores, Grading and Manage (all verified working).

## Known, accepted limitations (unchanged, low demo risk)
1. **Cold-load latency from China → GitHub Pages**: app HTML 3.5–6.4 s; the manual PDF took ~17 s and the video ~30 s on a cold fetch. The service worker makes every subsequent load instant and fully offline-capable (verified).
2. **No HSTS/security headers** (GitHub Pages can't set them; needs Cloudflare in front) — documented P1, no demo impact.
3. **Auth `hash` is FNV-1a (UI gate only)** — real protection remains PBKDF2-310k → AES-GCM on the data itself; cloud payloads are random-key encrypted.
4. **Last-save-wins sync** — no merge; the app downloads a safety backup before replacing anything.

---

## Tomorrow's checklist (10 minutes, do it tonight or 30 min before)

1. **On the presentation machine's browser:** open the app, sign in, and if a banner appears ("A new version of SPR is ready"), click **Reload now**. Then check Manage → you should see the **Device sync** card (proves the new version).
2. **Turn on Device sync** there (Manage → Turn on → confirm) and **Set master password** — it syncs to every system you pair, and gives you password recovery.
3. **Warm the cache:** with the app open, the service worker has already cached the shell — reload once with Wi-Fi off to see it come back offline. Present with confidence even if the venue Wi-Fi dies.
4. **Don't click the PDF/video live** (cold fetch is slow from here) — open them once beforehand, or keep local copies in a folder on the desktop.
5. Demo accounts on the presentation browser: sign-ins are device-local — use the browser profile that already has your data, or run first-run + "Load sample data" (verified working on production).
6. If asked "what if two people edit at once?" — answer: last save wins, the app always downloads a safety backup first, and only the admin (you) syncs.

*QA scripts kept for reuse: `qa_rk/qa_presweep.py` (live sweep), `qa_rk/qa_devicesync.py` (sync matrix). Full logs: `/tmp/presweep.log`, `/tmp/regression_all.log`.*
