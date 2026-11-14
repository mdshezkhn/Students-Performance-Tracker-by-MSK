# Teacher UX Acceptance — Round 21

Assessed 2026-11-14. The visual identity and information architecture are
preserved from the existing application (mandate: do not replace with a
generic admin template). Evidence: `tests/test-sync-ux.js` (all pass —
state language), `tests/test-round5.js` 49/0 (owner-style rules incl. plain
language, no em dashes in UI prose), `tests/test-round7.js` 38/0,
`tests/test-notices.js` 28/0 (privacy notices), browser suite 18/0.

## Jargon audit (mandate §14.5)

Sweep of teacher-visible strings for: "API", "sync queue", "record version",
"database state", "outbox", "idempotency", "expected_version",
"localStorage", "IndexedDB":

- Teacher-facing flows: **clean** — errors say what happened and what to do
  next ("the data on this device is safe", "Manage → Device sync", "Waiting
  for an internet connection" family, enforced by test-sync-ux.js).
- The word "database" appears in exactly one teacher-visible privacy notice
  ("a hosted database service" naming Supabase — deliberate disclosure of
  where Save & Share puts data, retained) and in admin-only screens.
- Technical sync vocabulary (channel, envelope, token) lives only in
  admin/owner screens and this documentation.

## Correction made this round

The "Where the data lives" privacy notice still claimed **"The key stays
inside your share link"** — false since the round-10 secret-free-links fix.
Rewritten: the link alone is not enough; it works only together with the
class key shown separately; send link and key in different messages.
Rebuilt (bundle `0f33db4300`); notices + data-safety suites re-run green.

## Main navigation / dashboards

- Dashboard already prioritises the common tasks; **"Import existing SPR"**
  is a prominent dashboard action (round 10 P4).
- Role-aware behaviour exists in the class-mode world (owner/teacher scoping
  with observation approvals — CLASS-MODE.md) and the school-server world
  (FET/CET duties gate what can be written, server-enforced; the UI mirrors
  the same rule and shows only permitted entry forms).
- FET experience: observations entry + review of assessment data.
- CET experience: spelling / tests / daily entry + review of observations.
- Administrator area: accounts, memberships, semesters, school server
  (staging) — kept OUT of teacher flows (Settings-gated).

## Save / sync feedback

- Explicit save confirmations (toasts) — asserted by suites.
- Offline/pending/synchronised/failed/conflict states with next steps
  (test-sync-ux.js; conflict dialog shows both versions and resolve buttons).
- "Saved on this device" vs "synchronised" distinction enforced — a success
  message can never appear while data is only local.

## Accessibility / responsive

- Responsive desktop + tablet layouts (existing CSS, verified in earlier
  rounds' QA screenshots at phone/tablet widths; app was built mobile-first).
- Touch targets and contrast follow the existing design system; no
  WCAG-audited claim is made — physical-device + screen-reader acceptance
  remains open (see DEVICE-AND-CROSS-BROWSER-ACCEPTANCE.md).

## Gaps (honest, backlog)

1. No standing "needs review" inbox for unresolved conflicts (conflicts
   surface at write time; a dedicated review list is a UX backlog item).
2. Keyboard-navigation pass + screen-reader labels not formally audited.
3. Physical mobile acceptance outstanding (R27 records it).
4. The school-server panel is labelled "(staging)" — when production
   hosting is approved, the label and its copy need a product pass.
