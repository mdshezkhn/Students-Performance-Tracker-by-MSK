# SPR Backend Design — P1 Design Review, rev 2 (still nothing created)

Status: **DESIGN FOR APPROVAL, rev 2** — revised against the owner's items 1–27
(2026-10-23). Direction (Supabase Auth + RLS, free plan) approved **in
principle**; **no database object exists** and none will be created until the
owner says go. All SQL below is design text; nothing has been run.

A change map for items 1–27 is §14.

---

## 0. Scorecard vs the review — reconciled hash + evidence (item 27)

**Review baseline:** the reviewer read the first text export, built from
`main @ 39d829bd`. (A second export was later built at `main @ b99d050` —
"sign-in-anywhere + safety copies + DingTalk/WeChat sharing" — but the
reviewer's findings text corresponds to the first export. Both predate
`p0-baseline`, which branches off `b99d050`; nothing in the verdict changes.)

`p1-classes @ fbe8c01` (P0 + P1 + P1.1 + P1.2; **not merged**) is what exists
today. Every "Fixed" row below carries its test file and the output of a fresh
run on this machine, 2026-10-23:

| ID | Status | Evidence (file → check / summary, run 2026-10-23) |
|----|--------|---------------------------------------------------|
| D1 | **Open** | whole-blob sync on both transports; fixed by §4 (per-cell RPC) |
| D2 | **Open** (client-side class mode exists, agreed-rule only); fixed by §3/§5 |
| D3 | **Open** (anon writes; no SQL in repo — `git ls-files` shows none); fixed by §3 |
| D4 | **Fixed (P1.1)** | `tests/classstore.test.js` → `144 passed, 0 failed` (login-wrap verify, no-hash-in-records checks); `tests/test-class-mode.js` → `ok: stored user records carry a login wrap, no hash` |
| D5 | **Fixed (P0/P1.1)** | `tests/calc-regression.test.js` → `329 passed, 0 failed` (quarantine checks); `tests/test-class-mode.js` → `ok: value 15 quarantined to the review list`, `ok: invalid observation is out of the live cell` |
| D6 | **Mostly fixed (P0/P1.2)** | attribute escaping + import validation in the suites above; CSP narrowed to `*.supabase.co` (P1.2) — single-host narrowing lands in P2 |
| D7 | **Fixed (P0)** | `tests/excel-import.test.js` → `24 passed, 0 failed` (gender 男/女→M/F round-trip) |
| D8 | **Fixed (P0)** | same suite (teacher label scan; real-workbook leg = T2 with the owner-supplied anonymised fixture) |
| D9 | **Fixed (P0)** | toast entities replaced; covered by class-mode UI walk |
| D10 | **Open** → §13: `PROVISIONAL_POLICY` constant; "x of 9" chips already render (`app.js` `nOf9`) |
| D11 | **Fixed (P0)** | CI green from fresh clones: `62 / 329 / 24 / 144 passed, 0 failed` + `ALL DEVICE-SYNC CHECKS PASSED` + `ALL CLASS-MODE CHECKS PASSED` |

Full fresh-run output (this machine, branch `p1-classes @ fbe8c01`):

```text
npm test:  62 passed, 0 failed   (completeness)
           329 passed, 0 failed  (calc-regression)
           24 passed, 0 failed   (excel-import)
           144 passed, 0 failed  (classstore)
jsdom:     ALL DEVICE-SYNC CHECKS PASSED
           ALL CLASS-MODE CHECKS PASSED
spot checks (test-class-mode.js, named):
  ok: under-length admin password rejected at setup
  ok: 11-character teacher password rejected
  ok: 12-character teacher password accepted
  ok: support changed its own password (no admin)
  ok: old password no longer signs in
```

These are claims about `p1-classes`, which the owner has not yet merged or seen
running — the branch is public on GitHub for independent verification.

**Carried forward** (client work that survives): role/pairing/review/audit UI,
migration planner + dry-run UX, quarantine, hashless PBKDF2-600k crypto (reused
as the offline-cache seal), the honest-copy pass, the whole test harness.
**Replaced by this design:** the whole-blob cloud transport (ds*/sb*) → per-record
RemoteStore over RPCs.

---

## 1. Schema (design text; runs only after approval + §12 gates)

