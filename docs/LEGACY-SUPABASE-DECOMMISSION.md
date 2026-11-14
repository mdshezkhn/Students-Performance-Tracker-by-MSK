# Legacy Supabase Decommission Plan — DRAFT, owner-executed

> Round 11 (2026-11-14). **Nothing in this plan has been executed.** The 88
> historical channel rows still exist in the production Supabase project; the
> write-protection SQL has still NOT been run there (live-verified: the three
> RPCs return 404 while the `spr_channels` table remains anonymously
> readable). This document is the sequence the OWNER follows, by hand, once
> the school-server architecture is accepted.

## Current state (verified 2026-11-13/14)

| Item | State |
|---|---|
| `spr_channels` rows | 88 (historical class + device-sync channels) |
| Read access | anonymous (`select` policy is open) |
| Write path | REFUSED by the app since round 10 (`protectionMissing` typed error; no fallback write) — the C1 fix |
| Protection RPCs | NOT installed server-side (`spr_channel_write` → 404) |
| Payloads | AES-GCM sealed envelopes (keys never in the rows); still treated as confidential |
| Region | Supabase Singapore/Seoul region — outside Mainland China |
| Live dependency | none required: the app runs fully local; cloud sync shows "paused" guidance until either the SQL is run (legacy path) or the school backend is adopted (target path) |

## Why not delete now

1. Teachers' devices may still hold local copies that reference these
   channels; a hard delete while a device is mid-adoption could make its
   recovery flow point at a vanished row (the app handles it, but the UX is
   worse than an orderly wind-down).
2. The school has not yet decided whether any pre-migration workbook history
   should be re-imported from a channel before disposal.
3. Retention/disposal of the encrypted payloads is a school decision under
   the draft retention policy — deletion is irreversible.

## Decommission sequence (owner, manual, after school-server acceptance)

1. **Freeze**: leave the refusal as-is (already shipped). No device can write.
2. **Inventory (read-only)**: in the Supabase dashboard, export the 88 rows
   (`id`, `share_name`, `pushed_at`, `pushed_by`; NOT the payloads) to a
   local CSV for the audit file.
3. **Recover anything worth keeping**: for each channel a teacher still
   recognises, open it once in the app (paired device) and export the class
   data locally, or run the SPR Excel export. Verify the export opens.
4. **Confirm the school server holds the migrated classes** (record counts +
   spot-check grades against the SPR calc engine).
5. **Delete the rows**: `delete from spr_channels;` in the SQL editor.
   Expect 88 rows.
6. **Lock the tables**: run `docs/supabase-write-token.sql` ANYWAY (it also
   tightens RLS), or simpler: revoke the anon role's access entirely:
   `revoke all on spr_channels from anon;` + remove the open `select` policy.
7. **Remove secrets from the project**: delete the Supabase URL/anon key from
   any remaining config; rotate the anon key in the dashboard.
8. **Close or pause the project** (Supabase free tier): the school decides
   between deleting the project (irreversible) or pausing it (auto-deletes
   inactivity on free plans — treat pause as delete).
9. **Record the disposal** in the school's audit file (date, actor, row
   count, method) — the Supabase audit trail dies with the project.

## Rollback of this plan

Before step 5, everything is reversible (the refusal can be lifted by running
the protection SQL + re-pairing devices). After step 5, only local device
copies and the step-3 exports survive — which is why step 3 exists.

## Technical dependency on Supabase after decommissioning

None. The school backend (`server/`) is a standalone Node + PostgreSQL
application; `source/schoolsync.js` talks to it same-origin. The bundle's
Supabase code paths remain for the transition period only and can be removed
in a later cleanup release once every teacher device has migrated.
