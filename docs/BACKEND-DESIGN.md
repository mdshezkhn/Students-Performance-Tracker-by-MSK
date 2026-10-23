# SPR Backend Design — P1 Design Review (nothing created yet)

Status: **DESIGN FOR APPROVAL.** No database object has been created. This document
supersedes the earlier "no backend" P1 direction per the external code review
(Oct 23, 2026): roles and conflict safety can only be enforced where the data
lives, so the pilot moves to **Supabase Auth + row-level security**, still on the
FREE plan, with GitHub Pages unchanged.

---

## 0. Where we stand vs the review

The review was performed on `main @ b99d050`. Branch `p1-classes` (P0 + P1 +
P1.1 + P1.2, all suites green, **not merged**) has since fixed several confirmed
defects. Honest scorecard:

| ID | Review verdict | Status on `p1-classes` | Remaining work |
|----|----------------|------------------------|----------------|
| D1 | Critical: whole-blob last-save-wins | **Open** (both legacy and class-mode payloads are whole-blob) | P2/P3 per-cell RPC + conflict dialog (this doc) |
| D2 | Critical: roles are UI-only | **Partial** — client-side class mode with keys, documented as agreed-rule | P2: server-side RLS (this doc). Client gating stays as UX |
| D3 | High: anon writes, policy not in repo | **Open** — writes use the anon key; no SQL in repo | P2: Supabase Auth, no anon access; policy SQL committed here; live policy reviewed in dashboard (gate 2) |
| D4 | High: FNV hash stored | **Fixed (P1.1)** — hashless login wraps, PBKDF2-600k, lazy migration | none |
| D5 | High: out-of-range stored+counted | **Fixed (P0)** — validators + quarantine review list | T3 re-run |
| D6 | Medium: no cell validation / unescaped / broad CSP | **Mostly fixed (P0/P1.2)** — import+paste+render validation, attribute escaping, CSP narrowed to `*.supabase.co` | P2: narrow to the single project host |
| D7 | Medium: 男/女 not normalised | **Fixed (P0)** | T2 re-run on real workbook |
| D8 | Medium: teachers not read | **Fixed (P0)** — label scan; real-workbook verification pending re-attach | T2 |
| D9 | Low: entities in toasts | **Fixed (P0)** | none |
| D10 | Policy: provisional grades | **Open** — "n/9" chips exist; evidence average not shown beside provisional finals | P3 UI, single `PROVISIONAL_POLICY` constant; default per review |
| D11 | Low: tests not runnable from clone | **Fixed (P0)** — CI green from fresh clone, dead files removed | none |

**Carried forward from the client-side work** (not wasted): role/pairing UI,
review-queue pattern, audit panel, migration planner + dry-run UX, quarantine,
hashless auth + PBKDF2-600k (reused verbatim as the offline-cache seal), the
honest-copy pass, and the whole test harness. **Replaced:** per-class cloud
transport (whole-blob ds*/sb* sync) → per-record RemoteStore. The per-class
encrypted workbooks remain as `LocalStore` (admin private offline mode).

---

## 1. Schema (SQL to run in the Supabase SQL editor — after your OK)

One row per class × term = one `semesters` row (matches one imported workbook).

```sql
create extension if not exists pgcrypto;

-- 1. profiles: one per Supabase auth user, admin-created (no email dependence)
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text not null default '',
  role         text not null check (role in ('admin','manager','teacher')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 2. semesters: one class × one term
create table public.semesters (
  id         uuid primary key default gen_random_uuid(),
  school     text not null default '',
  class_name text not null,
  name       text not null,                    -- e.g. "2026 Spring Semester"
  year       int,
  period     text,
  months     text[] not null default '{}',     -- e.g. {March,April,May,June}
  settings   jsonb not null default '{}'::jsonb, -- {autoTotal, spTotal, daTotal}
  deleted_at timestamptz,                      -- soft delete only
  created_at timestamptz not null default now(),
  unique (school, class_name, name)
);

-- 3. assignments: who does what for which class
create table public.assignments (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  semester_id uuid not null references public.semesters(id) on delete cascade,
  duty        text not null check (duty in ('eal','support','team_leader')),
  primary key (user_id, semester_id, duty)
);

-- 4. students: per class; gender normalised M|F|null (男/女 mapped on import)
create table public.students (
  semester_id uuid not null references public.semesters(id) on delete cascade,
  student_id  text not null,
  name_cn     text not null default '',
  name_en     text not null default '',
  gender      text check (gender in ('M','F')),
  deleted_at  timestamptz,                     -- soft delete only
  primary key (semester_id, student_id)
);

-- 5. score_cells: one row per score/total cell, versioned (optimistic concurrency)
create table public.score_cells (
  semester_id uuid not null references public.semesters(id) on delete cascade,
  student_id  text not null,
  kind        text not null check (kind in ('obs','spelling','daily','test')),
  cell_key    text not null,
  value       numeric not null,
  version     int not null default 1,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  primary key (semester_id, student_id, kind, cell_key),
  check (value >= 0),
  check (kind <> 'obs' or value <= 10)         -- observations are 0–10
);

-- 6. reports: one per student per semester, workflow-state machine
create table public.reports (
  semester_id    uuid not null references public.semesters(id) on delete cascade,
  student_id     text not null,
  status         text not null default 'draft'
                 check (status in ('draft','submitted','returned','approved')),
  notes          jsonb not null default '{}'::jsonb,  -- reportSections output + edits
  version        int not null default 1,
  updated_by     uuid references public.profiles(id),
  submitted_at   timestamptz,
  reviewed_by    uuid references public.profiles(id),
  review_comment text,
  updated_at     timestamptz not null default now(),
  primary key (semester_id, student_id)
);

-- 7. audit_log: append-only, filled by triggers
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_name text,
  tbl        text not null,
  row_key    text not null,
  old        jsonb,
  new        jsonb
);
revoke update, delete on public.audit_log from anon, authenticated;
```

