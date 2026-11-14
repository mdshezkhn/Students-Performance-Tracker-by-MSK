-- SPR school backend — PostgreSQL schema (v1, 2026-11-13)
-- Target: Mainland-China-hosted PostgreSQL (see docs/DEPLOYMENT-GUIDE.md).
-- The SAME file initialises a real `pg` database in production and PGlite in
-- the test suite (tests/test-server-*.mjs), so schema drift is impossible.
--
-- Design notes (SECURITY-BASELINE.md C2/C4/C7 remediation):
--  * every student-carrying row is scoped by school_id AND class_id; the API
--    enforces both from the SESSION (never from client input) on every call;
--  * records are ROW-LEVEL with version numbers for optimistic concurrency
--    (no whole-workbook blobs, no last-write-wins);
--  * sync_ops gives idempotency (retried mobile requests cannot duplicate);
--  * audit_events is append-only from the API's perspective and never stores
--    record payloads (student identifiers only as opaque ids);
--  * minimal PII: students carry NO national id, address, phone, photo or
--    medical data. under14 is a boolean capability flag (PIPL minors rules),
--    not a birthdate.

create table if not exists schools (
  id          text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists users (
  id            text primary key,
  school_id     text not null references schools(id),
  username      text not null,
  display_name  text not null default '',
  role          text not null check (role in ('admin','manager','teacher')),
  pw_salt       text not null,
  pw_hash       text not null,            -- scrypt(N=2^17,r=8,p=1) hex
  must_change_pw boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (school_id, username)
);

create table if not exists sessions (
  id          text primary key,          -- sha256(token), token lives only in the cookie
  user_id     text not null references users(id) on delete cascade,
  csrf        text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index if not exists sessions_user_idx on sessions(user_id);

create table if not exists classes (
  id          text primary key,
  school_id   text not null references schools(id),
  name        text not null,             -- e.g. "Primary 4A"
  grade       text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, name)
);

-- who teaches what: duty 'fet' = foreign English teacher (observations),
-- 'cet' = Chinese English teacher-assistant (spelling/tests/assignments)
create table if not exists class_memberships (
  class_id    text not null references classes(id) on delete cascade,
  user_id     text not null references users(id) on delete cascade,
  duty        text not null check (duty in ('fet','cet')),
  created_at  timestamptz not null default now(),
  primary key (class_id, user_id)
);
create index if not exists memberships_user_idx on class_memberships(user_id);

create table if not exists semesters (
  id          text primary key,
  school_id   text not null references schools(id),
  name        text not null,             -- e.g. "2026 Fall"
  starts_on   date,
  ends_on     date,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists students (
  id          text primary key,          -- internal uuid (never a national id)
  school_id   text not null references schools(id),
  class_id    text not null references classes(id) on delete cascade,
  student_no  text not null default '',  -- school's own class register number
  name_cn     text not null default '',
  name_en     text not null default '',
  gender      text check (gender in ('M','F')),
  under14     boolean,                   -- nullable: unknown / not assessed
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text not null default '',
  unique (class_id, student_no)
);
create index if not exists students_class_idx on students(class_id);

-- row-level collaborative records. category ownership is enforced by the API:
--   fet -> 'observation';  cet -> 'spelling' | 'test' | 'daily'
create table if not exists records (
  id            text primary key,        -- uuid, client-generated
  school_id     text not null references schools(id),
  class_id      text not null references classes(id) on delete cascade,
  student_id    text not null references students(id) on delete cascade,
  semester_id   text references semesters(id),
  category      text not null check (category in ('observation','spelling','test','daily')),
  period        text not null default '', -- month label ("Nov 2026") or term label
  ordinal       int not null default 1,   -- 2nd spelling test same period etc.
  value         numeric,                  -- score (null for text-only observation)
  max_value     numeric,                  -- assessment maximum, when known
  note          text not null default '', -- observation text / remark
  version       int not null default 1,
  deleted_at    timestamptz,
  created_by    text not null default '',
  updated_by    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (class_id, student_id, category, period, ordinal, semester_id)
);
create index if not exists records_class_idx on records(class_id, updated_at);
create index if not exists records_student_idx on records(student_id);

-- idempotency: the (user, key) pair remembers the applied result so a retried
-- POST (flaky school Wi-Fi) replays the answer instead of duplicating a score
create table if not exists sync_ops (
  id            text primary key,
  user_id       text not null references users(id) on delete cascade,
  idem_key      text not null,
  record_id     text,
  result        jsonb not null,
  created_at    timestamptz not null default now(),
  unique (user_id, idem_key)
);

-- append-only audit trail. The API layer is the only writer; it stores ids,
-- versions and outcomes — never scores, notes or names.
create table if not exists audit_events (
  id          bigserial primary key,
  school_id   text not null default '',
  actor_id    text not null default '',
  actor_name  text not null default '',
  action      text not null,
  target      text not null default '',
  class_id    text not null default '',
  outcome     text not null default 'ok',
  req_id      text not null default '',
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists audit_school_time_idx on audit_events(school_id, id desc);

-- round11 (§7): DB-level audit immutability. The API never UPDATEs or DELETEs
-- audit_events, but "the app promises" is not immutability — this trigger makes
-- mutation physically fail for ANY writer, including the app role itself and a
-- rogue superuser query that forgets itself. Immutability is enforced by the
-- database engine, not by application discipline.
create or replace function spr_audit_immutable() returns trigger as $$
begin
  raise exception 'audit_events is append-only (attempted %)', TG_OP;
end;
$$ language plpgsql;

drop trigger if exists audit_events_no_update on audit_events;
create trigger audit_events_no_update
  before update or delete on audit_events
  for each row execute function spr_audit_immutable();
