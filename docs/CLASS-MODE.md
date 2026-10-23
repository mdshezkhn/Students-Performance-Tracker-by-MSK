# Class mode — per-class workbooks, roles and observation approvals

SPR's *class mode* replaces the single shared markbook with **one encrypted
workbook per class**, each sealed with its own random AES-256 key. It is a
client-side design: no server, no new dependencies, no third-party hosts —
the app runs on GitHub Pages exactly as before.

> **Status**: shipped behind the migration wizard. Devices stay on the legacy
> single-markbook storage until the admin runs *Review migration…*
> (Manage & setup → “Per-class workbooks available”). Nothing changes for
> existing data until that moment, and a backup is downloaded first.

---

## What each role can do (the whole matrix, enforced in `ClassStore.can`)

| Action                        | Admin | Manager | EAL (own class) | Support (own class) |
| ----------------------------- | :---: | :-----: | :-------------: | :-----------------: |
| Open / read the class         |  all  |   all   |     own class   |      own class     |
| Edit observations             |  ✓    |   —     |     ✓ direct    |  propose only      |
| Edit spelling / daily / tests |  ✓    |   —     |        ✓        |         ✓          |
| Edit the student roster       |  ✓    |   —     |        ✓        |         —          |
| Approve / return proposals    |  ✓    |   —     |        ✓        |         —          |
| Export / print / back up      |  ✓    |   —     |        ✓        |         —          |
| Read the audit log            |  ✓    |   ✓     |        ✓        |         ✓          |
| Accounts, pairing, migration  |  ✓    |   —     |        —        |         —          |

“Own class” = the class records your username as its EAL or support teacher.
Nobody — including admins — sees a class they hold no key for *decrypted*;
managers hold all keys and are read-only everywhere.

## Keys and who holds them

- Each class workbook is sealed with a random 256-bit key (`ClassStore.sealClass`).
- A user's **keyring** stores class keys wrapped under that user's login
  password (PBKDF2-SHA-256, 310 000 iterations — the same parameters as the
  app's master key). Keys are unwrapped only at sign-in; they live in
  `sessionStorage` for the tab's lifetime and are wiped on sign-out.
- Admin and managers hold every class key. An EAL/support pair hold only
  their class's key. The class list shows only classes you hold.
- Issuing a key to an account rotates that account's password (a real new
  password, shown once, downloadable as CSV). This is inherent to
  password-wrapped keys: the admin cannot wrap a key under a password they
  do not know.

### Honest security boundary (read this before relying on the roles)

