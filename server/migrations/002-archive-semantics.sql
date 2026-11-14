-- 002: archive semantics (Round 12, mandate §5.2).
-- Distinction enforced: ARCHIVING (reversible, keeps records + report history)
-- vs DEACTIVATION (account-level) vs genuine DELETE (only via direct DB work
-- by the owner under the retention policy). The API never deletes students.

alter table students add column if not exists archived_at timestamptz;
alter table classes  add column if not exists archived_at timestamptz;
create index if not exists students_archived_idx on students(class_id) where archived_at is not null;
