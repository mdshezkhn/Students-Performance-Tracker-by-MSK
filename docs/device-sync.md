# Device Sync — design notes

Shipped 2026-10-21 (pairing-link model), reworked 2026-10-22 to
**account-based sync**: the sign-in itself is the pairing. Gives the admin
(mo) the same data on every system with zero setup — answering
"my data lives in one browser" without a server account.

## What it does
- **Enable once** (Manage → Device sync → Turn on, as admin). From then on:
- **Automatic push**: after every save (debounced 4 s) the whole encrypted
  state — accounts, wrapped data keys, sealed workbook, master-password wrap —
  is AES-GCM-sealed under a random 256-bit sync key and written to the
  account's row in `spr_channels` (Supabase).
- **Accounts travel additively** (2026-10-24): the account list in the cloud
  row is the UNION of the pusher's list and the row's previous list — a device
  with a stale short list can no longer erase colleagues created elsewhere.
  A deleted sign-in stays deleted via a tombstone list (`gone`) that travels
  in the envelope; re-creating the same username later lifts the tombstone.
  A push that cannot READ the current row (network error) aborts instead of
  overwriting it blind — the union must never be replaced by a local-only copy.
- **Sign in anywhere**: on any other system, just sign in with the admin
  username + password. The channel id is derived from the username
  (`ds1-<sha256>`), and the sync key is stored inside the row **wrapped under
  the admin's login password** (PBKDF2-310k, same KDF as the local vault).
  A fresh browser needs nothing else — accounts + data install silently.
- **Automatic pull-check**: 1.5 s after an admin sign-in (and via *Manage →
  Check for newer copy*), the row is fetched. If its content digest differs
  and its timestamp beats the device's boot-time timestamp, a dialog offers
  to open the cloud copy (a local safety backup downloads first).
  Last save wins.
- **Browsers with their own data**: signing in with an account that is not
  local (or turning sync on) offers to adopt the account's cloud copy
  instead of creating a second island — with a backup file first.
- **Pairing link** (`#pair=<channel>&k=<key>`) and JSON backups remain as
  backup ways to carry the key (offline transfers, forgotten-channel
  recovery).
- **Password changes**: the next push after a fresh sign-in re-wraps the sync
  key under the new password (old row content is replaced; the channel id
  stays because it derives from the username only).
- **Legacy channels**: pushes by the old random-channel builds are detected
  (HMAC mismatch) and never clobbered — the account flow adopts the row
  instead; a device moving from its random channel to the account channel
  tombstones the old row so no device stays behind.

## All users (2026-10-22)
The sync transport runs for EVERY signed-in user on a paired device: any
teacher's or management's saves auto-push, and each sign-in pulls the newest
copy — nobody is tied to one system. All pushes go to the single OWNER
(admin) account channel, so there is still exactly one cloud row per school
(no forks). Channel CONTROL (enable / turn off / delete / pairing link)
stays admin-only; other users see a one-line "managed by the administrator"
note in Manage. Pushes record `device — username` so the "newer copy" dialog
says who saved it, and failed pushes auto-retry once after 30 s. The
password wrap on the row is refreshed **only by the owner's own fresh
sign-in** — a teacher's push carries it forward untouched, so the admin's
sign-in-anywhere bootstrap never breaks. On legacy pre-account pairings
(random channel, pre-migration), pushes stay admin-only until an admin signs
in once and moves the channel home.

## Teacher sign-in-anywhere (2026-10-22, pointers)
Teacher accounts bootstrap on a fresh browser through a **pointer row**: at
`dsChan(<teacher>)` sits a tiny payload `{chan, key}` — the school data row's
id and the sync key — sealed under the TEACHER's password (PBKDF2-310k +
AES-GCM, same KDF as everything else). Written at the only moments the
plaintext password exists (admin creates / resets the sign-in), removed with
the account or when the school channel is deleted. Collisions with the same
username at another school return 409 and are never overwritten — the admin
renames the sign-in. Sign-in flows through the same verified path as the
admin's: after unwrap, the data row's account hashes must match, so a swapped
pointer buys an attacker nothing. Fresh-browser restore installs the teacher
on the OWNER channel (`cfg.owner = admin`), so every push still lands on the
one school row — no forks. The Manage → sign-ins table shows a
"✓ signs in anywhere" badge per account (admin: whenever sync is on;
teachers: once their pointer exists).