**This is an agreed-rule control between colleagues, not tamper-proof
security.** Anyone who *holds a class key* (or an account password whose
keyring contains it) can decrypt the workbook and re-encrypt anything they
like — including editing scores directly or rewriting the audit log, which is
append-only by convention, not by cryptography. The design prevents *casual*
access (a support teacher's browser physically cannot decrypt another class)
and makes *who did what* visible to the whole class team. It cannot stop a
determined key holder. The UI states this on the class home, the key-sharing
dialog and the audit panel.

## Observation approvals (the pending queue)

A support teacher's observation edit never touches the score. Clicking a
readonly observation cell opens a proposal dialog; the proposal is stored in
the class workbook as `{cell, oldValue, newValue, requestedBy, time, note}`.

- The paired EAL (or admin) sees a **Review (n)** badge and a queue screen.
- **Approve** applies the new value atomically and records old → new in the audit log.
- **Return** leaves the score exactly as it was — also logged, with the reason.
- EAL observation edits apply directly (their own duty).

## Audit log

Every class workbook carries an append-only audit trail: who, when, which
cell, old and new value, approval decisions, migration and import events.
It is included in every backup JSON and as an **Audit Log sheet in every
Excel export**. The newest 5 000 entries live in the workbook; older entries
drop off first (full history remains in downloaded backups).

## Migration (single markbook → per-class workbooks)

1. Admin opens *Review migration…* — a **dry run** groups semesters by class
   and lists what will move (classes, semesters, students, score cells).
2. Per class, the admin picks the EAL/support teachers (accounts must exist;
   import the roster CSV first if needed).
3. Apply downloads a **full backup first**, then: each class is sealed with a
   fresh key, keyrings are issued (admin's own password for the admin;
   freshly generated one-time passwords for everyone else), the device flips
   to class mode, and the legacy blob is kept untouched as an archive.
4. `tests/migration round-trip` proves semesters, scores and **final grades
   are byte-identical** before and after migration.

## Moving classes between devices

- **Device sync** (unchanged transport): the sealed payload now carries the
  class index and every class blob (`v3`); a signed-in teacher receives all
  ciphertexts but can only decrypt the classes in their keyring.
- **Class file** (`*.sprclass.json`, encrypted) + **key link**
  (`#class=<id>&k=<key>`, QR + DingTalk/WeChat sheet) — the file carries the
  data, the link carries the key. Import asks for the link/key.
- **Export everything** (admin): one JSON with all classes in plaintext —
  unencrypted, approved storage only; restoring re-keys every class (teachers
  are re-paired afterwards).

## Roster CSV (account template)

`username, display_name, role, class_or_grade, paired_with, status` — UTF-8
(BOM tolerated), CRLF, the display strings from the school's template
(“Manager (sees whole school)”, “EAL teacher”, “Supporting teacher”).
Validation: usernames `a-z0-9_-`, unique, roles mapped strictly, pairing must
be mutual. Each import generates fresh one-time passwords (shown once,
CSV-downloadable). Class keys are issued afterwards via **Pair**.

## Files

- `source/classstore.js` — everything above as a pure UMD module
  (`window.ClassStore` / `require`), Node-testable.
- `tests/classstore.test.js` — role matrix, keys, pending flow, audit cap,
  migration + grade regression, roster CSV, codecs (122 checks).
- `tests/test-class-mode.js` — full-browser jsdom walk of the workflow
  described here (46 checks).

## P1.1 hardening — passwords without hashes

- **No password hash is stored or synced, ever.** Each account record carries a
  *login wrap*: a random token sealed under the password (AES-GCM). Signing in
  means *unlocking* — a wrong password fails the GCM auth tag. Pre-P1.1
  accounts that still carry an FNV hash migrate themselves on their next
  sign-in (safety copy first, then the hash is deleted from that device and
  never pushed again). The only hash constant left in the code detects the
  retired public default password during that one-time migration.
- **Key wrapping is versioned.** New wraps: PBKDF2-SHA256 **600,000**
  iterations (v2). Old wraps (310k) keep working — the iteration count travels
  inside each wrap — and are upgraded whenever re-wrapped (e.g. on password
  change).
- **Password policy.** Admin and manager passwords need **14+ characters**;
  teacher roles keep 8. Every role can change their own password
  (Manage → Change my password): the current password is verified by
  unlocking, and the data-key wrap plus every class key in the keyring are
  re-wrapped under the new password. No admin involvement.
- **Generated one-time passwords** (pairing, roster import) are 20 characters
  from a 30-symbol no-lookalike alphabet in four groups of five
  (`xxxxx-xxxxx-xxxxx-xxxxx`) — 98 bits straight from
  `crypto.getRandomValues`. They satisfy every role policy by construction.

### Residual risk: sync payloads carry other users' keyrings (documented)

The sealed sync envelope contains every account's **wrapped** keyring and login
wrap, because adoption on a new device must be able to install ANY legitimate
user of the school (an EAL teacher adopting must receive their own keyring;
their paired support teacher's keyring must be there when that teacher signs
in on the same device). All of this travels **encrypted** and each keyring
stays locked under its owner's password — a device that adopted the payload
holds everyone's *ciphertext* but can decrypt only what its signed-in user's
password unlocks. The residual exposure: on a device that adopted the cloud
copy, any user's password unlocks that user's data — the same as before, but
worth stating. Keyrings are never published, exported, or logged anywhere
else. Removing them from payloads would break cross-teacher adoption, so the
risk is accepted and documented rather than fixed.

### Invalid scores are quarantined, never deleted

When stored data contains an out-of-range score (negative, above the total,
observation over 10), loading moves it to a per-semester **review list**
(`sem.review`) instead of deleting it: grades ignore it, a dashboard banner
points at it, Manage lists each quarantined value with its reason, and a
safety copy is stashed before anything moves. Discarding an entry removes it
from the review list only.
## P1.2 — privacy-true defaults

- **No cloud contact until you choose it.** Signing in, first-run setup and loading
  the sample never touch Supabase (verified by a zero-network-request test). Users
  coming from another device press **I use SPR on another device** on the sign-in
  card; admins use **Turn on device sync** or **Check for newer copy** in Manage.
- **Password floor for teachers is 12 characters** (admin/manager 14) at setup,
  reset and self-service change.
- **Self-service password change now re-seals the cloud pointer row**, so a fresh
  browser bootstraps with the NEW password without any admin involvement. If the
  pointer cannot be updated (offline), the change still succeeds and says so.
- **The classic npoint.io channel is retired**: its UI, code paths and CSP entry
  are gone. Old npoint links explain they are retired instead of fetching anything.
- **One privacy notice per first-run**: the entry gate is the notice; it no longer
  re-opens after setup or sign-in.
- **Landing page**: no absolute privacy claims (the honest sentence is
  *"No student data leaves this device unless you turn on sync or Save & Share —
  and then only an encrypted copy"*), the mockup chip reads
  "Encrypted on this device" instead of "Synced", and the four stat counters
  carry their real final values in the HTML (visible with JavaScript disabled;
  the count-up animation only runs for JS visitors).
- **Fixed a real P1.1 bug found by these tests**: the three cloud-lookup call
  sites treated `verifyUserPw`'s `{ok:false}` object as truthy (any password
  passed the account check once GCM had succeeded elsewhere). All sites now
  check `.ok` explicitly.