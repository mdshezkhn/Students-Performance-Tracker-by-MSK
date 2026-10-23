# SPR Backend Design — P1 Design Review, rev 3 (still nothing created)

Status: **DESIGN FOR APPROVAL, rev 3** — direction (Supabase Auth + RLS, free
plan) approved in principle; **no database object exists** and nothing will be
run until the owner says go. All SQL is design text.

Change maps: §15 (rev 2, items 1–27), §16 (rev 3, items 1–9).

---

## 0. Scorecard vs the review — reconciled hash + evidence (rev-2 item 27)

Unchanged from rev 2. **Review baseline:** first text export, `main @ 39d829bd`
(a later export at `b99d050` postdates the findings text; both predate
`p0-baseline`). **What exists today:** `p1-classes @ fbe8c01` (P0 + P1 + P1.1 +
P1.2, not merged; public on GitHub for independent verification).

| ID | Status | Evidence (file → check / summary, run 2026-10-23) |
|----|--------|---------------------------------------------------|
| D1 | **Open** | whole-blob sync on both transports; fixed by §4 (per-cell RPC + version) |
| D2 | **Open** (client-side class mode exists, agreed-rule only); fixed by §3/§5 |
| D3 | **Open** (anon writes; no SQL in repo — `git ls-files` shows none); fixed by §3 |
| D4 | **Fixed (P1.1)** | `tests/classstore.test.js` → `144 passed, 0 failed`; `tests/test-class-mode.js` → `ok: stored user records carry a login wrap, no hash` |
| D5 | **Fixed (P0/P1.1)** | `tests/calc-regression.test.js` → `329 passed, 0 failed`; `ok: value 15 quarantined to the review list` |
| D6 | **Mostly fixed (P0/P1.2)** | attribute escaping + import validation in the suites; single-host CSP lands in P2 |
| D7 | **Fixed (P0)** | `tests/excel-import.test.js` → `24 passed, 0 failed` (gender 男/女→M/F round-trip) |
| D8 | **Fixed (P0)** | same suite (teacher label scan; real-workbook leg = T2, owner fixture) |
| D9 | **Fixed (P0)** | toast entities replaced; covered by class-mode UI walk |
| D10 | **Open** → §11 (`PROVISIONAL_POLICY`; "x of 9" chips already render) |
| D11 | **Fixed (P0)** | CI green from fresh clones: `62/329/24/144 passed, 0 failed` + both jsdom suites ALL PASSED |

**Carried forward:** role/pairing/review/audit UI, migration planner, quarantine,
PBKDF2-600k crypto (→ offline-cache seal), honest-copy pass, test harness.
**Replaced:** the whole-blob cloud transport → per-record RemoteStore over the
RPC surface in §6.

---

## 1. Schema (design text; runs only after approval + §12 gates)

Single `app` schema for tables **and** functions. `app` is **not** added to
PostgREST's Exposed schemas — the HTTP surface is explicit: `public` views for
reads, `public.spr_*` wrappers for writes (§6, rev-3 item 1).

```sql
create extension if not exists pgcrypto;
create schema if not exists app;

-- 1. profiles: one per Supabase auth user (created by the admin script, §9)
create table app.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null,
  display_name text not null default '',
  role         text not null check (role in ('admin','manager','teacher')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index profiles_username_lower on app.profiles (lower(username));

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
-- rev-3 item 6b: NULL years must not escape uniqueness (NULLs are distinct in
-- a plain unique index). Sentinel -1: real years are >= 2000.
create unique index semesters_live_ident
  on app.semesters (school, class_name, name, coalesce(year, -1))
  where deleted_at is null;

-- 3. assignments: who does what for which class
create table app.assignments (
  user_id     uuid not null references app.profiles(id) on delete cascade,
  semester_id uuid not null references app.semesters(id) on delete cascade,
  duty        text not null check (duty in ('eal','support','team_leader')),
  primary key (user_id, semester_id, duty)
);

-- 4. students: composite PK so cells/reports/proposals reference the pair
create table app.students (
  semester_id uuid not null references app.semesters(id) on delete cascade,
  student_id  text not null,
  name_cn     text not null default '',
  name_en     text not null default '',
  gender      text check (gender in ('M','F')),
  deleted_at  timestamptz,                      -- soft delete only
  primary key (semester_id, student_id)
);

-- 5. score_cells: versioned per-cell rows; NULL value = deliberately cleared
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
  foreign key (semester_id, student_id) references app.students(semester_id, student_id) on delete cascade,
  -- NaN sorts ABOVE all numbers in Postgres, so `value >= 0` alone passes for NaN
  check (value is null or (value <> 'NaN'::numeric and value >= 0 and value <= 1000)),
  check (kind <> 'obs' or value is null or value <= 10),
  -- key shape per kind (frozen scheme; app.valid_cell_key re-checks, §4)
  check (kind <> 'obs'      or cell_key ~ '^[A-Za-z][A-Za-z ]{0,19}\|(Listening|Speaking|Writing|Reading)-LO[1-2]$'),
  check (kind not in ('spelling','daily') or cell_key ~ '^[A-Za-z][A-Za-z ]{0,19}\|[1-5]\|[st]$'),
  check (kind <> 'test'     or cell_key ~ '^(midterm|oral|written)\|[st]$')
);

-- 6. reports: workflow state machine; submitted_by supports separation of duties
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
  foreign key (semester_id, student_id) references app.students(semester_id, student_id) on delete cascade
);

-- 7. proposals: server-side observation approvals (rev-3 item 2; mirrors the
--    client class-mode rule: support proposes, the paired EAL decides)
create table app.proposals (
  id              uuid primary key default gen_random_uuid(),
  semester_id     uuid not null,
  student_id      text not null,
  cell_key        text not null,                -- obs keys only
  current_value   numeric,                      -- captured at proposal time
  current_version int not null,                 -- captured at proposal time
  proposed_value  numeric not null,
  check (proposed_value >= 0 and proposed_value <= 10 and proposed_value <> 'NaN'::numeric),
  note            text not null default '',
  requested_by    uuid not null references app.profiles(id),
  requested_at    timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by      uuid references app.profiles(id),
  decided_at      timestamptz,
  decide_note     text not null default '',
  check (status = 'pending' or decided_by is not null),   -- decided implies a decider
  foreign key (semester_id, student_id) references app.students(semester_id, student_id) on delete cascade
);

-- 8. audit_log: append-only, trigger-written only (no client path at all)
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

The RPC also validates the **month prefix against `semesters.months`** for
obs/spelling/daily keys (typos like `Mrach|…` are rejected, not silently new).

### Cleared cells

`value = NULL` = **cleared**: version bump, audited old→null; `Calc` treats NULL
exactly as "not assessed" (excluded from averages and the x-of-9 count); `0` is
a real, counted zero. Matches today's verified `obsValue`/`weeklyMonthPct`
behaviour (P0 regression suite).

---

## 2. Helper functions

All `security definer`, `set search_path = app, public`, EXECUTE revoked from
`public`/`anon` and **not** granted to `authenticated` (they run inside definer
functions as the owner; only §6 entry points get caller grants).

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

-- rev-3 item 3: full key validation (shape per kind)
create or replace function app.valid_cell_key(p_kind text, p_key text) returns boolean
language sql immutable strict set search_path = app, public as $$
  select case p_kind
    when 'obs'      then p_key ~ '^[A-Za-z][A-Za-z ]{0,19}\|(Listening|Speaking|Writing|Reading)-LO[1-2]$'
    when 'spelling' then p_key ~ '^[A-Za-z][A-Za-z ]{0,19}\|[1-5]\|[st]$'
    when 'daily'    then p_key ~ '^[A-Za-z][A-Za-z ]{0,19}\|[1-5]\|[st]$'
    when 'test'     then p_key ~ '^(midterm|oral|written)\|[st]$'
    else false end
$$;
```

