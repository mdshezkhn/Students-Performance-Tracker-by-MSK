# OWNER RUNBOOK — making the SPR cloud copy safe to write

> ## DO NOT RUN until the reviewer says so.
> This runbook touches the real Supabase project. Everything here is
> copy-paste: open the Supabase dashboard, SQL editor, paste, Run, and copy
> the result back the way each step says. If any step shows something you
> did not expect, stop and send the reviewer a screenshot.

You will do six things, in order. Steps 1 and 2 are safe reads and a backup.
Step 4 is the one that changes how the cloud table accepts writes.

---

## 1. Before: show me what is there now (safe, read-only)

Paste this in the SQL editor, Run, and send me the output:

```sql
select case
         when share_name = 'ds-ptr' then 'pointer row (device-sync bootstrap)'
         when payload ? 'sprDS' then 'account channel (device sync)'
         when payload ? 'spr' then 'share channel (Save & Share)'
         else 'other'
       end as kind,
       count(*) as rows
from public.spr_channels group by 1 order by 2 desc;
```

and this one:

```sql
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'spr_channels'
order by policyname;
```

Example of what the first query returns (from our test database):

```
  pointer row (device-sync bootstrap): 1
  account channel (device sync): 1
  share channel (Save & Share): 1
```

The second shows every policy. Expected on our project before the change:
one row with `UPDATE` in it (that is the hole we are closing), plus `SELECT`
and `INSERT`.

## 2. Backup first (safe)

Paste, Run:

```sql
create table public.spr_channels_backup_2026_10_30 as
  select * from public.spr_channels;
```

Then check it worked (should print the same row count as step 1's total):

```sql
select count(*) from public.spr_channels_backup_2026_10_30;
```

If anything goes wrong later, this puts every row back exactly as it was:

```sql
truncate public.spr_channels;
insert into public.spr_channels select * from public.spr_channels_backup_2026_10_30;
```

(Alternative: dashboard → Table editor → `spr_channels` → Export CSV. The
SQL backup is better because the restore is one statement.)

## 3. Decision: pointer rows

Look at step 1's first output.

- If there is **no** "pointer row" line: go straight to step 4. Nothing to do.
- If there **is** a pointer row (some teacher once used "I use SPR on another
  device" with an OLD password), paste and Run:

```sql
delete from spr_channels where share_name='ds-ptr';
```

Then tell those teachers: **"reset your password once on a school computer"**
(sign in → Manage & setup → Change password). That rebuilds what the pointer
was doing. Nothing else is affected.

## 4. Run the upgrade

The three steps from the top of `docs/supabase-write-token.sql`:

1. **STEP 1.** Open `docs/supabase-write-token.sql`, copy the WHOLE file,
   paste in the SQL editor, Run. Expected: "Success. No rows returned"
   (or similar). Any red error: stop, screenshot, send it to me.
2. **STEP 2.** Open SPR as the admin on your main computer. Manage & setup.
3. **STEP 3.** Press **Test cloud connection**. Expected, in these words:
   "Cloud connection works: the server knows this device's write token, and
   pushes are protected." — or "...was enrolled just now", which is also
   correct: that was the app arming your existing cloud copy by itself.

Then paste me the result of the CHECK query that sits at the bottom of the
SQL file. It must show **only SELECT and INSERT rows**, like this:

```
 policyname           | cmd
----------------------+--------
 spr_channels_insert  | INSERT
 spr_channels_read    | SELECT
```

Any row that says UPDATE, DELETE or ALL means the hole is still open: send me
the screenshot.

## 5. After: smoke test in the app (5 minutes)

1. Sign in as the admin on your computer. Change one score. The dashboard
   number moves.
2. Manage & setup → **Test cloud connection**: says it works.
3. Open the share link for one class on a SECOND browser (a different
   computer or a private window), press Open shared copy, edit a different
   score, press **Save & Share**.
4. Back on your computer: press Save & Share again, then reload. Both edits
   are there, and the app asked before replacing anything.

## 6. Rollback (only if something is broken)

Paste, Run — this puts the table back to exactly the old behaviour:

```sql
drop policy if exists "spr_channels_read" on public.spr_channels;
drop policy if exists "spr_channels_insert" on public.spr_channels;
create policy "anon can update channels"
  on public.spr_channels for update to anon using (true) with check (true);
grant update, delete on public.spr_channels to anon, authenticated;
```

And if rows look wrong, restore from step 2's backup (the truncate +
insert pair). Data damage is recoverable; this was proven in our test
harness, scenario E: after the rollback the old direct write works again and
the row content is untouched.

## 7. Repair a stale cloud row (added 2026-11-12)

**When you need this:** Manage & setup shows "Last cloud save: —", **Check
for newer copy** says *"failed its integrity check (wrong pairing key…)"*,
and **Test cloud connection** says *"no write token enrolled yet"* even after
making a change. That means the cloud row was written by a different/older
device-sync setup (in our case the 2026-10-31 QA test rig), so this device's
key cannot open it and the server refuses to let anyone re-arm it. The app
cannot fix this by design (that protection is the point) — the owner clears
the one bad row here, and the app rebuilds it on the next change. Nothing on
your computer is touched.

**Step 1 — look at the stale row (safe, read-only).** Paste, Run:

```sql
select id, pushed_by, pushed_at, write_token_hash, share_name
from public.spr_channels
where share_name = 'devicesync'
order by pushed_at desc nulls last
limit 10;
```

You are looking for your username's row: `pushed_by` ends with your admin
name and the date is old (the stale one is `f7e8f917-b48f-491e-90f5-17cacde78de2`,
pushed by `test: Mo` on 2026-10-31). Rows ending in `qa-cleanup` / `turned off`
are old test leftovers — leave them alone unless you want to tidy up later.

**Step 2 — back up first (safe).** Paste, Run:

```sql
create table public.spr_channels_backup_2026_11_12 as
  select * from public.spr_channels;
```

Check it worked (should print the full row count):

```sql
select count(*) from public.spr_channels_backup_2026_11_12;
```

**Step 3 — delete ONLY the stale row.** Paste, Run (one row disappears):

```sql
delete from public.spr_channels
where id = 'f7e8f917-b48f-491e-90f5-17cacde78de2';
```

**Step 4 — in SPR (main computer, admin):**
1. Manage & setup → Device sync → **Turn off** (NOT "Turn off & delete").
2. **Turn on device sync** → confirm. Wait for "cloud copy saved".
3. Make a small change (move any score by 1 and back). Manage & setup →
   **Last cloud save** must now show a fresh time.
4. **Test cloud connection** must say: *"Cloud connection is good: the server
   knows this device's write token, and pushes are protected."*
5. Users page → **Enable anywhere** on each teacher/manager row (type their
   password once) — that is what lets them sign in on any other device.

If anything shows something you did not expect: screenshot, stop, don't
improvise. The backup from step 2 puts everything back.