Single `app` schema for tables **and** functions (not PostgREST-exposed by
default — see §6/D17 for the thin `public` wrappers the client actually calls).

```sql
create extension if not exists pgcrypto;
create schema if not exists app;

-- 1. profiles: one per Supabase auth user, admin-created (item F20)
create table app.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null,
  display_name text not null default '',
  role         text not null check (role in ('admin','manager','teacher')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index profiles_username_lower on app.profiles (lower(username));  -- item 12b

-- 2. semesters: one class x one term (one imported workbook)
create table app.semesters (
  id         uuid primary key default gen_random_uuid(),
  school     text not null default '',
  class_name text not null,
  name       text not null,
  year       int,
  period     text,
  months     text[] not null default '{}',
  settings   jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,                       -- soft delete only
  created_at timestamptz not null default now()
);
-- item 12a: uniqueness only among LIVE semesters (soft-deleted names reusable)
create unique index semesters_live_ident
  on app.semesters (school, class_name, name, year) where deleted_at is null;

-- 3. assignments: who does what for which class
create table app.assignments (
  user_id     uuid not null references app.profiles(id) on delete cascade,
  semester_id uuid not null references app.semesters(id) on delete cascade,
  duty        text not null check (duty in ('eal','support','team_leader')),
  primary key (user_id, semester_id, duty)
);

-- 4. students: composite PK so cells/reports can reference (semester, student)
create table app.students (
  semester_id uuid not null references app.semesters(id) on delete cascade,
  student_id  text not null,
  name_cn     text not null default '',
  name_en     text not null default '',
  gender      text check (gender in ('M','F')),
  deleted_at  timestamptz,                      -- soft delete only
  primary key (semester_id, student_id)
);

-- 5. score_cells: versioned per-cell rows; NULL value = deliberately cleared (item 11)
create table app.score_cells (
  semester_id uuid not null,
  student_id  text not null,
  kind        text not null check (kind in ('obs','spelling','daily','test')),
  cell_key    text not null,
  value       numeric,                          -- NULL = cleared (distinct from 0)
  version     int not null default 1,
  updated_by  uuid references app.profiles(id),
  updated_at  timestamptz not null default now(),
  primary key (semester_id, student_id, kind, cell_key),
  -- item 10: composite FK keeps cells glued to a real, undeleted-by-FK student row
  foreign key (semester_id, student_id) references app.students(semester_id, student_id) on delete cascade,
  -- item 8: NaN sorts ABOVE all numbers in Postgres, so `value >= 0` alone passes for NaN
  check (value is null or (value <> 'NaN'::numeric and value >= 0 and value <= 1000)),
  check (kind <> 'obs' or value is null or value <= 10),
  -- item 9: cell_key shape per kind (frozen scheme; RPC re-validates)
  check (kind <> 'obs'      or cell_key ~ '^[A-Za-z][A-Za-z ]{0,19}\|(Listening|Speaking|Writing|Reading)-LO[1-2]$'),
  check (kind not in ('spelling','daily') or cell_key ~ '^[A-Za-z][A-Za-z ]{0,19}\|[1-5]\|[st]$'),
  check (kind <> 'test'     or cell_key ~ '^(midterm|oral|written)\|[st]$')
);

-- 6. reports: workflow state machine; submitted_by supports separation of duties (item 5)
create table app.reports (
  semester_id    uuid not null,
  student_id     text not null,
  status         text not null default 'draft' check (status in ('draft','submitted','returned','approved')),
  notes          jsonb not null default '{}'::jsonb,
  version        int not null default 1,
  updated_by     uuid references app.profiles(id),
  submitted_by   uuid references app.profiles(id),
  submitted_at   timestamptz,
  reviewed_by    uuid references app.profiles(id),
  review_comment text,
  updated_at     timestamptz not null default now(),
  primary key (semester_id, student_id),
  foreign key (semester_id, student_id) references app.students(semester_id, student_id) on delete cascade  -- item 10
);

-- 7. audit_log: append-only, trigger-written only
create table app.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_name text,
  tbl        text not null,
  row_key    text not null,
  old        jsonb,
  new        jsonb
);
```

### Cell-key scheme (frozen; client, RPCs and imports must match)