---

## 3. RLS + privileges

**RLS on EVERY table, including `audit_log` and `proposals`** (SQL-editor
tables do NOT get RLS by default):

```sql
alter table app.profiles    enable row level security;
alter table app.semesters   enable row level security;
alter table app.assignments enable row level security;
alter table app.students    enable row level security;
alter table app.score_cells enable row level security;
alter table app.reports     enable row level security;
alter table app.proposals   enable row level security;
alter table app.audit_log   enable row level security;
```

Gate-verification query (every row must print `t`):

```sql
select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'app' and c.relkind = 'r' order by 1;
```

**Grants.** Supabase default-grants ALL to `anon`/`authenticated` on new
tables — revoked first, then the minimum back:

```sql
revoke all on app.profiles, app.semesters, app.assignments, app.students,
              app.score_cells, app.reports, app.proposals, app.audit_log
  from anon, authenticated;

-- rev-3 item 1: USAGE lets the INVOKER views/wrappers in public resolve app.*
-- (PostgREST HTTP routing ignores non-exposed schemas — this grant is an
-- in-SQL privilege, NOT an exposure)
grant usage on schema app to authenticated;

-- reads: only through the public.v_* views (§6); RLS still filters rows
grant select on app.profiles, app.semesters, app.assignments,
                app.students, app.score_cells, app.reports, app.proposals
  to authenticated;

-- audit_log: NO grant of any kind — admin reads via spr_read_audit (§4d);
-- only the definer audit triggers write it
```

**Read policies (teachers see assigned classes only):**

```sql
create policy sem_read   on app.semesters   for select to authenticated using (app.has_class_read(id));
create policy stud_read  on app.students    for select to authenticated using (app.has_class_read(semester_id));
create policy cells_read on app.score_cells for select to authenticated using (app.has_class_read(semester_id));
create policy rep_read   on app.reports     for select to authenticated using (app.has_class_read(semester_id));
create policy prop_read  on app.proposals   for select to authenticated using (app.has_class_read(semester_id));
create policy asg_read   on app.assignments for select to authenticated
  using (app.has_school_read() or user_id = auth.uid());
create policy prof_read  on app.profiles    for select to authenticated
  using (id = auth.uid() or app.has_school_read());
```

**No INSERT/UPDATE/DELETE policies on `score_cells`, `reports` or
`proposals`** — they are RPC-only, so `version`, `submitted_by`,
`reviewed_by`, `review_comment`, `decided_by`, `updated_by`, ids and keys can
never be set by a client. `guard_report` (§4b) stays as defence in depth.

**Function privileges:** after EVERY `create function`,

```sql
revoke execute on function app.<f>(<arg types>) from public, anon;
```

plus `grant execute … to authenticated` **only** for the §6 entry points
(`write_cell`, `save_report_notes`, `submit_report`, `review_report`,
`propose_cell`, `decide_proposal`, `read_audit`, the `admin_*` RPCs).
Helpers (§2) and triggers get no caller grants. `public.spr_ping` additionally
grants `anon` (§8b). Every `security definer` function pins
`set search_path`.

**Realtime** (client refresh): add the two hot tables to the publication —
`alter publication supabase_realtime add table app.score_cells, app.reports;`
— client subscribes with `{ schema: 'app', table: 'score_cells' }`; Realtime
applies the same RLS to delivery; fallback poll stays 60 s.

---

## 4. `write_cell` — advisory lock + atomic versioned write

Concurrency design (rev-3 items 4, 5 + rev-2 items 1–2):

