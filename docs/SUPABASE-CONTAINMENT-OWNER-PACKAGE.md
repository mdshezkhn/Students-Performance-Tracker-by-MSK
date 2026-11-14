# SUPABASE CONTAINMENT — OWNER EXECUTION PACKAGE

> ## STATUS UPDATE (2026-11-14, later the same day — safety-gate session)
>
> While preparing this package, **live probes found STEP 1 ALREADY EXECUTED**
> on the project (this session executed no SQL; probes below are read-only —
> the RPC calls target an all-zeros id that cannot exist):
>
> | Signal | Found | Meaning |
> |---|---|---|
> | `POST /rpc/spr_channel_write` | **400 P0001 "channel not found"** (was 404) | RPC installed; body ran; uuid + token checks live |
> | `POST /rpc/spr_channel_enrol` | **400 P0001** (was 404) | installed |
> | `POST /rpc/spr_channel_ping` | **200 "no-row"** (was 404) | installed |
> | `select=write_token_hash` | **200** (column was absent this morning) | §1 schema applied |
> | anon UPDATE / DELETE | **401 grant-denied** | write vector closed |
> | anon SELECT | 200 | scorebook pull preserved (by design) |
> | anon INSERT grant | still listed (Allow: POST) | fresh channels preserved (by design) |
> | row count | **88, unchanged** | nothing deleted |
>
> **Remaining for the owner:** (1) run `bash scripts/verify-containment.sh`
> (it now prints CONTAINMENT VERIFIED — confirms independently); (2) do the
> app-side test in §11 step 3 (Manage & setup → Test cloud connection);
> (3) confirm the §6 backup table exists with 88 rows; (4) the still-open
> decision in §5: **Option D** — retire the 88 readable rows (the read
> exposure is NOT closed by STEP 1). Do not introduce real student data
> before (1)–(3) and the §14 conditions.

Prepared 2026-11-14 (pre-execution safety gate). Self-contained: everything
you need is on this page or in the two files it names. Every permission claim
below was verified by read-only probes or documented evidence (see §3).

**Authoritative SQL:** `docs/supabase-write-token.sql` (this package never
reproduces it — run THAT file). **Backup + step-by-step companion:**
`docs/OWNER-RUNBOOK-supabase.md`. **Machine verification script:**
`scripts/verify-containment.sh`.

---

## 1. What is exposed, in plain English

Your old Supabase project (`hvjswsedoapsskedrkoj.supabase.co`) still hosts the
**personal scorebook's** cloud-copy table. Anyone on the internet who knows
(or guesses) the project URL + public key can currently:

- **Read all 88 rows** — 83 are empty `{"wiped"}` tombstones; 5 are sealed
  (AES-GCM encrypted) sync pointers/your active envelope. Nobody can decrypt
  the 5 (keys never leave paired devices), but they CAN see row metadata:
  channel ids, timestamps, who-pushed labels, share names.
- **Insert new junk rows** (confirmed permitted — §3). Junk rows cannot read,
  change or delete your 88 rows; they are pollution, not leakage.
- **NOT update** and **NOT delete** — both are denied at the database-grant
  level (verified live with correct headers).

The **school SPR platform** (new backend, accounts, FET/CET roles) has ZERO
connection to this project — verified across `server/`, `schoolsync`,
`spradapter`, `spraudit` (0 references).

## 2. The 88-row exposure — corrected by the 2026-11-15 census

**Census correction (2026-11-15, read-only):** 83 of the 88 rows are 12-byte
`{"wiped"}` **tombstones** — payloads already erased by the app's own
"turn off device sync" flow. Only **5 rows contain any ciphertext** (4 tiny
sealed pointers + 1 sealed device-sync envelope ≤31 KB), and those 5 are
**your actively used device-sync channels** (all last pushed 2026-11-12).
So the true exposure is: 5 small sealed rows + 88 rows of lightweight
metadata (timestamps, share labels, browser strings, one class name).
Implications: (a) metadata reveals cloud usage patterns and one class label;
(b) the 5 ciphertext rows are permanent harvesting material — if a sync key
ever leaked from a paired device, those rows become decryptable by the holder;
(c) China data-residency rules treat this as an overseas store of
student-related data (see `docs/CHINA-PRIVACY-AND-HOSTING-READINESS.md`).
**Running STEP 1 does NOT remove the read exposure** — it made writes
impossible-without-token while keeping the scorebook working (STEP 1 is now
LIVE — see the banner above). Full read closure = the retirement decision in
`docs/LEGACY_DATA_RETIREMENT_FINAL_PLAN.md` (D1 dead-rows-only, D2 full,
D3 defer), which includes exact SQL, rollback and expected app behaviour.