| Kind | Key examples | Meaning |
|------|--------------|---------|
| obs | `March\|Listening-LO1` | skill LO cell, 0–10 |
| spelling / daily | `March\|3\|s`, `March\|3\|t` | week-3 score / total |
| test | `midterm\|s`, `midterm\|t`, `oral\|s`, `written\|s` … | score / total pairs |

Score-vs-total is enforced in the RPC **in both directions** (§4): writing a
score checks the paired total; writing or **lowering a total** checks the paired
existing score (item 7). Suffixes are parsed with an anchored regexp, never
`replace('|s','|t')`.

### Cleared cells (item 11)

`value = NULL` means **cleared** (the teacher deleted the entry): the write
bumps the version, audits old→null, and `Calc` treats NULL exactly as
"not assessed" — excluded from averages and from the "x of 9 components" count.
`0` remains a real, counted zero. This matches the Excel logic today
(`obsValue`/`weeklyMonthPct` already treat null/undefined as absent — verified
by the P0 regression suite).

---

## 2. Helper functions (all `security definer`, pinned `search_path`)

```sql
create or replace function app.my_role() returns text
language sql stable security definer set search_path = app, public as $$
  select role from app.profiles where id = auth.uid() and active
$$;

create or replace function app.has_duty(p_sem uuid, p_duty text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.assignments a
                  join app.profiles p on p.id = a.user_id and p.active
                 where a.user_id = auth.uid() and a.semester_id = p_sem and a.duty = p_duty)
$$;

-- item 19: least-privilege reads. Teachers see ONLY their assigned classes.
create or replace function app.has_school_read() returns boolean
language sql stable security definer set search_path = app, public as $$
  select coalesce((select role in ('admin','manager') from app.profiles where id = auth.uid() and active), false)
$$;

create or replace function app.has_class_read(p_sem uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.has_school_read()
      or exists (select 1 from app.assignments a
                  join app.profiles p on p.id = a.user_id and p.active
                 where a.user_id = auth.uid() and a.semester_id = p_sem)
$$;
```

---

## 3. RLS + privileges (items 13, 14, 19)

**Enable RLS on EVERY table, including `audit_log`** (Supabase SQL-editor
tables do NOT get RLS by default — item 13):

```sql
alter table app.profiles    enable row level security;
alter table app.semesters   enable row level security;
alter table app.assignments enable row level security;
alter table app.students    enable row level security;
alter table app.score_cells enable row level security;
alter table app.reports     enable row level security;
alter table app.audit_log   enable row level security;
```

Gate-verification query (every row must print `t`; goes into the release
checklist — item 13):

```sql
select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'app' and c.relkind = 'r' order by 1;
```

**Grants (item 14).** Supabase default-grants ALL to `anon` and `authenticated`
on new tables — revoked explicitly, then only what is needed is granted back:

```sql
revoke all on app.profiles, app.semesters, app.assignments, app.students,
              app.score_cells, app.reports, app.audit_log from anon, authenticated;

-- reads: authenticated only (RLS still filters rows per item 19)
grant select on app.profiles, app.semesters, app.assignments,
                app.students, app.score_cells, app.reports to authenticated;

-- audit_log: NO direct grant at all (not even select) — admin reads it via
-- app.read_audit() RPC; nobody but triggers writes it:
revoke insert, update, delete on app.audit_log from anon, authenticated;  -- (belt; no grant existed)

-- writes: there are NO table write grants for authenticated.
-- score_cells and reports are RPC-only (items 4, 14); semesters/students/
-- assignments/profiles are managed through admin RPCs.
```

**Read policies (item 19 — teachers see only assigned classes):**

```sql
create policy sem_read   on app.semesters   for select to authenticated using (app.has_class_read(id));
create policy stud_read  on app.students    for select to authenticated using (app.has_class_read(semester_id));
create policy cells_read on app.score_cells for select to authenticated using (app.has_class_read(semester_id));
create policy rep_read   on app.reports     for select to authenticated using (app.has_class_read(semester_id));
create policy asg_read   on app.assignments for select to authenticated
  using (app.has_school_read() or user_id = auth.uid());
create policy prof_read  on app.profiles    for select to authenticated
  using (id = auth.uid() or app.has_school_read());   -- roster names come from RPCs, not wide reads
```