1. **Transaction advisory lock** on `hashtext(semester|student|kind)` before
   any pair read — serializes writers to the same score/total pair (and the
   same student's kind), so the score-vs-total check cannot race.
2. **No-op detection**: writing the value the cell already holds
   (`IS NOT DISTINCT FROM`) is an idempotent `ok` — no version bump, no audit
   row, **no auto-return** (rev-3 item 4).
3. **Real change**: single `UPDATE … WHERE version = expected` +
   `get diagnostics row_count` decides; new cells via
   `INSERT … ON CONFLICT DO NOTHING` + row_count. No raw PK exceptions.
4. Every conflict path returns `current_value`, `current_version`,
   `updated_by` **display name**, `updated_at`.

The duty gate lives in `write_cell` (teacher path); `write_cell_impl` carries
the shared logic and an `p_admin` flag used by `admin_import_cells` (skips
duty — the matrix's "via import RPC" — but keeps every range/key/version rule
and auto-return).

```sql
create or replace function app.write_cell(
  p_semester uuid, p_student text, p_kind text, p_cell_key text,
  p_value numeric,                 -- NULL = clear the cell
  p_expected_version int           -- 0 = "expect the cell to be absent"
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
begin
  if app.my_role() is null then
    return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if not app.has_duty(p_semester, case when p_kind = 'obs' then 'eal' else 'support' end) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return app.write_cell_impl(p_semester, p_student, p_kind, p_cell_key,
                             p_value, p_expected_version, false);
end $$;

create or replace function app.write_cell_impl(
  p_semester uuid, p_student text, p_kind text, p_cell_key text,
  p_value numeric, p_expected_version int, p_admin boolean
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare
  v_row app.score_cells%rowtype;
  v_partner numeric; v_suf text; v_name text; v_cnt int;
  v_months text[]; v_changed boolean;
begin
  -- refuse writes for soft-deleted students/semesters
  select m.months into v_months from app.students s join app.semesters m on m.id = s.semester_id
   where s.semester_id = p_semester and s.student_id = p_student
     and s.deleted_at is null and m.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found_or_deleted'); end if;

  -- key shape (table CHECK echoes this)
  if not app.valid_cell_key(p_kind, p_cell_key) then
    return jsonb_build_object('ok', false, 'reason', 'bad_key'); end if;
  -- month prefix must be a known month of this semester (obs/spelling/daily)
  if p_kind in ('obs','spelling','daily') and coalesce(array_length(v_months,1),0) > 0
     and split_part(p_cell_key,'|',1) <> all(v_months) then
    return jsonb_build_object('ok', false, 'reason', 'bad_key'); end if;

  -- NaN, range, obs cap (NULL allowed = clear)
  if p_value is not null and
     (p_value = 'NaN'::numeric or p_value < 0 or p_value > 1000
      or (p_kind = 'obs' and p_value > 10)) then
    return jsonb_build_object('ok', false, 'reason', 'out_of_range'); end if;

  -- rev-3 item 5: serialize the pair BEFORE reading the sibling cell
  perform pg_advisory_xact_lock(
    hashtextextended(p_semester::text || '|' || p_student || '|' || p_kind, 0));

  -- score/total pair, validated in BOTH directions (suffix parsed anchored)
  if p_kind in ('spelling','daily','test') then
    v_suf := (regexp_match(p_cell_key, '\|([st])$'))[1];
    select value into v_partner from app.score_cells
     where semester_id = p_semester and student_id = p_student and kind = p_kind
       and cell_key = regexp_replace(p_cell_key, '\|[st]$', '')
                      || case when v_suf = 's' then '|t' else '|s' end;
    if v_suf = 's' and p_value is not null and v_partner is not null and p_value > v_partner then
      return jsonb_build_object('ok', false, 'reason', 'out_of_range', 'partner_value', v_partner);
    end if;
    -- writing or LOWERING a total must not strand a higher existing score
    if v_suf = 't' and p_value is not null and v_partner is not null and v_partner > p_value then
      return jsonb_build_object('ok', false, 'reason', 'out_of_range', 'partner_value', v_partner);
    end if;
  end if;

  select * into v_row from app.score_cells
   where semester_id = p_semester and student_id = p_student
     and kind = p_kind and cell_key = p_cell_key;

  if found then
    -- rev-3 item 4: same value (incl. both null) = idempotent no-op
    if v_row.value is not distinct from p_value then
      return jsonb_build_object('ok', true, 'version', v_row.version, 'noop', true); end if;
    if v_row.version <> p_expected_version then
      select display_name into v_name from app.profiles where id = v_row.updated_by;
      return jsonb_build_object('ok', false, 'reason', 'conflict',
        'current_value', v_row.value, 'current_version', v_row.version,
        'updated_by', coalesce(v_name,'another teacher'), 'updated_at', v_row.updated_at);
    end if;
    update app.score_cells
       set value = p_value, version = version + 1, updated_by = auth.uid(), updated_at = now()
     where semester_id = p_semester and student_id = p_student
       and kind = p_kind and cell_key = p_cell_key and version = p_expected_version;
    get diagnostics v_cnt = row_count;
    if v_cnt = 1 then
      perform app.auto_return_if_needed(p_semester, p_student);   -- value DID change (item 4)
      return jsonb_build_object('ok', true, 'version', p_expected_version + 1);
    end if;
    -- belt under the advisory lock: re-read and answer as a conflict
  else
    -- absent: a "clear" of nothing is a no-op, not a row
    if p_value is null then
      return jsonb_build_object('ok', true, 'version', 0, 'noop', true); end if;
    insert into app.score_cells (semester_id, student_id, kind, cell_key, value, version, updated_by)
    values (p_semester, p_student, p_kind, p_cell_key, p_value, 1, auth.uid())
    on conflict (semester_id, student_id, kind, cell_key) do nothing;
    get diagnostics v_cnt = row_count;
    if v_cnt = 1 then
      perform app.auto_return_if_needed(p_semester, p_student);   -- absent -> value is a change
      return jsonb_build_object('ok', true, 'version', 1);
    end if;
    -- lost the insert race: fall through as a conflict with the winner's row
  end if;

  select * into v_row from app.score_cells
   where semester_id = p_semester and student_id = p_student
     and kind = p_kind and cell_key = p_cell_key;
  select display_name into v_name from app.profiles where id = v_row.updated_by;
  return jsonb_build_object('ok', false, 'reason', 'conflict',
    'current_value', v_row.value, 'current_version', v_row.version,
    'updated_by', coalesce(v_name,'another teacher'), 'updated_at', v_row.updated_at);
end $$;
```

---

## 4b. Reports — RPC-only workflow + separation of duties

```sql
create or replace function app.save_report_notes(
  p_semester uuid, p_student text, p_notes jsonb, p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare r app.reports%rowtype; v_cnt int; v_name text;
begin
  if app.my_role() is null then return jsonb_build_object('ok',false,'reason','inactive'); end if;
  if not app.has_duty(p_semester,'eal') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select * into r from app.reports where semester_id = p_semester and student_id = p_student;
  if not found then
    if p_expected_version <> 0 then
      return jsonb_build_object('ok',false,'reason','not_found');
    end if;
    insert into app.reports (semester_id, student_id, status, notes, updated_by)
    values (p_semester, p_student, 'draft', p_notes, auth.uid())
    on conflict (semester_id, student_id) do nothing;
    get diagnostics v_cnt = row_count;
    if v_cnt = 1 then return jsonb_build_object('ok',true,'version',1); end if;
  else
    if r.status not in ('draft','returned') then
      return jsonb_build_object('ok',false,'reason','locked','current_status',r.status); end if;
    if r.version <> p_expected_version then
      select display_name into v_name from app.profiles where id = r.updated_by;
      return jsonb_build_object('ok',false,'reason','conflict','current_status',r.status,
        'current_version',r.version,'updated_by',coalesce(v_name,'another teacher'),'updated_at',r.updated_at);
    end if;
    update app.reports set notes = p_notes, version = version + 1,
           updated_by = auth.uid(), updated_at = now()
     where semester_id = p_semester and student_id = p_student and version = p_expected_version;
    get diagnostics v_cnt = row_count;
    if v_cnt = 1 then return jsonb_build_object('ok',true,'version',p_expected_version+1); end if;
  end if;
  select * into r from app.reports where semester_id = p_semester and student_id = p_student;
  select display_name into v_name from app.profiles where id = r.updated_by;
  return jsonb_build_object('ok',false,'reason','conflict','current_status',r.status,
    'current_version',r.version,'updated_by',coalesce(v_name,'another teacher'),'updated_at',r.updated_at);
end $$;

create or replace function app.submit_report(
  p_semester uuid, p_student text, p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare r app.reports%rowtype; v_cnt int; v_name text;
begin
  if app.my_role() is null then return jsonb_build_object('ok',false,'reason','inactive'); end if;
  if not app.has_duty(p_semester,'eal') then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select * into r from app.reports where semester_id = p_semester and student_id = p_student
   for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if r.status not in ('draft','returned') then
    return jsonb_build_object('ok',false,'reason','bad_state','current_status',r.status); end if;
  if r.version <> p_expected_version then
    select display_name into v_name from app.profiles where id = r.updated_by;
    return jsonb_build_object('ok',false,'reason','conflict','current_status',r.status,
      'current_version',r.version,'updated_by',coalesce(v_name,'another teacher'),'updated_at',r.updated_at);
  end if;
  update app.reports set status = 'submitted', version = version + 1,
         submitted_by = auth.uid(), submitted_at = now(),
         reviewed_by = null, review_comment = null,
         updated_by = auth.uid(), updated_at = now()
   where semester_id = p_semester and student_id = p_student and version = p_expected_version;
  get diagnostics v_cnt = row_count;
  if v_cnt = 1 then return jsonb_build_object('ok',true,'version',p_expected_version+1); end if;
  return jsonb_build_object('ok',false,'reason','conflict');
end $$;

create or replace function app.review_report(
  p_semester uuid, p_student text, p_decision text, p_comment text, p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare r app.reports%rowtype; v_cnt int; v_name text;
begin
  if p_decision not in ('approved','returned') then
    return jsonb_build_object('ok',false,'reason','bad_decision'); end if;
  if app.my_role() is null then return jsonb_build_object('ok',false,'reason','inactive'); end if;
  if not app.has_duty(p_semester,'team_leader') then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select * into r from app.reports where semester_id = p_semester and student_id = p_student
   for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if r.status <> 'submitted' then
    return jsonb_build_object('ok',false,'reason','bad_state','current_status',r.status); end if;
  if r.submitted_by = auth.uid() then   -- separation of duties, RPC layer
    return jsonb_build_object('ok',false,'reason','self_review'); end if;
  if r.version <> p_expected_version then
    select display_name into v_name from app.profiles where id = r.updated_by;
    return jsonb_build_object('ok',false,'reason','conflict','current_status',r.status,
      'current_version',r.version,'updated_by',coalesce(v_name,'another teacher'),'updated_at',r.updated_at);
  end if;
  update app.reports set status = p_decision, version = version + 1,
         reviewed_by = auth.uid(), review_comment = coalesce(p_comment,''),
         updated_by = auth.uid(), updated_at = now()
   where semester_id = p_semester and student_id = p_student and version = p_expected_version;
  get diagnostics v_cnt = row_count;
  if v_cnt = 1 then return jsonb_build_object('ok',true,'version',p_expected_version+1); end if;
  return jsonb_build_object('ok',false,'reason','conflict');
end $$;
```

**Transition trigger (defence in depth; separation of duties at the DB layer):**

```sql
create or replace function app.guard_report() returns trigger
language plpgsql security definer set search_path = app, public as $$
begin
  if coalesce(current_setting('app.auto_return', true), '0') = '1' then
    return new;   -- system-initiated auto-return (below); audited like everything else
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
        and new.submitted_by is distinct from auth.uid())
  ) then
    raise exception 'illegal report transition % -> % for this user', old.status, new.status;
  end if;
  return new;
end $$;
create trigger reports_guard before update on app.reports
  for each row execute function app.guard_report();
```

**Auto-return (rev-2 item 6, refined by rev-3 item 4).** `write_cell_impl`
calls `auto_return_if_needed` **only after a real value change** (`IS DISTINCT
FROM` no-ops return early) — for score **and** total cells, since either
changes the computed grades:

```sql
create or replace function app.auto_return_if_needed(p_sem uuid, p_stu text) returns void
language plpgsql security definer set search_path = app, public as $$
begin
  perform set_config('app.auto_return', '1', true);   -- transaction-scoped
  update app.reports
     set status = 'returned', version = version + 1,
         review_comment = 'Automatically returned — scores changed after submission',
         reviewed_by = null, updated_by = auth.uid(), updated_at = now()
   where semester_id = p_sem and student_id = p_stu
     and status in ('submitted','approved');
  perform set_config('app.auto_return', '0', true);
end $$;
```

Rationale: an approved report must always match the current cells (a locked
print can never carry stale numbers); the state machine stays four-state; the
EAL re-edits and resubmits. Cost: a late single-cell fix forces one re-review.
Tested in T6.

---

## 4c. Proposals — server-side observation approvals (rev-3 item 2)

Mirrors the client class-mode rule: **support proposes, the paired EAL decides,
both sides audited; the score never changes until approval.**

```sql
create or replace function app.propose_cell(
  p_semester uuid, p_student text, p_cell_key text, p_value numeric, p_note text
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_row app.score_cells%rowtype; v_id uuid;
begin
  if app.my_role() is null then return jsonb_build_object('ok',false,'reason','inactive'); end if;
  if not app.has_duty(p_semester,'support') then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if not app.valid_cell_key('obs', p_cell_key) then
    return jsonb_build_object('ok',false,'reason','bad_key'); end if;
  if p_value is null or p_value = 'NaN'::numeric or p_value < 0 or p_value > 10 then
    return jsonb_build_object('ok',false,'reason','out_of_range'); end if;
  if not exists (select 1 from app.students s join app.semesters m on m.id = s.semester_id
                  where s.semester_id = p_semester and s.student_id = p_student
                    and s.deleted_at is null and m.deleted_at is null) then
    return jsonb_build_object('ok',false,'reason','not_found_or_deleted'); end if;
  select * into v_row from app.score_cells
   where semester_id = p_semester and student_id = p_student
     and kind = 'obs' and cell_key = p_cell_key;
  insert into app.proposals (semester_id, student_id, cell_key, current_value,
                             current_version, proposed_value, note, requested_by)
  values (p_semester, p_student, p_cell_key, v_row.value,
          coalesce(v_row.version, 0), p_value, coalesce(p_note,''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok',true,'proposal_id',v_id,
    'current_value', v_row.value, 'current_version', coalesce(v_row.version,0));
end $$;

create or replace function app.decide_proposal(
  p_proposal uuid, p_approve boolean, p_note text
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare p app.proposals%rowtype; v_res jsonb; v_cnt int;
begin
  if app.my_role() is null then return jsonb_build_object('ok',false,'reason','inactive'); end if;
  select * into p from app.proposals where id = p_proposal for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if p.status <> 'pending' then
    return jsonb_build_object('ok',false,'reason','already_decided','status',p.status); end if;
  if not app.has_duty(p.semester_id,'eal') then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p.requested_by = auth.uid() then   -- no self-approval (dual-duty holders
    return jsonb_build_object('ok',false,'reason','self_review'); end if;  -- write obs directly instead)
  if p_approve then
    v_res := app.write_cell(p.semester_id, p.student_id, 'obs', p.cell_key,
                            p.proposed_value, p.current_version);
    if coalesce((v_res->>'ok'),'false') <> 'true' then
      -- the cell changed after the proposal: stay pending, show both sides
      return jsonb_build_object('ok',false,'reason','cell_changed','conflict',v_res);
    end if;
  end if;
  update app.proposals set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decide_note = coalesce(p_note,'')
   where id = p_proposal and status = 'pending';
  get diagnostics v_cnt = row_count;
  if v_cnt = 1 then return jsonb_build_object('ok',true,'applied',p_approve); end if;
  return jsonb_build_object('ok',false,'reason','already_decided');
end $$;
```

Semantics: approval applies through the **same** `write_cell` path (duty is the
EAL's, version is the captured one), so concurrency, range checks, audit and
auto-return all behave identically. If the cell moved since the proposal, the
decider gets a `cell_changed` conflict with both values and the proposal stays
pending (reject, or ask the support teacher to re-propose). Rejection never
touches the cell. A cleared-then-proposed cell (`current_version 0`, value
null) is the ordinary "expect absent" case. Decided proposals are kept as
history (audit-logged); an admin purge RPC trims them after export (runbook).

---

## 4d. Admin RPCs + audit reader

```sql
create or replace function app.admin_upsert_semester(
  p_school text, p_class text, p_name text, p_year int, p_period text, p_months text[]
) returns jsonb
language plpgsql security definer set search_path = app, public as $$
declare v_id uuid; v_cnt int;
begin
  if coalesce(app.my_role(),'') <> 'admin' then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select id into v_id from app.semesters
   where school = p_school and class_name = p_class and name = p_name
     and coalesce(year,-1) = coalesce(p_year,-1) and deleted_at is null;
  if found then
    update app.semesters set period = p_period, months = p_months,
           settings = settings || jsonb_build_object('touched_by', auth.uid()::text)
     where id = v_id;
  else
    insert into app.semesters (school, class_name, name, year, period, months)
    values (p_school, p_class, p_name, p_year, p_period, p_months)
    on conflict do nothing;   -- expression-index race: re-select below
    get diagnostics v_cnt = row_count;
    select id into v_id from app.semesters
     where school = p_school and class_name = p_class and name = p_name
       and coalesce(year,-1) = coalesce(p_year,-1) and deleted_at is null;
  end if;
  return jsonb_build_object('ok', true, 'semester_id', v_id);
end $$;

create or replace function app.admin_upsert_students(p_semester uuid, p_rows jsonb) returns jsonb
-- rows: [{student_id, name_cn, name_en, gender}]  (re-importing a soft-deleted student revives it)
language plpgsql security definer set search_path = app, public as $$
declare r jsonb; v_ok int := 0; v_skip int := 0;
begin
  if coalesce(app.my_role(),'') <> 'admin' then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      insert into app.students (semester_id, student_id, name_cn, name_en, gender)
      values (p_semester, r->>'student_id', coalesce(r->>'name_cn',''),
              coalesce(r->>'name_en',''), nullif(r->>'gender',''))
      on conflict (semester_id, student_id) do update
        set name_cn = excluded.name_cn, name_en = excluded.name_en,
            gender = excluded.gender, deleted_at = null;
      v_ok := v_ok + 1;
    exception when others then v_skip := v_skip + 1; end;
  end loop;
  return jsonb_build_object('ok', true, 'written', v_ok, 'skipped', v_skip);
end $$;

create or replace function app.admin_import_cells(p_rows jsonb) returns jsonb
-- rows: [{semester_id, student_id, kind, cell_key, value, expected_version}]
-- admin duty is waived; EVERY other rule (range, key, month, pair, version,
-- auto-return) applies; per-row ok/conflict list is returned for the UI
language plpgsql security definer set search_path = app, public as $$
declare r jsonb; v_res jsonb; v_out jsonb := '[]'::jsonb;
begin
  if coalesce(app.my_role(),'') <> 'admin' then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_res := app.write_cell_impl((r->>'semester_id')::uuid, r->>'student_id', r->>'kind',
                r->>'cell_key', nullif(r->>'value','')::numeric, (r->>'expected_version')::int, true);
    v_out := v_out || jsonb_build_object('cell_key', r->>'cell_key', 'res', v_res);
  end loop;
  return jsonb_build_object('ok', true, 'results', v_out);
end $$;

create or replace function app.admin_set_student_deleted(p_semester uuid, p_student text, p_deleted boolean)
returns jsonb
language plpgsql security definer set search_path = app, public as $$
begin
  if coalesce(app.my_role(),'') <> 'admin' then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  update app.students set deleted_at = case when p_deleted then now() else null end
   where semester_id = p_semester and student_id = p_student;
  return jsonb_build_object('ok', true);
end $$;
-- app.admin_set_semester_deleted(p_semester uuid, p_deleted boolean): same shape

create or replace function app.admin_upsert_profile(
  p_auth_uid uuid, p_username text, p_display_name text, p_role text, p_active boolean
) returns jsonb
-- called by the local admin script (§9) with the service key; also usable by
-- the admin from the SQL editor for one-off fixes
language plpgsql security definer set search_path = app, public as $$
begin
  if coalesce(current_setting('request.jwt.claims', true), '') like '%"role":"service_role"%' then
    null;   -- script path
  elsif coalesce(app.my_role(),'') <> 'admin' then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  insert into app.profiles (id, username, display_name, role, active)
  values (p_auth_uid, p_username, p_display_name, p_role, coalesce(p_active,true))
  on conflict (id) do update set username = excluded.username,
    display_name = excluded.display_name, role = excluded.role, active = excluded.active;
  return jsonb_build_object('ok', true);
end $$;

create or replace function app.read_audit(p_limit int, p_offset int) returns jsonb
language plpgsql security definer set search_path = app, public as $$
begin
  if coalesce(app.my_role(),'') <> 'admin' then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  return jsonb_build_object('ok', true, 'rows', (
    select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select * from app.audit_log order by id desc
       limit least(coalesce(p_limit,100),500) offset greatest(coalesce(p_offset,0),0)
    ) t));
end $$;
```

---

## 4e. Audit triggers — the only writers of `audit_log` (rev-3 item 3)

One generic `security definer` trigger function; nobody holds any table grant
on `audit_log`, so nothing else can write it, and its RLS (enabled, §3) with
zero policies makes it unreadable by every HTTP path.

```sql
create or replace function app.tg_audit() returns trigger
language plpgsql security definer set search_path = app, public as $$
declare
  v_actor uuid; v_key text; v_old jsonb; v_new jsonb;
begin
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_actor := coalesce(
    (case when tg_op = 'DELETE' then (to_jsonb(old)->>'updated_by')
          when tg_table_name = 'proposals' and tg_op = 'INSERT' then (to_jsonb(new)->>'requested_by')
          else (to_jsonb(new)->>'updated_by') end)::uuid,
    auth.uid());
  v_key := case tg_table_name
    when 'score_cells' then (to_jsonb(coalesce(new,old))->>'semester_id') || '|' ||
                              coalesce(to_jsonb(new)->>'student_id', to_jsonb(old)->>'student_id') || '|' ||
                              coalesce(to_jsonb(new)->>'kind', to_jsonb(old)->>'kind') || '|' ||
                              coalesce(to_jsonb(new)->>'cell_key', to_jsonb(old)->>'cell_key')
    when 'reports'     then (to_jsonb(coalesce(new,old))->>'semester_id') || '|' ||
                              coalesce(to_jsonb(new)->>'student_id', to_jsonb(old)->>'student_id')
    when 'students'    then (to_jsonb(coalesce(new,old))->>'semester_id') || '|' ||
                              coalesce(to_jsonb(new)->>'student_id', to_jsonb(old)->>'student_id')
    when 'semesters'   then coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id')
    when 'assignments' then coalesce(to_jsonb(new)->>'user_id', to_jsonb(old)->>'user_id') || '|' ||
                              coalesce(to_jsonb(new)->>'semester_id', to_jsonb(old)->>'semester_id') || '|' ||
                              coalesce(to_jsonb(new)->>'duty', to_jsonb(old)->>'duty')
    when 'profiles'    then coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id')
    when 'proposals'   then coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id')
    else coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id') end;
  insert into app.audit_log (actor, actor_name, tbl, row_key, old, new)
  values (v_actor,
          (select display_name from app.profiles where id = v_actor),
          tg_table_name, v_key, v_old, v_new);
  return null;   -- AFTER trigger
end $$;

create trigger audit_score_cells after insert or update on app.score_cells
  for each row execute function app.tg_audit();
create trigger audit_reports     after insert or update on app.reports
  for each row execute function app.tg_audit();
create trigger audit_proposals   after insert or update on app.proposals
  for each row execute function app.tg_audit();
create trigger audit_students    after update on app.students
  for each row execute function app.tg_audit();
create trigger audit_semesters   after update on app.semesters
  for each row execute function app.tg_audit();
create trigger audit_assignments after insert or update or delete on app.assignments
  for each row execute function app.tg_audit();
create trigger audit_profiles    after update on app.profiles
  for each row execute function app.tg_audit();
```

---

## 5. Permission matrix

| Action | anon | teacher-EAL (assigned) | teacher-SUPPORT (assigned) | team leader (assigned) | manager | admin |
|---|---|---|---|---|---|---|
| Sign in / execute any RPC | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read semesters/students/cells/reports | ✗ | own classes only | own classes only | own classes | all | all |
| Read proposals (own classes) | ✗ | ✓ | ✓ (own submissions) | ✓ | all | all |
| Read profiles (roster) | ✗ | own row | own row | own row | all | all |
| Write obs cells | ✗ | ✓ | ✗ — **propose via `spr_propose_cell`** | ✗ | ✗ | via import RPC |
| Decide a proposal (obs) | ✗ | ✓ (not their own request) | ✗ | ✗ | ✗ | ✗ |
| Write spelling/daily/test cells | ✗ | ✗ | ✓ | ✗ | ✗ | via import RPC |
| Clear a cell (NULL) | ✗ | per kind | per kind | ✗ | ✗ | via import RPC |
| Edit report notes | ✗ | ✓ while draft/returned | ✗ | ✗ | ✗ | ✗ |
| Submit report | ✗ | ✓ draft/returned→submitted | ✗ | ✗ | ✗ | ✗ |
| Approve / return report | ✗ | ✗ | ✗ | ✓ submitted, never their own submission | ✗ | ✗ |
| Create/deactivate accounts, pair duties | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (script/SQL, §9) |
| Import workbook / bulk cells | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Soft-delete semester/student (undo-able) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Read audit log | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (`spr_read_audit`) |
| Hard delete anything | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (nobody, by policy) |

Every ✗ for authenticated roles is refused **by the server**, never only
hidden in the UI.

---

## 6. Read path, exposed schemas, and the exact client surface (rev-3 item 1)

**Exposed-schema decision (explicit).** PostgREST exposes only the schemas in
the dashboard's *Exposed schemas* list (default: `public`). Decision: **keep
the default and add nothing.** Reads go through `security_invoker` **views**
in `public`; writes through `public.spr_*` **invoker wrappers**. Rejected
alternative: adding `app` to Exposed schemas — it would auto-expose every
table and function there (including helpers and anything added later) to
HTTP; one dashboard setting away from accidental surface growth.

`grant usage on schema app to authenticated` (§3) is what lets those invoker
objects resolve `app.*` **inside SQL** — it is a privilege, not an exposure:
PostgREST HTTP routing ignores non-exposed schemas regardless of grants.

```sql
create view public.v_profiles  with (security_invoker = true) as
  select id, username, display_name, role, active from app.profiles;
create view public.v_semesters with (security_invoker = true) as select * from app.semesters;
create view public.v_students  with (security_invoker = true) as select * from app.students;
create view public.v_cells     with (security_invoker = true) as select * from app.score_cells;
create view public.v_reports   with (security_invoker = true) as select * from app.reports;
create view public.v_proposals with (security_invoker = true) as select * from app.proposals;
create view public.v_assignments with (security_invoker = true) as select * from app.assignments;
grant select on public.v_profiles, public.v_semesters, public.v_students,
                public.v_cells, public.v_reports, public.v_proposals,
                public.v_assignments to authenticated;
```

`security_invoker = true` (PG15+) means the querying user's RLS policies on
`app.*` apply exactly as if they queried the base table — the §3 read policies
do the row filtering.

**Client reads (pull on sign-in + realtime/poll refresh):**

```js
supabase.from('v_semesters').select('*')                      // -> has_class_read
supabase.from('v_students').select('*').eq('semester_id', id)
supabase.from('v_cells').select('*').in('semester_id', ids)  // bulk pull
supabase.from('v_reports').select('*').in('semester_id', ids)
supabase.from('v_proposals').select('*').in('semester_id', ids)
supabase.from('v_assignments').select('*')                    // own rows / school-wide
supabase.from('v_profiles').select('*')                       // own row / school-wide
```

**Write wrappers** (all thin `security invoker`, pinned path, one per entry
point; each created with `revoke execute from public, anon; grant execute to
authenticated;`):

```sql
create function public.spr_write_cell(p_semester uuid, p_student text, p_kind text,
  p_cell_key text, p_value numeric, p_expected_version int) returns jsonb
language sql volatile security invoker set search_path = app, public as $$
  select app.write_cell(p_semester, p_student, p_kind, p_cell_key, p_value, p_expected_version)
$$;
```

Full wrapper list (identical shape): `spr_write_cell`, `spr_save_report_notes`,
`spr_submit_report`, `spr_review_report`, `spr_propose_cell`,
`spr_decide_proposal`, `spr_read_audit`, `spr_admin_upsert_semester`,
`spr_admin_upsert_students`, `spr_admin_import_cells`,
`spr_admin_set_student_deleted`, `spr_admin_set_semester_deleted`,
`spr_admin_upsert_profile`, plus `spr_ping` (`select 1`; also
`grant execute to anon`, §8b).

Client calls, exactly:

| Client call | Purpose |
|---|---|
| `supabase.rpc('spr_write_cell', { p_semester, p_student, p_kind, p_cell_key, p_value, p_expected_version })` | one cell write/clear; conflict payload on stale version |
| `supabase.rpc('spr_propose_cell', { p_semester, p_student, p_cell_key, p_value, p_note })` | support proposes an obs change |
| `supabase.rpc('spr_decide_proposal', { p_proposal, p_approve, p_note })` | EAL approves/rejects |
| `supabase.rpc('spr_save_report_notes', { p_semester, p_student, p_notes, p_expected_version })` | draft/returned notes |
| `supabase.rpc('spr_submit_report', { p_semester, p_student, p_expected_version })` | submit |
| `supabase.rpc('spr_review_report', { p_semester, p_student, p_decision, p_comment, p_expected_version })` | approve / return |
| `supabase.rpc('spr_ping')` | keep-alive (anon) |
| admin: `spr_admin_upsert_semester`, `spr_admin_upsert_students`, `spr_admin_import_cells`, `spr_admin_set_student_deleted`, `spr_admin_set_semester_deleted`, `spr_read_audit` | admin ops |

DataStore interface unchanged from rev 1 (`LocalStore` kept; `RemoteStore`
with persisted offline outbox + conflict dialog; feature flag
`settings.store = 'local' | 'remote'`, default `local`).

---

## 7. Migration (dry-run first, always reversible)

Unchanged from rev 2 (class-mode planner reused; unresolved **client-side**
observation proposals are listed as blockers — after migration the flow is the
server-side §4c; verification recount + Calc comparison; nothing local
deleted; rollback = flip the flag). Target is the **fresh second free
project** (§8a).

---

## 8a. Project choice

**Fresh second free project** (`spr-pilot`). The existing project is untouched
and remains the live rollback for the deployed app until the new one passes
T1–T11 and the gates. Free plan allows 2 active projects; retiring the old one
afterwards is an explicit owner decision.

## 8b. Operations

**Keep-alive (service-role GitHub secret REJECTED).** It bypasses all RLS; it
appears nowhere outside the Supabase dashboard. Instead:

1. `public.spr_ping()` — `select 1`, executable by **anon**, hit by a GitHub
   Actions cron every 3 days via `POST /rest/v1/rpc/spr_ping` with the public
   anon key.
2. If REST pings turn out not to count as activity: a dedicated low-privilege
   keep-alive auth user (`keepalive@spr.local`, strong password, **no profile
   row** — RLS then blocks every table for it) signs in from the workflow with
   its password in a GitHub secret. **T11** (10 quiet days) decides which
   mechanism ships.

**Backups on the free plan (rev-3 item 8) — what Supabase does NOT give us.**
The free plan has **no scheduled database backups and no point-in-time
recovery** (both are paid-tier features). The 500 MB is the only limit that
protects data. Therefore **exports ARE the backup**:

- **Weekly admin export** (the in-app "Export everything": JSON + Excel),
  with the existing reminder banner; cadence weekly during term, plus one
  term-end snapshot per class. Retention: last 4 weekly + all term-end
  snapshots, stored in school-approved storage only (never the repo, never
  GitHub). RPO accepted: up to 7 days of entry loss in a worst-case project
  loss — documented to the school.
- **Timed restore drill** (release gate): create a throwaway fresh project →
  run the approved schema → `spr_admin_upsert_semester`/`…_students`/
  `spr_admin_import_cells` from the export → verify the T1 recount (per-class
  student/cell counts and Calc comparison against the export). Target: under
  **30 minutes** end-to-end, timed and recorded; run before the pilot and at
  the end of every term.

**Audit-log size + retention.** One audit row per cell write (incl. clears)
≈ 0.4–0.5 KB with index bloat. Per class-semester ≈ 23 students × ~120 cells ×
~2 writes (import + term edits) ≈ 5,500 rows ≈ **3 MB**. A 12-class school,
2 semesters/year ≈ **70 MB/year**; current + previous school year ≈ ~150 MB
steady state — inside the 500 MB limit. Purging beyond retention is a
dashboard-only (SQL editor) admin op, run only after an export; documented in
the runbook. Proposals add a small fraction (decided rows are history).

---

## 9. Auth + account creation via local admin script (rev-3 item 7)

A static site cannot call `auth.admin.createUser`, and no SQL function can.
**Mechanism: a local admin script on the admin's machine, service key kept
outside the repo.**

`tools/admin/create-accounts.mjs` (Node ≥ 18, zero dependencies; `fetch` is
built in):

1. Reads `tools/admin/roster.csv` — the existing SPR roster template format
   (`username, display_name, role, class_or_grade, paired_with, status`).
2. Reads `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from
   `tools/admin/.env.local` — **gitignored** (committed:
   `.env.local.example` with placeholders). The key exists ONLY on the admin's
   machine and in the dashboard; never in the repo, never in GitHub secrets.
3. For each row: `POST {url}/auth/v1/admin/users` (email
   `username@spr.local`, generated password meeting the app policy — 12/14
   floors — `email_confirm: true`), then
   `POST {url}/rest/v1/rpc/spr_admin_upsert_profile` with the profile fields.
   Assignments (duty rows) are created per semester later, in-app, by the
   admin.
4. Writes `tools/admin/out/created-accounts.csv` (username, one-time password)
   — gitignored, shown once, handed over privately; same rules as the
   class-mode one-time passwords.
5. Modes: `--reset <username>` regenerates a password
   (`PUT …/admin/users/{id}`); `--deactivate <username>` flips
   `profiles.active` off (sign-in refuses, data stays).

Dashboard-manual creation (Add user + one SQL profile line) remains the
documented fallback for one-off cases. Password changes for signed-in
teachers: in-app `supabase.auth.updateUser({ password })`. An Edge Function
holding the service key stays **out of pilot scope**.

**Facts verification status (rev-2 item 21): ATTEMPTED, NETWORK-BLOCKED**
(`supabase.com/docs` ECONNREFUSED from this machine, 2026-10-23). The
dashboard checklist to confirm once: synthetic `@spr.local` accepted on Add
user; "Confirm email" OFF (or auto-confirm); password minimum configurable
(raise to 12); sign-in rate limits. The app enforces its own floors
regardless (tested, P1.1/P1.2).

---

## 10. Test mapping (T1–T11) — rev-3 additions

| # | Additions in rev 3 |
|---|---|
| T4 | proposals legs: support proposes ✓ / EAL of another class ✗ / anon ✗ / requester cannot decide own (`self_review`) / decided rows immutable (`already_decided`) |
| T5 | advisory-lock leg: two parallel writers to a score/total **pair** — the invalid pair is rejected, never both accepted; plus two parallel writes to the same cell — exactly one `ok`, one `conflict` |
| T6 | no-op write (`IS NOT DISTINCT FROM`) returns `ok … noop` and does **not** auto-return; any real change (score OR total, incl. clear) does |
| T10 | restore drill timing (< 30 min) recorded from a real run |

T1/T2/T3/T7/T8/T9/T11 unchanged from rev 2.

---

## 11. D10 policy

Confirmed pending the teacher's final OK: Excel-compatible final number;
evidence average + "x of 9 components" beside any provisional grade; one
`PROVISIONAL_POLICY` constant in `calc.js`.

---

## 12. Gates before ANY SQL runs (owner actions)

1. **Written school approval** for hosting student names and scores on a
   server outside the school (see §13 for the exact framing).
2. **Reachability test** of the Supabase project host from the school network
   (and a phone), cold-load recorded.
3. **Teacher approves this revised doc.**

Until all three: no schema, no project creation, no P2 code that talks to
Supabase.

---

## 13. Data protection & ownership (rev-3 item 9)

**Where data lives.**

| Layer | Host | Student data? |
|---|---|---|
| App shell (HTML/JS) | GitHub Pages + DuckDNS name | **None** — code only; the repo stays clean |
| Records (names, scores, reports, audit) | Supabase FREE project (region chosen for school reachability — candidate `ap-southeast-1`; confirmed by gate 2) | **All of it** — TLS in transit, RLS + password auth at rest-access |
| Third parties | None. AI is OFF for the pilot; no analytics, no telemetry, no other processors | — |

**Legal pathway (the school is the personal-information handler).** Under
PIPL (mainland China), children's names + scores are personal information,
and data on under-14s is treated as sensitive. Before real data: the school
provides **written approval** (gate 1) that names the data categories, the
processor (Supabase), the hosting region, access roles and retention; lawful
basis and any guardian notification follow the school's own process (school
counsel's call, not ours). Minimisation is built in: `name_cn`, `name_en`,
`student_id`, gender, scores and reports — nothing else about a child is
stored (no photos, notes beyond report text, contacts, or demographics).
Retention: two school years, then the documented purge; access/deletion
requests go through the school's process (admin soft-delete + export first).

**Who owns the Supabase account: the school.** The pilot project must be
created under a **school-controlled account/email**, not a teacher's personal
one; the teacher-admin is an administrator of the project, not its owner.
Handover (a named school email as owner, ≥ 2 admins, documented in the
runbook) is part of going live; bus-factor protection, not a courtesy. The
GitHub repo hosting the app shell is currently the teacher's personal account
(`mdshezkhn`) — acceptable **only because** it contains code and zero student
data; the school may request transfer at any time (git remote swap, one
command, documented).

---

## 14. Decisions still open

1. Teacher's final OK on D10 wording (§11).
2. Keep-alive mechanism confirmed by T11 (§8b).
3. Merge order for the existing branches (`p0-baseline` → `p1-classes` →
   main) — independent of this doc.
4. Supabase project region (default candidate `ap-southeast-1`, subject to
   the gate-2 reachability test).

---

## 15. Change map — rev-2 owner items 1–27

| # | Where |
|---|---|
| 1 | §4: atomic `UPDATE … WHERE version` + `row_count`; `INSERT … ON CONFLICT DO NOTHING` |
| 2 | §4: full conflict payload (value, version, display name, time) on every conflict path |
| 3 | §10 T5: parallel-transaction leg |
| 4 | §3/§4b: reports RPC-only; `reports_eal_edit` removed; protected columns unclient-settable |
| 5 | §4b: EXISTS guard + `reviewed_by <> submitted_by` (trigger **and** RPC); T6 leg |
| 6 | §4b: auto-return decision + mechanism; T6 leg |
| 7 | §4: pair validated in both directions; anchored suffix parse |
| 8 | §1/§4: NaN + upper bound 1000 + obs ≤ 10 |
| 9 | §1 CHECKs + §2 `valid_cell_key` + §4 month-prefix membership |
| 10 | §1 composite FKs; §4 soft-delete write refusal; T7 |
| 11 | §1/§4: NULL = cleared (version bump + audit); Calc treatment documented |
| 12 | §1: partial unique index; `lower(username)` unique |
| 13 | §3: RLS everywhere incl. `audit_log`; verification query |
| 14 | §3: revoke-all, minimal grants, `audit_log` trigger-only |
| 15 | §3: per-function revoke/grant; pinned `search_path` |
| 16 | §4e: audit triggers `security definer` |
| 17 | §6: `app` unexposed; `public` wrappers; exact `supabase.rpc()` names |
| 18 | §10 T4: anon/nothing, cross-class refusal, audit unreadable + unforgeable |
| 19 | §2/§3/§5: least-privilege reads |
| 20 | §9: real creation mechanism + reset paths |
| 21 | §9: verification attempted, network-blocked; dashboard checklist |
| 22 | §8b: service-role GH secret rejected; anon ping / low-priv user; T11 decides |
| 23 | §8b: audit size + retention policy |
| 24 | §8a: fresh second free project |
| 25 | §10 T1: owner-supplied anonymised fixture; no real data anywhere |
| 26 | §11: D10 constant + evidence average + x-of-9 |
| 27 | §0: hash reconciled (`39d829bd`); evidence table with fresh outputs |

## 16. Change map — rev-3 owner items 1–9

| # | Where in rev 3 |
|---|---|
| 1 | §6: full read path (`security_invoker` `public.v_*` views + exact client selects); `grant usage on schema app` (§3) with the explanation that it is a privilege, not an exposure; exposed-schema decision made explicit (keep default, `app` stays unexposed) |
| 2 | §1 table 7 (`app.proposals`), §4c (`spr_propose_cell`, `spr_decide_proposal`), §3 policies + grants, §5 matrix rows, §4e audit triggers |
| 3 | §2 `valid_cell_key` full body; §4e `tg_audit()` + all seven triggers; §4b report RPCs full bodies; §4d admin RPCs full bodies; §6 full wrapper list |
| 4 | §4 `write_cell_impl`: `IS NOT DISTINCT FROM` no-op short-circuit (no version bump, no audit, no auto-return); `auto_return_if_needed` called only after a real change (score OR total, incl. clear); T6 leg |
| 5 | §4: `pg_advisory_xact_lock(hashtextextended(sem\|student\|kind))` before the pair read; T5 pair leg |
| 6 | dead code removed (rev-2's unused `v_base`, pseudo-code sketches replaced by full bodies, `read_audit` name unified); §1 unique index on `coalesce(year,-1)` so NULL years cannot duplicate |
| 7 | §9: `tools/admin/create-accounts.mjs` design — roster CSV in, auth users + profiles out, service key in gitignored `.env.local`, `--reset`/`--deactivate`, outputs gitignored; dashboard-manual fallback kept |
| 8 | §8b: free-plan backup limits stated (no scheduled backups, no PITR), weekly export cadence + retention, timed (<30 min) restore drill as a release gate, RPO documented |
| 9 | §13: hosting map, PIPL pathway + minimisation + retention, school-owned Supabase account with handover steps, personal-GitHub note |