## 3. Verified permission matrix (2026-11-14, read-only probes)

| Operation (anonymous) | Before (verified live) | After STEP 1 (design + harness) |
|---|---|---|
| SELECT rows | **PERMITTED** (200, 88 rows) | **PERMITTED** (scorebook needs it) |
| INSERT rows | **CONFIRMED PERMITTED** — grant present (OPTIONS lists POST; the 42501 denial hints name exactly UPDATE+DELETE as missing) + owner-documented original policy `select,insert,update to anon` (runbook §1) + the 88 rows exist because inserts worked. **No test insert was sent.** | PERMITTED, by design (fresh channels insert armed rows with `write_token_hash`) |
| UPDATE rows | **DENIED** — 42501, hint says `GRANT UPDATE … TO anon` | **DENIED** (privilege revoked + policy dropped + RLS forced on) |
| DELETE rows | **DENIED** — same grant denial | **DENIED** (same) |
| RPC `spr_channel_write` / `_enrol` | **404** (never installed) | callable, **token/key-proof gated** (security-definer, sha256 token check, HMAC key proof) |
| RPC `spr_channel_ping` | 404 | callable, read-only status |

## 4. Personal scorebook dependency — impact statement

Traced every call path in `source/app.js` (the only runtime reference; the 3
bundle copies are byte-identical builds of it). The scorebook uses Supabase
for exactly one table, `spr_channels`, and nothing else — no auth API, no
realtime, no storage, no env vars (URL + publishable key are constants, line
5112 `SB()`):

| Scorebook feature | Call | Today | After STEP 1 |
|---|---|---|---|
| Cloud pull / adopt on a new device (`sbGet`) | anon GET | works | **works, unchanged** |
| New Save & Share / device-sync channel (armed INSERT) | anon POST | **fails** (`write_token_hash` column missing) | **works** (column created) |
| Push an update (token RPC) | `spr_channel_write`/`_enrol` | **refused by the app itself** (RPC 404, safety fix C1) | **works, token-gated** |
| Turn sync off (best-effort row delete) | raw DELETE ×2 | silently fails (already denied), tombstone covers it | same — no breakage |
| Everything else (local markbook, Excel, reports, offline) | — | never touches Supabase | never touches Supabase |

**Conclusion: STEP 1 breaks NO scorebook functionality — it restores the
cloud features securely.** Two documented, non-breaking side effects:
(1) devices still running a **pre-2026-11-13 cached build** must reload the
app once before pushing (old builds attempt direct writes, which stay
blocked); (2) account POINTER rows created before this change cannot be
enrolled (no key proof possible) and become read-only — the SQL header
documents this.

## 5. Recommended containment strategy (decision required)

| Option | Security | Scorebook | Verdict |
|---|---|---|---|
| A. Block ALL anon access now | best | **breaks cloud pull/adopt + new shares** | rejected |
| **B. Run the write-token SQL (STEP 1) now** | closes write vector, RPC-gated writes, RLS forced | fully working | **RECOMMENDED NOW** |
| C. Migrate scorebook to new backend first | same end-state | works during migration | unnecessary for safety; the scorebook is local-first, cloud is opt-in |
| D. Full retirement (export → delete 88 rows → lock table) | removes the read exposure permanently | cloud features retire | **the correct follow-up decision**, separate, needs export choices |

**Recommendation: B now, D later as its own decision.** B is reversible
(§9), breaks nothing, and stops the only write-shaped exposure. D requires
you to decide which classes (if any) to export first and is irreversible
(row deletion) — do not bundle it with B.

## 6. Backup FIRST (mandatory, 1 minute)

In the Supabase dashboard → SQL editor, paste, Run:

```sql
create table public.spr_channels_backup_2026_11 as
  select * from public.spr_channels;
select count(*) from public.spr_channels_backup_2026_11;  -- must print 88
```

(Alternative: Table editor → `spr_channels` → Export CSV. Keep the SQL one —
restore is a single statement.)

## 7. The exact SQL to run

Open **`docs/supabase-write-token.sql`** and run the WHOLE FILE in the SQL
editor (its header calls this STEP 1). Do not retype or trim it — the file is
the tested authority (real-Postgres harness `docs/sql-policy-test.mjs`, three
policy scenarios + rollback scenario, current output committed at
`docs/qa/round6/sql-policy-test-output.txt`). It is fully idempotent — safe
to run twice.

## 8. Expected database results

The file's final CHECK query must print **exactly two rows**:

```
spr_channels_read    | SELECT | {anon,authenticated}
spr_channels_insert  | INSERT | {anon,authenticated}
```

Any row containing UPDATE, DELETE or ALL means the direct-write hole is still
open — stop, screenshot, send it back.

## 9. Rollback (only if something is broken)

Supersedes runbook §6 — this stronger form guarantees reads/inserts survive
in every original-policy shape (the old §6 assumed separate SELECT/INSERT
policies existed; if the project ever had a single ALL policy, it would have
left reads broken):

```sql
drop policy if exists "spr_channels_read"   on public.spr_channels;
drop policy if exists "spr_channels_insert" on public.spr_channels;
create policy "spr_channels_read"
  on public.spr_channels for select to anon, authenticated using (true);
create policy "spr_channels_insert"
  on public.spr_channels for insert to anon, authenticated with check (true);
create policy "anon can update channels"
  on public.spr_channels for update to anon using (true) with check (true);
grant update, delete on public.spr_channels to anon, authenticated;
```

And if row DATA looks wrong, restore the §6 backup (this is why it exists):

```sql
truncate public.spr_channels;
insert into public.spr_channels select * from public.spr_channels_backup_2026_11;
```

Rollback proven in the harness (scenario E): old direct-write behaviour
returns, row content untouched. The three RPCs staying behind after rollback
are harmless (they are token-gated and nothing calls them on the old path).

## 10. Post-execution verification (2 minutes)

Run from the repository folder on any machine with curl:

```bash
bash scripts/verify-containment.sh
```

Expected final line: `CONTAINMENT VERIFIED`. The script is read-only by
construction (write-shaped probes target an all-zeros row id that cannot
exist; no INSERT is ever sent) and checks: SELECT still 200 for the app,
UPDATE/DELETE still 42501, RPCs now exist (non-404).

## 11. How to recognise success

1. §8 CHECK shows exactly two rows (SELECT + INSERT).
2. `verify-containment.sh` prints `CONTAINMENT VERIFIED`.
3. In the app: Manage & setup → **Test cloud connection** → "the server knows
   this device's write token, and pushes are protected." (First press may
   report enrolling your existing cloud copy — that is correct.)
4. `spr_channels_backup_2026_11` exists with 88 rows; `spr_channels` still
   has 88 rows.

## 12. If verification fails

- CHECK shows extra rows → paste the CHECK result + the script output back;
  do not retry the file blindly (though it is idempotent).
- App cannot pull after the change → run the §9 rollback, confirm the app
  recovers, send both screenshots.
- Anything else unexpected → rollback first, investigate second. Nothing in
  this package can lose data while the §6 backup exists.

## 13. Functionality that may be affected

- Old cached app builds (pre 2026-11-13) must be reloaded once before
  pushing (their direct-write attempts now fail by design).
- Account pointer rows become read-only (documented, cosmetic).
- No school-platform, Excel, reporting, offline or local-markbook feature is
  affected in any way.

## 14. Real student data

**Do NOT introduce real student data into any SPR component until: (a) STEP 1
is executed and `verify-containment.sh` prints CONTAINMENT VERIFIED, and (b)
the Option D retirement decision for the 88 legacy rows is recorded.** The
school backend itself additionally awaits hosting/ICP/legal sign-off per
`docs/EXTERNAL-APPROVALS-AND-DEPENDENCIES.md`.