There are **no INSERT/UPDATE/DELETE policies on `score_cells` or `reports`**
(item 4). The earlier `reports_eal_edit` UPDATE policy is **removed**; reports
move exclusively through `save_report_notes` / `submit_report` / `review_report`
(§4b), so `version`, `reviewed_by`, `review_comment`, `submitted_at`,
`submitted_by`, `updated_by`, `semester_id` and `student_id` can never be set
directly by a client. The `guard_report` trigger (§4b) stays as defence in depth.

**Function privileges (item 15).** Functions are executable by `PUBLIC` by
default; after EVERY `create function`:

```sql
revoke execute on function app.f_name(arg types) from public, anon;
grant  execute on function app.f_name(arg types) to authenticated;
-- (public.spr_ping additionally: grant execute to anon;  §8, item 22)
```

Every `security definer` function carries `set search_path = app, public`.

**Audit trigger functions are `security definer`** (item 16) — nobody holds
INSERT on `audit_log`; only the triggers can write it.

---

## 4. `write_cell` — atomic optimistic concurrency (items 1, 2, 7, 8, 9, 10, 11)

No read-then-write. A single `UPDATE ... WHERE version = expected` decides;
row count says who won. New cells: `INSERT ... ON CONFLICT DO NOTHING`.

```sql
create or replace function app.write_cell(
  p_semester uuid, p_student text, p_kind text, p_cell_key text,
  p_value numeric,                 -- NULL = clear the cell (item 11)
  p_expected_version int           -- 0 = "expect the cell to be absent"
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare
  v_row     app.score_cells%rowtype;
  v_partner numeric; v_base text; v_suf text; v_name text; v_cnt int;
begin
  if app.my_role() is null then
    return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;

  -- item 10: refuse writes for soft-deleted students/semesters
  if not exists (select 1 from app.students s join app.semesters m on m.id = s.semester_id
                  where s.semester_id = p_semester and s.student_id = p_student
                    and s.deleted_at is null and m.deleted_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_found_or_deleted'); end if;

  -- duty: obs -> eal; spelling/daily/test -> support
  if not app.has_duty(p_semester, case when p_kind = 'obs' then 'eal' else 'support' end) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  -- item 9: key shape (also a table CHECK; re-checked here for a clean error)
  if not app.valid_cell_key(p_kind, p_cell_key) then
    return jsonb_build_object('ok', false, 'reason', 'bad_key'); end if;

  -- items 8+11: NaN, range, obs cap; NULL allowed (= clear)
  if p_value is not null and
     (p_value = 'NaN'::numeric or p_value < 0 or p_value > 1000
      or (p_kind = 'obs' and p_value > 10)) then
    return jsonb_build_object('ok', false, 'reason', 'out_of_range'); end if;

  -- item 7: score/total pair validated in BOTH directions, suffix parsed anchored
  if p_kind in ('spelling','daily','test') then
    v_base := substring(p_cell_key from '^([A-Za-z][A-Za-z ]{0,19}|(midterm|oral|written))\|[1-5]?$');
    v_suf  := (regexp_match(p_cell_key, '\|([st])$'))[1];
    select value into v_partner from app.score_cells
     where semester_id = p_semester and student_id = p_student and kind = p_kind
       and cell_key = regexp_replace(p_cell_key, '\|[st]$', '')
                      || case when v_suf = 's' then '|t' else '|s' end;
    if v_suf = 's' and p_value is not null and v_partner is not null and p_value > v_partner then
      return jsonb_build_object('ok', false, 'reason', 'out_of_range',
                                'partner_value', v_partner);
    end if;
    -- writing or LOWERING a total must not strand an existing higher score:
    if v_suf = 't' and p_value is not null and v_partner is not null and v_partner > p_value then
      return jsonb_build_object('ok', false, 'reason', 'out_of_range',
                                'partner_value', v_partner);
    end if;
  end if;

  -- item 1: THE atomic update. One statement; no lock window between check and write.
  update app.score_cells
     set value = p_value, version = version + 1, updated_by = auth.uid(), updated_at = now()
   where semester_id = p_semester and student_id = p_student
     and kind = p_kind and cell_key = p_cell_key
     and version = p_expected_version;
  get diagnostics v_cnt = row_count;
  if v_cnt = 1 then
    perform app.auto_return_if_needed(p_semester, p_student);   -- item 6, §4b
    return jsonb_build_object('ok', true, 'version', p_expected_version + 1);
  end if;

  -- 0 rows: either a version conflict, or the row does not exist yet
  select * into v_row from app.score_cells
   where semester_id = p_semester and student_id = p_student
     and kind = p_kind and cell_key = p_cell_key;

  if not found then
    -- expected absent; insert atomically, no PK-violation exceptions (item 1)
    insert into app.score_cells (semester_id, student_id, kind, cell_key, value, version, updated_by)
    values (p_semester, p_student, p_kind, p_cell_key, p_value, 1, auth.uid())
    on conflict (semester_id, student_id, kind, cell_key) do nothing;
    get diagnostics v_cnt = row_count;
    if v_cnt = 1 then
      perform app.auto_return_if_needed(p_semester, p_student);
      return jsonb_build_object('ok', true, 'version', 1);
    end if;
    -- item 2: lost the insert race — return the winner's REAL row, not version 0
    select * into v_row from app.score_cells
     where semester_id = p_semester and student_id = p_student
       and kind = p_kind and cell_key = p_cell_key;
  end if;

  -- item 2: every conflict carries the full current state + display name
  select display_name into v_name from app.profiles where id = v_row.updated_by;
  return jsonb_build_object(
    'ok', false, 'reason', 'conflict',
    'current_value', v_row.value,
    'current_version', v_row.version,
    'updated_by', coalesce(v_name, 'another teacher'),
    'updated_at', v_row.updated_at);
end $$;
```

