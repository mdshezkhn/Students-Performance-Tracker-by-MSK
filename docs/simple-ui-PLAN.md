# simple-ui — 10-line plan (PR description)

1. Tag `pre-simple-ui` on main (one-command rollback), branch `simple-ui`.
2. P1.3: `dsCanPush()` also requires `dsOn()`; landing-page privacy wording fixed.
3. Sign-in goes straight to work: single class auto-opens to `#/dashboard`; 2+ classes get a minimal "Choose your class" (name + Open + Sign out); no-class teachers see "No class yet — ask your admin".
4. Class switcher moves into the sidebar (only when an account holds 2+ classes); the separate Classes page disappears from the teacher path.
5. All technical actions (Key & link, Pair, Import class file, Import roster, Export/Restore everything, Review migration, Start fresh) move into an admin-only collapsed "Advanced" panel on the chooser screen; teachers never see them.
6. Teacher sidebar = Dashboard, Students, Enter scores, Report Cards; Grading/Analysis stay reachable from dashboard buttons. Admin adds Users + Manage & setup; Ranking keeps current role rules.
7. Never a dead end: key-missing / undecryptable-blob dialogs get ONE primary button ("Check for a newer copy" when sync is on, otherwise "Restore from a backup file") with Sign out always visible.
8. New admin Users tab (`#/users`, URL-guarded): list, search, role filter, CSV (exact agreed columns, no secrets), Add account, Import roster CSV, per-row Disable/Enable + Reset password; disabled accounts cannot sign in.
9. Dashboard shows "Updated just now / HH:MM" after each save + a code comment marking the future shared-database hook.
10. Tests: new `tests/test-simple-ui.js` (30 checks: stuck scenarios a/b/c, role sidebars, users guard/tab/CSV/secrets, disable, zero-request); escape suite updated for admin-only Advanced; all existing suites kept green; rebuilt artifacts committed (sw `25dc3a3290`).

---
## Status update (2026-10-24, reviewer fixes applied)

5. **Correction**: the Advanced panel lives in **Manage & setup (admin only)**, collapsed,
   one plain sentence per tool — the brief's original placement. The chooser screen carries
   no technical buttons at all. `#/manage` is reachable even with no class open (a stuck
   admin must reach Start fresh / restore), teachers are redirected (their password change
   moved to a "Password" button in the sidebar footer).
7. New `tests/test-pair-open.js` (9): full pair flow — publish, pair as lowercase `mo`,
   auto-open, reload. class-mode suite green again (65).
8. Bug fixes found by QA: wrap-lookup keyed by typed username; `dsAccountLookup` null crash;
   migration sealing the admin's key under an unknown password after reload (SESSION.pw
   safeguard); Users-tab re-render wiping the shell; renderManage null `#content` without a
   class.
9. Real-browser QA: `qa/simple_ui_qa.py` — scenarios A-G + phone at 390x844, screenshots in
   `docs/qa/simple-ui/`. Final run: **26 checks, 0 failures**, including G = 0 Supabase
   requests in 35 s with sync off.
