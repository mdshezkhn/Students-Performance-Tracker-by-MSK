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