Companions with the same guarantees: `app.admin_upsert_semester`,
`app.admin_upsert_students(rows)`, `app.admin_import_cells(rows with expected
versions)` returning per-row ok/conflict lists, `app.soft_delete_student` /
`app.soft_delete_semester` (admin; sets `deleted_at` + audit; undo = clear it).

Realtime is enabled on `score_cells` + `reports`; the client subscribes after
sign-in and falls back to a 60 s poll.

---

## 4b. Reports — RPC-only workflow + separation of duties (items 4, 5, 6)

```sql
-- save_report_notes: EAL, status must be draft|returned; version-guarded like cells
-- submit_report:     draft|returned -> submitted, by the assigned EAL; sets submitted_by = auth.uid()
-- review_report(p_decision in ('approved','returned'), p_comment):
--   submitted -> approved|returned, by the assigned team_leader,
--   and  auth.uid() <> r.submitted_by        -- item 5: separation of duties
```

The transition trigger (defence in depth — RPCs are the only client path):

```sql
create or replace function app.guard_report() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  -- item 6: the auto-return path (below) is exempt; it is system-initiated
  if coalesce(current_setting('app.auto_return', true), '0') = '1' then
    return new;
  end if;
  if new.status = old.status then return new; end if;   -- notes-only edit
  if not (
       (old.status in ('draft','returned') and new.status = 'submitted'
        and exists (select 1 from app.assignments a
                     where a.user_id = auth.uid() and a.semester_id = new.semester_id
                       and a.duty = 'eal')
        and new.submitted_by = auth.uid())
    or (old.status = 'submitted' and new.status in ('approved','returned')
        and exists (select 1 from app.assignments a
                     where a.user_id = auth.uid() and a.semester_id = new.semester_id
                       and a.duty = 'team_leader')
        and new.reviewed_by = auth.uid()
        and new.submitted_by is distinct from auth.uid())   -- item 5
  ) then
    raise exception 'illegal report transition % -> % for this user', old.status, new.status;
  end if;
  return new;
end $$;
create trigger reports_guard before update on app.reports
  for each row execute function app.guard_report();
```

**Item 6 decision — score changes under a submitted/approved report: AUTO-RETURN.**
When `write_cell` commits a change (including a clear) for a student whose
report is `submitted` or `approved`, the report is immediately set to
`returned` with `review_comment = 'Automatically returned — scores changed
after submission'`, version bumped, and the event audited:

```sql
create or replace function app.auto_return_if_needed(p_sem uuid, p_stu text) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform set_config('app.auto_return', '1', true);   -- transaction-scoped; guard_report steps aside
  update app.reports
     set status = 'returned', version = version + 1,
         review_comment = 'Automatically returned — scores changed after submission',
         reviewed_by = null, updated_by = auth.uid(), updated_at = now()
   where semester_id = p_sem and student_id = p_stu
     and status in ('submitted','approved');
  perform set_config('app.auto_return', '0', true);
end $$;
```

