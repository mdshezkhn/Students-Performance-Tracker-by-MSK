# SPR Rollback Plan

## What "rollback" can mean (choose the section)
A. **Bad app release** (front-end behaves wrongly) — §1
B. **Bad data change** (wrong import / wrong edit wave) — §2
C. **New backend problem** (after migration) — §3
D. **Abandon the migration entirely** — §4

## 1. Bad app release (static PWA)
The app is versioned by its service-worker hash; devices update on reload.
1. Revert the publishing branch (`site`) to the last known-good commit: `git revert <commit> && git push` (or re-publish the previous build dir).
2. Because the SW cache-busts per build, one reload brings devices back; a second reload clears any half-state (known behaviour).
3. Old cached data is untouched by releases — no data action needed.
- **Recovery point**: the `deploy/` folder of the last good commit is always present in-repo (build2 refuses to overwrite hand-edits, so `deploy/` == last published build).

## 2. Bad data change (browser-local world or server world)
**Browser-local (current production):**
- Every replace-flow keeps a sealed safety copy automatically (Manage → Backups, newest 3) — restore from there.
- Full JSON backups: Manage → Restore backup.
- Worst case (no copies): the class Excel export from the last report run; re-import via the wizard.

**Server (after migration):**
1. Identify the incident window from `GET /api/audit` (record.* events have actor + version).
2. Nightly restore path (see §3 restore) OR surgical: the audit shows exactly which records/versions changed and by whom; a corrected edit through the API bumps versions forward (never hand-edit the DB while the API is live).
3. Teachers' devices hold their sealed local copies of pre-incident state if the server must be rolled a day back.

## 3. New backend problem (database-level restore)
```bash
# 1. freeze writes (stop the app so no session writes during restore)
systemctl stop spr
# 2. restore last nightly into a FRESH database (never in place)
sudo -u postgres createdb spr_restore
gunzip -c spr-2026-11-14.sql.gz | sudo -u postgres psql spr_restore
# 3. verify counts + one spot grade via the calc sample
sudo -u postgres psql spr_restore -c "select count(*) from students; select count(*) from records;"
# 4. swap under a transaction
sudo -u postgres psql -c "ALTER DATABASE spr RENAME TO spr_bad;"
sudo -u postgres psql -c "ALTER DATABASE spr_restore RENAME TO spr;"
systemctl start spr
```
- Sessions survive if `spr_bad` still has them — users re-login otherwise (acceptable).
- Restore is auditable: after restart the admin records a `data.export`-style note in the school incident file (SECURITY-INCIDENT-RESPONSE §4 evidence).

## 4. Abandon the migration (return to the interim app)
Until MIGRATION-PLAN Phase 3.3 (Supabase purge), the old world is fully intact:
1. Keep/turn device sync back ON in the old app (after the owner has run `docs/supabase-write-token.sql` so writes are protected — without it the app now refuses cloud writes by design).
2. Teachers continue exactly as before the pilot (accounts already existed; local data never left devices).
3. Revoke the school-server DNS record; keep the VPS snapshot 30 days, then destroy it (document in DATA-FLOW-INVENTORY).

## Principles
- Never destroy the only copy of anything while migrating (each phase keeps two live worlds or one live world + one sealed copy).
- Never fix server data by direct SQL while the API is running.
- Every rollback step ends with a verification (counts + one grade spot-check + audit entry).
