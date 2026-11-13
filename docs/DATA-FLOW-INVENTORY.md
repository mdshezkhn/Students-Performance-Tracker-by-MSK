# SPR Data-Flow Inventory — where student data actually goes

Status: **verified against code** (branch `feature/p2-secure-school`, build `7249059c45`) + live probes 2026-11-13. This document separates *static code delivery* (no student data) from *student-data processing*.

## 1. Current production (my-spr-with-mo.duckdns.org) — as deployed TODAY

| Flow | Destination | Location | Carries student data? | Verdict |
|---|---|---|---|---|
| App download (HTML/JS/CSS, service worker) | GitHub Pages origin + Cloudflare Pages mirror (`spr-with-mo.pages.dev`) | US/global edge | **No** — static code only | Acceptable for code; mainland reachability is the known pain |
| DNS name `my-spr-with-mo.duckdns.org` | DuckDNS (free dynamic DNS) | US | No | Name only; replace when the school host is provisioned |
| Device-sync cloud copy + account pointer rows | Supabase project `hvjswsedoapsskedrkoj.supabase.co`, `spr_channels` table | **Seoul (ap-nab)** | **Yes — AES-GCM sealed** whole-workbook ciphertext + sealed pointer rows; plaintext never leaves the browser; channel id, timestamps and `pushed_by` labels are visible to the host | **Cross-border transfer of (encrypted) student data without an assessed mechanism — retire after migration** (MIGRATION-PLAN.md) |
| Live-board/report pages (retired round 9) | none (removed) | — | No | Done |
| Analytics / error reporting / AI APIs / external fonts | **none found** (grep of bundle: only Supabase + own origin; fonts embedded) | — | No | Keep it that way |
| SPR Excel import & audit (new, this branch) | **the browser only** — `SPRAudit` runs on the local file, no upload | user's device | Yes, locally | Compliant with the no-upload requirement |
| Full backup JSON file download | teacher's device | user's device | Yes (plaintext file — deliberate user action) | Documented; teacher-controlled |
| Local storage: primary store (PBKDF2-wrapped), safety copies (**now sealed**), pending offline edits | teacher's device | user's device | Yes, encrypted at rest | OK |
| QR codes / DingTalk / WeChat share text | whatever chat the teacher pastes into | varies | **The link only** (since 2026-11-13: no key inside links/QRs); the class KEY is a separate secret the teacher sends by a second channel | Acceptable; guidance in TEACHER-USER-GUIDE |

## 2. Target architecture (this branch, `server/`)

| Flow | Destination | Location | Student data | Status |
|---|---|---|---|---|
| Teacher browser ⇄ school API | `server/spr-server.mjs` on a Mainland-China VPS behind TLS | China | Yes — authenticated, CSRF-protected JSON over HTTPS | **Implemented + tested (staging)**; awaiting provisioning |
| Records / students / audit events | PostgreSQL on the same host (or same region) | China | Yes — school-scoped rows; minimal PII columns | **Implemented + tested (PGlite)**; awaiting provisioning |
| Incremental sync (`?since=`) | same API | China | Yes — record-level deltas | Implemented + tested |
| Audit reader | same API, admin sessions | China | ids/versions only, never payloads | Implemented + tested |
| Anything to Supabase/GitHub in the target state | **nothing** | — | No | Supabase project quarantined after migration |

## 3. Endpoint inventory of the bundle (grep evidence)

- `https://hvjswsedoapsskedrkoj.supabase.co` — the only external data endpoint (publishable key, no secret keys).
- `location.origin` (own host) — control.json owner-controls poll, same-origin only.
- No `sentry`, no Google Analytics, no external font/CDN requests in `app/index.html` (fonts are embedded base64).

## 4. China-network operational notes (measured)

- School Wi-Fi resets TLS to `*.supabase.co` (measured 2026-11-11) — the interim cloud path is unusable from the school network regardless of its security state; the China-hosted backend removes this dependency.
- GitHub Pages is intermittently slow/blocked from mainland networks; the Cloudflare mirror improves availability but is not a compliance fix.