Rationale (documented, tested in T6): an approved report must always match the
current cells — no locked print can carry stale numbers; the four-state machine
stays frozen (no new 'stale' state); the EAL simply re-edits and resubmits.
Accepted cost: a late single-cell fix forces one re-review. Tested in T6.

---

## 5. Permission matrix (item 19 applied)

| Action | anon | teacher-EAL (assigned) | teacher-SUPPORT (assigned) | team leader (assigned) | manager | admin |
|---|---|---|---|---|---|---|
| Sign in / execute any RPC | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read semesters/students/cells/reports | ✗ | **own classes only** | **own classes only** | own classes | all | all |
| Read profiles (roster) | ✗ | own row | own row | own row | all | all |
| Write obs cells | ✗ | ✓ own classes | ✗ (proposal stays a UI courtesy) | ✗ | ✗ | via import RPC |
| Write spelling/daily/test cells | ✗ | ✗ | ✓ own classes | ✗ | ✗ | via import RPC |
| Clear a cell (NULL) | ✗ | per kind above | per kind above | ✗ | ✗ | via import RPC |
| Edit report notes | ✗ | ✓ while draft/returned | ✗ | ✗ | ✗ | ✗ |
| Submit report | ✗ | ✓ draft/returned→submitted | ✗ | ✗ | ✗ | ✗ |
| Approve / return report | ✗ | ✗ | ✗ | ✓ submitted only, **never their own submission** | ✗ | ✗ |
| Create/deactivate accounts, pair duties | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Import workbook / bulk cells | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Soft-delete semester/student (undo-able) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Read audit log | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (via `read_audit` RPC) |
| Hard delete anything | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (nobody, by policy) |

Every ✗ for authenticated roles is refused **by the server** (RLS / RPC), never
only hidden in the UI.

---

## 6. Client architecture + exact RPC surface (items 17, 19)

The `app` schema is not exposed by PostgREST by default. Decision: **thin
wrappers in `public`** (not adding `app` to Exposed schemas) — the callable
surface stays explicit, one line per function, and nothing in `app` is
accidentally routable:

```sql
create function public.spr_write_cell(p_semester uuid, p_student text, p_kind text,
  p_cell_key text, p_value numeric, p_expected_version int) returns jsonb
language sql security definer set search_path = app, public as $$
  select app.write_cell(p_semester, p_student, p_kind, p_cell_key, p_value, p_expected_version)
$$;
-- same shape for the others; each followed by the item-15 revoke/grant pair.
```

Client calls, exactly:

| Client call | Purpose |
|---|---|
| `supabase.rpc('spr_write_cell', { p_semester, p_student, p_kind, p_cell_key, p_value, p_expected_version })` | one cell write/clear; conflict payload returned (item 2) |
| `supabase.rpc('spr_save_report_notes', { p_semester, p_student, p_notes, p_expected_version })` | draft/returned notes |
| `supabase.rpc('spr_submit_report', { p_semester, p_student, p_expected_version })` | submit |
| `supabase.rpc('spr_review_report', { p_semester, p_student, p_decision, p_comment, p_expected_version })` | approve / return (+ comment) |
| `supabase.rpc('spr_ping')` | keep-alive (anon; §8) |
| admin: `spr_admin_upsert_semester`, `spr_admin_upsert_students`, `spr_admin_import_cells`, `spr_soft_delete_student`, `spr_soft_delete_semester`, `spr_read_audit` | admin ops |

DataStore interface and stores unchanged from rev 1 (`LocalStore` kept; new
`RemoteStore` with persisted offline outbox + conflict dialog; feature flag
`settings.store = 'local' | 'remote'`, default `local`).

---

## 7. Migration (dry-run first, always reversible; item 24)

Unchanged from rev 1 (class-mode planner reused; unresolved observation
proposals are listed as blockers; verification recount + Calc comparison;
nothing local deleted; rollback = flip the flag). One addition: the target is a
**fresh second free project** (item 24) — see §8a.

---

## 8a. Project choice (item 24)

**Fresh second free project** (e.g. `spr-pilot`). The existing project is
untouched and remains the live rollback for the current deployed app until the
new one passes T1–T11 and the gates. Free plan allows 2 active projects; after
verification, pausing/removing the old one is an explicit owner decision.

## 8b. Operations

