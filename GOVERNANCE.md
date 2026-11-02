# SPR — Governance, backup & data protection

*Owner: Mohammed Shehzad Khan (Teacher Mo) · Written 2026-11-02 · Applies to
[my-spr-with-mo.duckdns.org](https://my-spr-with-mo.duckdns.org) and the repo
[Students-Performance-Tracker-by-MSK](https://github.com/mdshezkhn/Students-Performance-Tracker-by-MSK)*

This document protects the teachers using SPR. It states who owns what, how
data is backed up, how to recover after a loss, and the limits of the tool's
warranties. It complements (not replaces) the in-app Privacy & data notice.

---

## 1. Who owns what

| Asset | Account | Owner | If the school asks for a transfer |
|---|---|---|---|
| GitHub repo `mdshezkhn/Students-Performance-Tracker-by-MSK` | personal GitHub | Teacher Mo | Add the school's account as owner, or transfer the repo (Settings → Transfer). The repo is static files only — it contains **no student data** (history was purged and re-verified 2026-10-18). |
| Domain `my-spr-with-mo.duckdns.org` | personal DuckDNS | Teacher Mo | Point a school-owned domain at the same GitHub Pages site and change `CNAME`. |
| Supabase project `hvjswsedoapsskedrkoj` (Seoul region) | personal Supabase | Teacher Mo | See §6: the cloud holds **only ciphertext**; moving projects re-creates an empty `spr_channels` table. |
| Student data | — | **The school**, under PIPL | Data lives in teachers' browsers and in exported backup files. See §5. |

**No school-owned infrastructure is required.** Everything runs on free tiers:
GitHub Pages (hosting), DuckDNS (name), Supabase (optional encrypted sync).
If any of these disappear or are blocked (see §7), the app keeps working
offline and teachers exchange encrypted class files instead.

## 2. Backup cadence (the non-negotiable part)

The app reminds you (nudge dialog + “Last backup” age in Manage), but **you**
are responsible for these three habits:

1. **After every session** that entered real scores: *Manage → Download full
   backup*. In class mode this downloads **two files** — the encrypted class
   file (`.sprclass.json`, useless without the class key) and the readable
   JSON backup. Keep both.
2. **Weekly** (Friday): one full backup of every class you teach, kept on
   school-approved storage (see below).
3. **Term end**: a snapshot per class, named e.g.
   `SPR-backup-2026-fall-P4B.json`, kept until §5's retention window ends.

**Where backups may live:** school-approved storage only (school network
drive, school-issued encrypted USB). The JSON/Excel exports are **unencrypted**
— never on personal cloud drives, personal email, or public computers.
Delete them when no longer needed.

**Restore drill (target: under 30 minutes, test once per term):**
1. On a fresh device open the app → *I use SPR on another device / first-time
   setup* to create a sign-in.
2. Classes screen → *Import class from colleague* → pick the `.sprclass.json`
   → paste the class share link (or key) → **Merge**.
3. Verify: class list, student count, one student's latest scores, one report
   card. If anything looks wrong, *Manage → Safety copies* holds the state
   from before the import.

## 3. Two-teacher exchange (how EAL and CET share a class)

- Every class is its own **AES-GCM encrypted workbook** with its own random
  key. The key travels only in the class share link fragment
  (`#class=…&k=…`) — never to any server.
- **Exchange:** *Share → Download class file* on one device, *Import class
  from colleague* on the other (file via WeChat/DingTalk/USB — the file alone
  is ciphertext). Works with zero internet once both browsers have opened the
  app once.
- **Merge, not overwrite:** one-sided edits are taken automatically; cells
  **both** teachers changed since the last exchange are listed for a decision
  (keep mine / take theirs / add as an observation proposal). Nothing is
  silently overwritten.
- Honest limits: timestamps come from the two computers' clocks; a wildly
  wrong clock can mis-order edits. The audit log records every merge.
- Optional cloud sync (Supabase) covers the same need when reachable; the
  indicator on the Classes screen says *Cloud reachable* / *Cloud
  unreachable — working offline*.

## 4. Liability & warranty (summary — full notice in the app and `notice.html`)

SPR is **provided as is, without warranty**. Grades are computed from
whatever was entered; **teachers must check grades before using them** for
reports or parent communication. The owner is not liable for lost data,
wrong grades, or consequential damage. Students with fewer than 6 of 9
components assessed never receive a final letter grade — report cards show
“Not yet assessed / provisional” instead.

## 5. Data retention & minimisation (PIPL)

- SPR stores the minimum: student ID, Chinese/English name, gender, scores,
  teacher notes. No photos, no contacts, no behavioural tracking, no
  analytics — none ever leaves the page.
- **Retention: two school years**, then a documented purge (delete the class
  from Manage, then delete the backup files; note the purge date and classes
  covered in the school's own record).
- Names + scores of under-14s are **sensitive personal information** under
  PIPL. **Written school approval must be recorded before real student data
  is entered** (Manage → School approval — the app keeps reminding until it
  is set; the demo class is synthetic and needs no approval).
- Cloud sync, when enabled, carries only ciphertext (see §6). If approval is
  withdrawn: turn off Device sync, delete the channel rows in Supabase, and
  purge backups per above.

## 6. Supabase & the embedded key (technical honesty)

`app/index.html` embeds a Supabase **publishable key** (`sb_publishable_…`).
That is by design: publishable keys are public identifiers, like the GitHub
Pages URL itself. Protection comes from **Row Level Security**, not from
hiding the key:

- `spr_channels` rows are readable/writable only through the app's REST calls
  with the `x-spr-write-token` header where configured;
- every payload is AES-GCM ciphertext whose key never leaves the URL
  fragment — Supabase stores an opaque blob, a timestamp and a share name.

If the key is ever abused (quota theft), rotate it in the Supabase dashboard
and ship a new build; teachers can also override it locally via
`localStorage['spr-sb-v1'] = {url, key}` without waiting for a release.
Setup details: `assets/supabase-setup.md`.

## 7. China network reality (GFW)

GitHub Pages, DuckDNS and Supabase are intermittently slow or blocked inside
mainland China. By design this **never breaks the app**:

- the app shell is cached by a service worker → fully offline after first
  open (enter scores, dashboard, report cards, backups all work);
- teacher-to-teacher exchange is a **file**, not a network call;
- cloud features fail gracefully and are visibly labelled offline.

## 8. Change discipline for this repo

- `source/` is the truth; the committed `app/`, `index.html`, `notice.html`
  are **build outputs** — never hand-edit them (`python source/build2.py`
  refuses to clobber silently). CI rebuilds and byte-compares on every push.
- `source/calc.js` math is regression-tested against an independent Python
  implementation — do not change it for cosmetic reasons.
- Every user-visible behaviour change updates `source/notice.en.html` +
  `notice.zh.html` (notice version bump) and this file if it affects
  governance.