## No-surprise safety copies (2026-10-22)
Opening a join link, adopting a cloud copy, or restoring a backup no longer
drops `SPR-backup-before-replace.json` into Downloads — non-technical
teachers read that as something going wrong. The previous data is kept as an
in-app safety copy (`spr-safety-backups-v1`, newest three, per browser) and
Manage → Safety copies offers Restore/Delete. If localStorage refuses
(quota), the old file download returns so a copy is never silently missing.
The explicit "Download full backup" button is unchanged.

## Sharing into DingTalk / WeChat (2026-10-22)
No third-party JS-SDK (WeChat needs a verified official account + ICP
domain, DingTalk an enterprise app) — instead: "Copy for DingTalk / WeChat"
(clipboard gets a paste-ready message + link, the way teachers actually
share), QR (both apps scan natively), OS share sheet on phones, an
"Open in DingTalk" deep link (`dingtalk://dingtalkclient/page/link`), and
UA-aware hints when the app already runs inside WeChat/DingTalk (use the
native forward menu).

## Threat model
`spr_channels` is listable with the public publishable key (share links need
anon read), so the account row is findable by username. Everything inside is
sealed: the sync key is random 256-bit, and the copy that lets a fresh device
bootstrap is that key **wrapped under the password** — attacking it offline
means brute-forcing a teacher-chosen password through PBKDF2-310k per guess.
That is the same cost as attacking any password-derived wrap in the local
vault; the trade (sign-in-only bootstrap vs. uncrackable-but-link-only key)
was chosen for usability on 2026-10-22. Every payload carries HMAC(key, ct)
so tampered or mismatched-key copies are refused; wrong passwords fail the
AES-GCM auth check and look like a plain wrong password.

## Write protection: per-channel write token (item 5, 2026-10-28)

The reviewer noted that anyone who knows a username can compute the channel id
(`sha256('spr-ds1:chan:' + username)`) and PATCH garbage over the cloud copy
with the public publishable key. HMAC makes devices refuse the tampered copy,
but the backup itself is destroyed.

Mitigation shipped on the data-safety branch:

- Every paired device generates a random 48-hex **write token** at pairing
  time (kept in the local sync config, never in the row).
- Every push and pull request sends it as an `x-spr-write-token` header.
- The Supabase side must be upgraded by the owner by running the SQL in
  `docs/supabase-write-token.sql`: it adds a `write_token_hash` column and a
  `previous` column (the last good payload, so one bad write can be rolled
  back), replaces direct PATCH with a `security definer` RPC
  (`spr_channel_write`) that compares `digest(token, 'sha256')` against the
  stored hash, and revokes direct UPDATE on the table.

What remains true until the owner runs that SQL: the row is still directly
PATCHable by anyone with the publishable key. What remains true afterwards:
the token travels with every request from a paired device, so a determined
attacker who briefly holds a teacher's browser (or the local sync config)
can still read it; the hash comparison also means an attacker CANNOT enrol
their own token without the current one. Read access stays public by design
(share links need it) and the payloads stay sealed.

## Known limits
- Last-save-wins; no merge. Two offline devices that both edit will be asked
  to pick a copy.
- Rows cannot be DELETEd by the anon key (PostgREST still answers 204 when
  the row policy ignores it). "Turn off & delete" therefore overwrites the
  payload with a dead tombstone first (`{sprDS:0}`), which destroys the
  ciphertext; a best-effort DELETE follows.
- The cloud row lives under the **admin's** username: teacher sign-ins on a
  fresh (never-paired) browser cannot bootstrap by signing in alone — they
  use a system the admin signed in on once, the pairing link, or a JSON
  backup. On every paired system teachers push and pull like the admin.
- A restored session (browser kept signed in) has no password in memory, so
  the password wrap cannot be refreshed until the next fresh sign-in; the
  existing wrap is carried forward unchanged.

## QA
`tests/test-device-sync.js` (jsdom, real webcrypto): fresh-browser sign-in
card, account-channel push + password wrap landing at fresh sign-in,
auto-push after a change, sign-in-only restore on a second browser,
wrong-password rejection, cloud-copy adoption on a browser with its own
sign-ins, same-account browser adoption (sign-in offer + enable fallback),
cloud row not overwritten by the adopting device, teacher transport on a
paired device (push as `device — username`, owner's wrap preserved,
fresh-browser teacher sign-in correctly rejected instead of forking).
