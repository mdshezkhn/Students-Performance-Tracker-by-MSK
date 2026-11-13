# SPR Production Security Checklist

Print, work top-to-bottom, initial each line. Companion: SECURITY-BASELINE.md
(what each item closes) and SECURITY-INCIDENT-RESPONSE.md (when something slips
through anyway).

## Before go-live (one-time)

| # | Item | Evidence required | ✓ |
|---|---|---|---|
| 1 | Domain + ICP filing (ICP备案) complete for the school-facing hostname | Filing number displayed in site footer | ☐ |
| 2 | Server + DB in one Mainland China region; backups same region | `region` output from provider console | ☐ |
| 3 | TLS certificate valid (ACME auto-renew) | `curl -vI https://…` shows ≥30d validity | ☐ |
| 4 | `SPR_DB_URL` set only in the server's env file, mode 600, NOT in repo | `git grep SPR_DB_URL` → only docs | ☐ |
| 5 | First-run admin password changed from the printed one | login as admin → Users → change | ☐ |
| 6 | Teachers hold individual accounts (FET/CET roles as assigned) | Users page list | ☐ |
| 7 | write-token SQL applied if the interim Supabase channel is STILL used (otherwise channels disabled) | `spr_channel_write` no longer 404 | ☐ |
| 8 | Unused Supabase channel rows deleted (enumeration surface) | table empty / only armed rows | ☐ |
| 9 | Cloudflare/CDN access logs on; no student payload logged | sample log lines | ☐ |
| 10 | Nightly DB dump encrypted (age/gpg) to same-region object storage, 30d retention, restore TESTED once | restore log | ☐ |
| 11 | Audit events visible to admin only | log in as teacher → `/api/audit` → 403 | ☐ |
| 12 | Rate limit verified: 10 failed logins lock for 10 min | manual test | ☐ |
| 13 | Data-flow inventory re-verified after any dependency change | docs/DATA-FLOW-INVENTORY.md updated | ☐ |
| 14 | Teachers' browsers: no plaintext safety backups (build ≥ 7249059c45) | settings → safety copies show 🔒 sealed | ☐ |

## Weekly (5 minutes)

- Backup still landing (check object-storage timestamp).
- Users list: only real staff, no dormant accounts.
- Audit tail: logins look normal, no bursts of failures.

## On each app release

- `npm test` green on the release commit.
- Service-worker hash changed (devices will auto-update within a reload).
- Release note to teachers: one sentence, plain English.
