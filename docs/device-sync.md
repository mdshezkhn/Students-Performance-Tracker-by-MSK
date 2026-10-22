# Device Sync (admin) — design notes

Shipped 2026-10-21. Gives the admin (mo) the same data on every system,
answering "my data lives in one browser" without weakening the app's
device-local privacy model for everyone else.

## What it does
- **Automatic push**: after every save (debounced 4 s) the whole encrypted
  state — accounts, wrapped data keys, sealed workbook, master-password wrap —
  is AES-GCM-sealed under a random 256-bit sync key and PATCHed to the admin's
  private channel row in the existing `spr_channels` Supabase table
  (`share_name = 'devicesync'`).
- **Automatic pull-check**: 1.5 s after an admin sign-in (and via *Manage →
  Check for newer copy*), the row is fetched. If its content digest differs and
  its timestamp beats the device's boot-time timestamp, a dialog offers to open
  the cloud copy (a local safety backup downloads first). Last save wins.
- **Fresh system**: open the pairing link (`#pair=<channel>&k=<key>`) once, or
  restore a JSON backup (backups embed `__sprPair`). Then simply sign in with
  the normal SPR account — accounts + data install silently, no reload.
- **Password reset side effect**: the master-password wrap syncs too, so
  "Forgot the admin password?" works on every paired system, and a password
  reset on one system reaches the others on their next pull.

## Threat model / why a random key, not the login password
`spr_channels` is listable with the public publishable key (share links need
anon read). A password-derived key would therefore expose the ciphertext to
**offline** brute force (login passwords are teacher-chosen). The sync key is
instead a random 256-bit value that lives only in the pairing link / backups —
the cloud row is findable but uncrackable, matching the existing class-share
security model. Every payload carries an HMAC(key, ct) so tampered or
mismatched-key copies are refused.

## All users (2026-10-22)
The sync transport now runs for EVERY signed-in user on a paired device:
teachers' and management's saves auto-push, and each sign-in pulls the newest
copy — nobody is tied to one system. Channel CONTROL (enable / turn off /
delete / pairing link) stays admin-only; other users see a one-line
"managed by the administrator" note in Manage. The pairing link decides who
can join a device — hand it to a teacher only if that teacher should have the
markbook on that system. Pushes record `device — username` so the
"newer copy" dialog says who saved it. Failed pushes auto-retry after 30 s.

## Known limits
- Last-save-wins; no merge. Two offline devices that both edit will be asked to
  pick a copy.
- Rows cannot be DELETEd by the anon key (PostgREST still answers 204 when the
  row policy ignores it). "Turn off & delete" therefore overwrites the payload
  with a dead tombstone first (`{sprDS:0}`), which destroys the ciphertext;
  a best-effort DELETE follows.
- Teacher/Management sign-ins on a paired system can use the pulled data, but
  pushes only run while an **admin** session is active (owner decision: admin
  exception only).

## QA
`qa_rk/qa_devicesync.py` (gitignored): 21/21 — enable, pair, wrong-password
rejection, silent install, auto-push, newest-copy pull, master-wrap
propagation, cross-device admin password reset, turn-off & tombstone, zero
console errors across three simulated devices.