**Keep-alive (item 22 — service-role GitHub secret REJECTED).** It bypasses all
RLS; it appears nowhere outside the Supabase dashboard. Instead:

1. `public.spr_ping()` — a no-data function executable by **anon** (`select 1`),
   hit by a GitHub Actions cron every 3 days via
   `POST /rest/v1/rpc/spr_ping` with the public anon key.
2. If REST pings turn out not to count as "activity" and the project still
   pauses: a dedicated low-privilege keep-alive auth user (`keepalive@spr.local`,
   strong password, **no profile row** — RLS then blocks every table for it)
   signs in from the workflow with its password in a GitHub secret.
   `T11` (10 quiet days) decides which mechanism ships. Either way: no
   service-role key outside the dashboard.

**Backups / restore / CSP** unchanged from rev 1 (weekly admin export with
reminder; timed restore drill before real data; `connect-src` narrowed to the
single project host).

**Audit-log size + retention (item 23).** One audit row per cell write
(incl. clears) ≈ 0.4–0.5 KB with index bloat. Per class-semester ≈ 23 students
× ~120 cells × ~2 writes (import + term edits) ≈ 5,500 rows ≈ **3 MB**. A
12-class school, 2 semesters/year ≈ **70 MB/year**; retention of current +
previous school year ≈ ~150 MB steady state — comfortably inside the 500 MB
free limit. Purging beyond retention is a dashboard-only (SQL editor) admin op,
run only after an export; documented in the runbook.

---

## 9. Auth + user creation (items 20, 21)

**Item 20 — the real mechanism (a static site cannot call `auth.admin.createUser`
and no SQL function can): pilot = manual dashboard creation.**

1. Admin creates the user in the Supabase dashboard (Authentication → Users →
   Add user): email `zhang.san@spr.local` (synthetic), strong password,
   auto-confirm ON.
2. Admin runs one SQL line in the SQL editor to attach the profile:
   `insert into app.profiles (id, username, display_name, role)
    values ('<auth-uid>', 'zhang.san', 'Zhang San', 'teacher');`
   (lower-username uniqueness enforced, §1).
3. Sign-in is username+password in the app; the client maps
   `username -> username@spr.local` before `supabase.auth.signInWithPassword`.

Password reset: (a) a signed-in teacher changes their own password in-app
(`supabase.auth.updateUser({ password })` — no email involved); (b) a teacher
locked out before first sign-in: the admin recreates the dashboard user and
re-runs the profile line for the new uid (rare; documented). A dedicated Edge
Function holding the service key is the scalable later option — explicitly
**out of pilot scope**.

**Item 21 — verification status: ATTEMPTED, NETWORK-BLOCKED.** On 2026-10-23
from this machine, `supabase.com/docs` fetches failed (`ECONNREFUSED` on
`/docs/guides/auth/auth-email` and `/docs/guides/auth/auth-signup`; timeout on
the platform page). Everything below is therefore **UNVERIFIED FROM HERE** and
must be confirmed once, in the dashboard, by whoever has access (checklist):

| Fact assumed | Where to confirm |
|---|---|
| Synthetic `@spr.local` addresses are accepted | Authentication → Users → Add user (try one) |
| Email confirmation can be off / auto-confirm users | Authentication → Sign In / Up → "Confirm email" OFF |
| Minimum password length is configurable (raise to 12) | Authentication → Settings → Password requirements |
| Sign-in rate limits + lockout behaviour | Authentication → Settings → Rate limits |
| Exact wording of the above | docs pages `/docs/guides/auth/auth-email`, `/docs/guides/auth/auth-signup` |

The app enforces its own floors regardless (12 teachers / 14 admin+manager,
P1.1/P1.2, tested); the dashboard setting is the backstop.

---

## 10. Test mapping (T1–T11) — additions per this review

| # | Additions in rev 2 |
|---|---|
| T1 | anonymised numeric fixture **supplied by the owner** (S01–S23, no names/IDs, item 25); my synthetic fixture remains a CI smoke |
| T4 | item 18: anon token reads nothing on every table AND cannot execute any function; teacher A cannot write teacher B's class; `audit_log` unreadable except admin and unforgeable (no client insert path) |
| T5 | item 3: **two parallel transactions on the same cell — exactly one `ok`, one `conflict`** (plus the insert race); D1 hours-signed-in replay |
| T6 | item 5: submitter cannot approve/return their own report; item 6: score change auto-returns submitted/approved reports; full Draft→Submitted→Returned(+comment)→Submitted→Approved walk; approved locked |
| T7 | soft-delete refusal for writes (item 10) + admin undo + audit rows |
| T11 | decides keep-alive mechanism (item 22) |

