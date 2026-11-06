# Owner controls — how to pull the plug (round 10)

SPR is a local-first static app: no server of the maker can reach into a
teacher's browser. The "plug" is therefore a small **signed file** that every
copy of the app checks while it is online. This page is the honest manual:
what it does, what it cannot do, and how to operate it.

## What exists

- One protected **owner account** (role `Owner`, username `msk` by convention).
  Nobody else — no admin, no manager, no import, no sync merge — can disable,
  delete, rename, demote, re-pair or password-reset it. Exactly one owner
  exists per device; every device promotes/promotes-back automatically.
- **Owner recovery kit** (`spr-owner-kit.json`): the owner's ECDSA P-256
  signing key and the class-key escrow, sealed under the **master password**.
  Restoring the kit on a fresh browser recreates the owner account.
- **control.json**: the signed school-wide record every device obeys.

## Issuing a control record (owner only)

1. Sign in as `msk` → **Manage & setup** → **Owner controls**.
2. Pick a mode, write the public message (max 300 chars — it is public:
   no names, no secrets), enter the **master password**, confirm.
3. The app downloads `control.json`. Publish it at
   `https://<your-site>/control.json` (site root, same origin as the app —
   for this deployment: `https://my-spr-with-mo.duckdns.org/control.json`).
   Any static hosting works: drag the file into the same web space as the app.
4. Devices check on open and every 10 minutes while open. The status line
   shows the owner the currently accepted mode and when it was last checked.

### Modes

| mode     | effect on everyone else                                  | local data |
|----------|----------------------------------------------------------|-----------|
| normal   | nothing restricted                                        | untouched |
| readonly| no edits, imports, deletes or sync pushes; viewing, report printing and backup downloads keep working; banner shows the message | untouched |
| locked  | sign-in refused for every account except the owner; the message is shown on the sign-in screen | untouched |

No mode ever deletes or rewrites local data — verified by test
(snapshot byte-identity across a readonly → locked → normal cycle).

## Key escrow (why the owner can always open every class)

- Every class key is wrapped a second time under a 32-byte **escrow key**;
  the wrap travels inside the class index entry (`escrow` field).
- The escrow key sits (a) sealed in the owner kit under the master password
  and (b) in the owner's own keyring under the owner's login password.
- At owner sign-in, any missing class-key wrap is re-issued from the escrow.
- Classes created later, classes whose teacher was removed, and classes whose
  teacher forgot their password (password reset re-wraps only that teacher)
  all stay openable by the owner — verified by `tests/test-owner-master.js` E.

### Rotating the owner key pair

Generate a new kit (Manage & setup → set a NEW master password replaces the
seal; to rotate the signing key itself, start fresh: `source/owner-pub.key`
mechanism below), then:
1. Put the new public key (SPKI, base64) into `source/owner-pub.key` and
   rebuild — the key is then **embedded at build time** and every copy of the
   new build verifies against it first.
2. Devices without the build key fall back to the key learned via device
   sync (`auth.settings.ownerPub`).
3. Old records signed with the old key stop verifying — issue a fresh
   `normal` record first so nobody is stuck in an old mode.

## Restoring the owner on a fresh browser

Sign-in screen → **Restore the owner recovery kit** → pick the kit file +
master password + a new login password. Wrong master password writes nothing.
Class data then arrives by signing in with device sync on, or from a backup.
**Lose both the kit and the master password and nothing can recover them.**

## Honest limits (also shown in the UI)

- It cannot reach devices that **never go online** — a device that never
  fetches `control.json` keeps its last accepted mode (or normal).
- It **cannot delete or change** anyone's local data, by design.
- It cannot stop someone who **already exported** data (Excel, backups).
- The file is **public** — signatures prove authenticity, not secrecy.
  Never put student names or secrets in the message.
- A device with a badly wrong clock is handled by the strictly-increasing
  **counter**, not by time (records from the future beyond 24 h are rejected).
- A failed, offline or invalid fetch **never locks anyone**: the last accepted
  record stays applied; no valid record ever accepted means normal mode.
- Classes rotated on **another teacher's device** while the owner is offline
  lose their escrow wrap for the new key until the owner opens that class
  once via its Class key & link (existing mechanism) — after that the escrow
  heals automatically at the owner's next sign-in.

## Sync interactions

- In readonly/locked the app **stops pushing** cloud copies (pulls continue).
- A sync/union merge can never remove or downgrade the owner account and can
  never tombstone it — enforced in `dsMergeAccounts` + `ensureOwnerAuth`.
- Server-side revocation of write tokens is out of scope (see KNOWN-ISSUES).
