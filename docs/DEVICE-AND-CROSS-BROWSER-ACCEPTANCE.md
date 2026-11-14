# Device & Cross-Browser Acceptance — Round 27

Tested 2026-11-14. All flows synthetic data.

## What was actually executed

| Target | Method | Result |
|---|---|---|
| Desktop Chromium-class (Edge) | `tests/round11_browser_fet_cet.py` runs Playwright with `channel="msedge"` — the ENTIRE 25-check suite (login, FET/CET workflow, offline, restart, device replacement, reports, export/reimport, security headers, mobile viewport) executes on real Edge | **25/0** |
| Mobile layout (emulated) | iPhone 13 device descriptor: viewport 390px, touch, DPR 3 — app loads, no horizontal overflow, interactive controls present | ✅ (suite §12) |
| Desktop Chrome | same Chromium engine family as Edge; the jsdom suites cover the logic, and the engine-specific surface (service worker, WebCrypto, IndexedDB/localStorage, fetch) is identical | Not separately executed — **listed below as outstanding** |

## Honest outstanding items (cannot be done from this machine)

1. **Physical Android Chrome** — real device, real touch, real network
   switching (Wi-Fi ↔ mobile data during sync).
2. **Physical iPhone Safari** — real WebKit/Safari service-worker and
   WebCrypto quirks can only be confirmed on-device.
3. **iPad Safari** — tablet layout at real Safari rendering.
4. Desktop Safari + Firefox passes.

These remain **manual acceptance requirements** — recorded in
FINAL-MANUAL-ACCEPTANCE-CHECKLIST.md with exact steps. No mobile-readiness
claim is made from emulation alone (mandate §27).

## What the emulation DOES establish

- The responsive layout holds at 390 px with no horizontal scroll.
- The app shell + login + service-worker lifecycle work under touch
  descriptors and mobile user agents.
- The offline/PWA behaviour is engine-level (service worker), exercised
  headlessly end-to-end.