### Cell-key scheme (frozen here; the client and RPCs must agree)

| Kind | Key examples | Meaning |
|------|--------------|---------|
| obs | `March\|Listening-LO1` | skill LO cell, 0–10 |
| spelling / daily | `March\|3\|s`, `March\|3\|t` | week 3 score / total |
| test | `midterm\|s`, `midterm\|t`, `oral\|s`, `written\|s` … | score / total pairs |

Score>total is enforced in the RPC (the pair lives in two rows; a table CHECK
cannot see across rows). Totals are written through the same RPC (support duty),
so a teacher cannot raise a total to cover an impossible score.

---

## 2. Helper functions (RLS support, `security definer` to avoid recursion)

```sql
create schema if not exists app;

create or replace function app.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function app.has_duty(p_sem uuid, p_duty text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assignments a
    join public.profiles p on p.id = a.user_id and p.active
    where a.user_id = auth.uid() and a.semester_id = p_sem and a.duty = p_duty
  )
$$;
```

## 3. Row-level security policies

Default: **anon has no policy on any table** (grant `select` etc. only to
`authenticated`; the anon key can do nothing — verifiable with T4's anon leg).

| Table | SELECT | INSERT / UPDATE / DELETE |
|-------|--------|--------------------------|
| profiles | own row, admin, manager (staff roster) | admin only (role, active, create) |
| semesters | any active staff | admin only; "delete" = set `deleted_at` (update) |
| assignments | any active staff (small metadata) | admin only |
| students | any active staff | admin only; soft delete via `deleted_at` |
| score_cells | any active staff | **no direct policy** — writes only via `app.write_cell` / admin import RPC |
| reports | any active staff | notes/status only via RPCs (§4); no deletes |
| audit_log | admin | inserts by triggers only; UPDATE/DELETE revoked for everyone |

Design notes:
- **Reads are staff-wide** (any signed-in active account): the workflow needs
  committed records visible across devices and to managers/team leaders; the
  gate is the account, not per-row secrecy.
- **Writes are RPC-only for cells** so version checks and duty checks cannot be
  bypassed by a policy edge case; the RPC is `security definer` with a pinned
  `search_path`.
- Report status transitions are guarded by a trigger (below) so even the EAL
  UPDATE policy cannot jump states.

```sql
alter table public.score_cells enable row level security;
alter table public.reports    enable row level security;
-- (…enable for every table; then create policies per the matrix, e.g.:)
create policy cells_read on public.score_cells for select to authenticated
  using (app.my_role() is not null);
-- no insert/update/delete policy on score_cells for authenticated at all.

create policy reports_read on public.reports for select to authenticated
  using (app.my_role() is not null);
create policy reports_eal_edit on public.reports for update to authenticated
  using (app.has_duty(semester_id, 'eal') and status in ('draft','returned'))
  with check (status in ('draft','submitted','returned'));  -- transitions refined by trigger
```

**Report transition trigger** (server-enforced workflow):

```sql
create or replace function app.guard_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor_duty text;
begin
  if new.status = old.status then return new; end if;         -- notes-only edit
  select string_agg(duty, ',') into actor_duty
    from public.assignments where user_id = auth.uid() and semester_id = new.semester_id;
  -- allowed: draft→submitted (eal), returned→submitted (eal),
  --          submitted→approved|returned (team_leader). Everything else: raise.
  if not (
       (old.status in ('draft','returned') and new.status = 'submitted' and actor_duty like '%eal%')
    or (old.status = 'submitted' and new.status in ('approved','returned') and actor_duty like '%team_leader%')
  ) then raise exception 'illegal report transition % -> % for this user', old.status, new.status; end if;
  return new;
end $$;
create trigger reports_guard before update on public.reports
  for each row execute function app.guard_report();
```

**Audit triggers** on `score_cells`, `reports`, `students`, `semesters` write
old/new JSONB + actor into `audit_log` (append-only; `admin` reads).

## 4. Write RPCs (optimistic concurrency + duty + range)

```sql
create or replace function app.write_cell(
  p_semester uuid, p_student text, p_kind text, p_cell_key text,
  p_value numeric, p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.score_cells; total numeric; d text;
begin
  if app.my_role() is null then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  -- duty: obs -> eal; spelling/daily/test -> support
  if p_kind = 'obs' then d := 'eal'; else d := 'support'; end if;
  if not app.has_duty(p_semester, d) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  -- range: obs 0–10 (table CHECK covers it); score vs its paired total
  if p_kind <> 'obs' and p_cell_key like '%|s' then
    select value into total from public.score_cells
      where semester_id = p_semester and student_id = p_student
        and kind = p_kind and cell_key = replace(p_cell_key, '|s', '|t');
    if total is not null and p_value > total then
      return jsonb_build_object('ok', false, 'reason', 'out_of_range'); end if;
  end if;
  select * into v from public.score_cells
    where semester_id = p_semester and student_id = p_student
      and kind = p_kind and cell_key = p_cell_key;
  if v.semester_id is null then
    if p_expected_version <> 0 then
      return jsonb_build_object('ok', false, 'reason', 'conflict',
        'current_version', 0);                      -- cell exists since you loaded
    end if;
    insert into public.score_cells (semester_id, student_id, kind, cell_key, value, version, updated_by)
      values (p_semester, p_student, p_kind, p_cell_key, p_value, 1, auth.uid());
    return jsonb_build_object('ok', true, 'version', 1);
  end if;
  if v.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'conflict',
      'current_value', v.value, 'current_version', v.version,
      'updated_by', v.updated_by, 'updated_at', v.updated_at);   -- UI shows both, user picks
  end if;
  update public.score_cells set value = p_value, version = version + 1,
      updated_by = auth.uid(), updated_at = now()
    where semester_id = p_semester and student_id = p_student
      and kind = p_kind and cell_key = p_cell_key;
  return jsonb_build_object('ok', true, 'version', v.version + 1);
end $$;
```

Companions (same pattern): `app.submit_report`, `app.review_report(p_decision,
p_comment)`, `app.admin_upsert_semester`, `app.admin_upsert_students(rows)`,
`app.admin_import_cells(rows with expected versions)` returning per-row
ok/conflict lists so the importer can show exactly what collided, and
`app.soft_delete_student / _semester` (admin, writes `deleted_at` + audit).

Realtime: enable on `score_cells` + `reports`; the client subscribes after
sign-in and falls back to a 60 s poll (per the review, either is acceptable).

## 5. Permission matrix (the document the review asked for)

| Action | anon | teacher-EAL (assigned) | teacher-SUPPORT (assigned) | team leader (assigned) | manager | admin |
|---|---|---|---|---|---|---|
| Sign in | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read semesters/students/assignments/cells/reports | ✗ | ✓ (all classes) | ✓ (all classes) | ✓ | ✓ | ✓ |
| Write obs cells | ✗ | ✓ own classes | ✗ (proposal → EAL, UI-level) | ✗ | ✗ | via import RPC |
| Write spelling/daily/test cells | ✗ | ✗ | ✓ own classes | ✗ | ✗ | via import RPC |
| Edit report notes | ✗ | ✓ while draft/returned | ✗ | ✗ | ✗ | ✗ |
| Submit report | ✗ | ✓ (draft/returned→submitted) | ✗ | ✗ | ✗ | ✗ |
| Approve / return report | ✗ | ✗ | ✗ | ✓ (submitted only) | ✗ | ✗ |
| Create/deactivate accounts, pair duties | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Import workbook / bulk cells | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Soft-delete semester/student | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (undo = clear `deleted_at`) |
| Read audit log | ✗ | ✗ | ✗ | ✗ | ✗ (optional add) | ✓ |
| Hard delete anything | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (nobody, by policy) |

Every ✗ for authenticated roles is **refused by the server** (RLS/RPC), not
only hidden in the UI. The UI still hides what would be refused (UX), and the
support-teacher observation *proposal* flow stays as a UI courtesy on top of
the EAL-only obs write right.

## 6. Client architecture (P2/P3)

- **DataStore interface**: `getSemester / listSemesters / setCell / setCells /
  setReportNotes / submitReport / reviewReport / importBulk / on change`.
  Two implementations:
  - `LocalStore` — today's encrypted local mode (admin private offline use),
    unchanged;
  - `RemoteStore` — Supabase Auth session + `write_cell` RPCs + realtime/poll
    + **persisted offline outbox** (queue per cell with expected version,
    replay on reconnect, conflict dialog when the server returns `conflict`).
  The UI calls only DataStore (refactor in steps; entry grids/report screens
  swap their save calls first).
- **Offline cache**: the PBKDF2-600k + AES-GCM machinery from P1.1 is reused
  verbatim to seal the RemoteStore cache under the user's password; sign-out
  wipes it.
- **Feature flag**: `settings.store = 'local' | 'remote'`, default `local`;
  the admin enables remote per deployment after P2. Nothing about the default
  changes for existing users until you flip it.
- **Auth**: admin-created users in Supabase (dashboard or an admin RPC that
  calls `auth.admin.createUser`), no email sign-up. Username+password map to
  email-like deterministic aliases (`spr-<username>@spr.local`) if email-less
  login is not available on the plan — decided in P2; app keeps local username
  UX regardless.

## 7. Migration from current data (dry-run first, always reversible)

1. Admin enables RemoteStore and signs in → migration screen.
2. Source: the **class-mode workbooks** (or the legacy single blob) — the
   existing planner/dry-run UX is reused (classes, students, cells, reports,
   warnings; unresolved observation proposals are listed as blockers).
3. Apply via admin bulk RPCs: semesters → `semesters` (settings jsonb),
   students → `students` (gender already M/F since P0), scores → `score_cells`
   with the frozen key scheme, `reportNotes` → `reports(status='draft')`.
4. Quarantined review items stay local (never auto-imported).
5. Verification step in-app: per class, recount cells and re-run `Calc` finals
   locally vs a server-computed spot check; show a green table before finishing.
6. **Nothing local is deleted.** LocalStore keeps working; the device simply
   switches its active store. Rollback = flip the flag back.

## 8. Operations (P4)

- **Keep-alive**: GitHub Actions cron every 3 days hitting the project REST
  endpoint. Caveat to verify in P4: with anon denied, a bare REST request may
  return 401 — activity may or may not count toward unpausing. If it does not,
  the workflow uses a stored **GitHub secret** (never in the repo) with a
  service-role token to touch a `/rest/v1/` endpoint, or we hit
  `auth/v1/health`. Documented in the runbook either way.
- **Backups**: weekly admin "Export everything" (JSON + Excel) with reminder;
  restore drill documented and timed before real data (gate 5). Exports are
  never committed.
- **CSP**: `connect-src` narrowed to the single project host
  (`https://<ref>.supabase.co`).

## 9. Test mapping (review T1–T11)

| # | Review test | Today | After P2/P3 |
|---|---|---|---|
| T1 | 23-student grading regression | synthetic fixture + independent Python oracle (**real workbook numbers still needed**) | re-run unchanged |
| T2 | import/export round-trip | 24 checks, synthetic; real-workbook leg pending re-attach | + teachers/gender assertions |
| T3 | validation/quarantine | done (P0/P1.1) | + RPC `out_of_range` leg |
| T4 | RLS matrix with real tokens | n/a | **new suite**: runs on demand against a `test_`-prefixed dataset in the free project, cleans up after itself; anon leg asserts 401/empty everywhere |
| T5 | conflict + D1 replay | n/a | outbox test: A+B offline different cells → both survive; same cell → dialog, no silent loss; hours-signed-in D1 replay |
| T6 | report workflow | n/a | state machine via RPC + trigger; approved locked |
| T7 | delete safety | n/a | teacher delete refused by server; admin soft delete + undo + audit row |
| T8 | offline queue | n/a | jsdom offline simulation + reload |
| T9 | security scan | hashless ✓ (P1.1), CSP ✓ (P1.2), escaping ✓ (P0) | automated secret/student-data scan in CI |
| T10 | export → restore | class-mode export/restore exists | remote-mode equivalent into test dataset |
| T11 | keep-alive | n/a | P4, 10-day observation |

## 10. Decisions needed before anything is created

1. **Approve this direction** (Supabase backend) — it reverses the earlier
   client-side P1 directive; that work survives as LocalStore + UI, but the
   cloud model changes. This document is the review gate: nothing is created
   until you say go.
2. **Re-attach the May–June workbook** so T1 carries the real 23 students
   (anonymised) as the review requires.
3. **D10 policy**: confirm the default — Excel-compatible final number stays;
   cards and screens additionally show the evidence average and "x of 9
   components" beside any provisional grade; one `PROVISIONAL_POLICY` constant.
4. **Which project**: migrate the existing free project in place (keeps
   keep-alive history; old blob rows tombstoned later) or start the second
   free project fresh?
5. **Keep-alive mechanics** (P4): accept a GitHub-secret service-role ping if
   anon REST pings prove not to count as activity?