T2/T3/T8/T9/T10 unchanged from rev 1 (T2 runs against the owner's fixture; T3
gains the RPC `out_of_range` legs incl. the total-lowering case).

---

## 11. D10 policy (item 26)

Confirmed pending the teacher's final OK: keep the Excel-compatible final
number; cards and screens show the **evidence average** and **"x of 9
components"** beside any provisional grade; one `PROVISIONAL_POLICY` constant
in `calc.js` drives all three surfaces (no scattered literals).

---

## 12. Gates before ANY SQL runs (owner actions — item I)

1. **Written school approval** for hosting student names and scores on a server
   outside the school.
2. **Reachability test** of the Supabase project host from the school network
   (and a phone), cold-load recorded.
3. **Teacher approves this revised doc.**

Until all three: no schema, no project changes, no P2 code that talks to
Supabase. (Item 24's fresh project is also only *created* after gate 3.)

---

## 13. Decisions still open

1. Teacher's final OK on D10 wording (§11).
2. Keep-alive mechanism confirmed by T11 (§8b).
3. Merge order for the existing branches (`p0-baseline` → `p1-classes` → main)
   — independent of this doc, still awaiting the owner's go.

---

## 14. Change map — owner items 1–27

| # | Where in rev 2 |
|---|---|
| 1 | §4 `write_cell`: atomic `UPDATE ... WHERE version = expected` + `row_count`; `INSERT ... ON CONFLICT DO NOTHING` |
| 2 | §4: every conflict payload carries `current_value`, `current_version`, `updated_by` (display name), `updated_at` — incl. the lost-insert-race case |
| 3 | §10 T5: parallel-transaction leg |
| 4 | §3: `reports_eal_edit` removed; reports RPC-only; no table write grants; client cannot set protected columns |
| 5 | §4b: `guard_report` rewritten with EXISTS; `reviewed_by <> submitted_by` separation; T6 leg |
| 6 | §4b: **auto-return** decision, mechanism, rationale; T6 leg |
| 7 | §4: total writes/lowerings validated against the existing score; anchored suffix parse |
| 8 | §1 checks + §4 RPC: `value <> 'NaN'`, upper bound 1000, obs ≤ 10 |
| 9 | §1 table CHECKs + §4 `valid_cell_key` per kind (frozen scheme) |
| 10 | §1 composite FKs; §4 soft-delete write refusal; T7 |
| 11 | §1/§4: `value` nullable = cleared (version bump + audit); Calc treatment documented |
| 12 | §1: partial unique index `where deleted_at is null`; `lower(username)` unique |
| 13 | §3: RLS enabled on every table incl. `audit_log`; verification query in the gate |
| 14 | §3: revoke-all from anon, minimal grants, `audit_log` insert revoked (trigger-only) |
| 15 | §3: per-function revoke from PUBLIC/anon, grant to authenticated; pinned `search_path` |
| 16 | §3: audit triggers `security definer` |
| 17 | §6: `app` schema + thin `public.spr_*` wrappers; exact `supabase.rpc()` names |
| 18 | §10 T4: anon/nothing, cross-class refusal, audit unreadable + unforgeable |
| 19 | §2/§3/§5: teachers read assigned classes only; manager/admin all |
| 20 | §9: dashboard-manual creation + SQL profile line; reset paths; Edge Function deferred |
| 21 | §9: verification attempted, network-blocked; UNVERIFIED table + dashboard checklist |
| 22 | §8b: service-role GH secret REJECTED; anon `spr_ping` OR low-priv keep-alive user; T11 decides |
| 23 | §8b: ~3 MB/class-semester, ~150 MB steady state, retention + purge policy |
| 24 | §8a: fresh second free project; existing untouched as rollback |
| 25 | §10 T1: owner-supplied anonymised fixture; no real data requested anywhere |
| 26 | §11: D10 constant + evidence average + x-of-9 |
| 27 | §0: review hash reconciled (`39d829bd`); evidence table with test names + fresh outputs |
