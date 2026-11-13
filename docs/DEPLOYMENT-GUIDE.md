# SPR Deployment Guide — Mainland China target

Status 2026-11-13: backend **implemented and tested locally (staging)**; NOTHING is provisioned yet — every "owner action" below is pending. Do not claim deployment until each checklist box is real.

## 0. Architecture recap
- Static PWA (`app/`, `index.html`) — any static host; serves code only.
- `server/spr-server.mjs` — Node 20+ HTTP API, zero npm runtime deps (production installs ONE package: `pg`).
- PostgreSQL 14+ (China region), schema in `server/schema.sql` (applied automatically on first boot).
- Browser talks ONLY to the school API for student data (no Supabase in the target state).

## 1. Owner actions (external provisioning, ~1 day of work + waiting)
1. **Buy a domain** (or use a subdomain the owner controls, e.g. `spr.<owner-domain>.cn`). Registrant: the school or the owner acting for the school — decide ownership NOW because ICP filing follows the registrant.
2. **Choose a China cloud provider** (Alibaba/Tencent/Huawei). Buy the smallest sensible VPS (2 vCPU / 4 GB is ample for one school) in a Mainland region (e.g. cn-shanghai, cn-beijing) + managed or self-hosted PostgreSQL + object storage for backups.
3. **ICP 备案 (filing)** — mandatory for serving a website from a Mainland server on your own domain. Initiate via the provider's 备案 console: registrant identity documents, site purpose ("学校内部教学管理工具"), usually 1–3 weeks. **The site must NOT go live on the China host before the filing number is issued.**
4. After ICP: provider-side 公安联网备案 (public-security network filing, typically within 30 days of going live).
5. TLS certificate (free provider-issued cert or Let's Encrypt via DNS challenge).
6. DNS: point `spr.<domain>` A/AAAA/CNAME at the VPS.

## 2. Server setup (run on the VPS as root, then drop privileges)
```bash
# Node 20+ (use the provider's NodeSource mirror or nvm with a China mirror)
node -v
# application
mkdir -p /opt/spr && cd /opt/spr
git clone -b feature/p2-secure-school https://github.com/mdshezkhn/Students-Performance-Tracker-by-MSK.git repo
# database (self-hosted example; managed DB differs slightly)
apt install -y postgresql
sudo -u postgres psql -c "CREATE USER spr WITH PASSWORD '<strong-db-password>';"
sudo -u postgres psql -c "CREATE DATABASE spr OWNER spr;"
# runtime dependency: the ONLY npm package needed in production
cd repo && npm install pg --registry=https://registry.npmmirror.com
# first boot creates the schema + bootstrap admin from env
SPR_DB_URL='postgres://spr:<strong-db-password>@127.0.0.1/spr' \
SPR_ADMIN_USER=owner SPR_ADMIN_PW='<strong-16+-char-password>' \
SPR_SCHOOL_NAME='<School name>' \
SPR_PORT=8787 node server/spr-server.mjs
```
- Change the bootstrap admin password at first sign-in (`must_change_pw` is enforced).
- Run under systemd with `Restart=always`, `DynamicUser` or a dedicated `spr` user; reverse-proxy with nginx/Caddy for TLS + rate limits at the edge.
- Firewall: expose only 80/443; PostgreSQL listens on localhost only.
- Recommended env: `SPR_COOKIE_SECURE=1` (default when not disabled).

## 3. Static app hosting
Serve `app/` + `index.html` from the same VPS (simplest: nginx root), so the API and the app share an origin — cookies stay first-party. GitHub Pages can remain as a fallback code mirror.

## 4. Front-end configuration for the school server
The shipped app is untouched until migration is approved; the staging wiring (source/app.js settings panel, `SPR_CLOUD` build marker) is added when the cut-over is scheduled — see MIGRATION-PLAN.md §3. Until then the app's cloud features remain on the interim (protected-only) Supabase path or fully local.

## 5. Backups & monitoring (owner sets these once)
- Nightly: `pg_dump spr | gzip | openssl enc -aes-256-cbc ...` to object storage; 35-day rotation; monthly restore drill (ROLLBACK-PLAN §restore).
- Monitoring: provider CPU/disk alerts; `GET /api/health` uptime probe; log ship of `audit_events` count per day (sudden zero = sync problem).
- Time: keep the server on Asia/Shanghai; NTP on.

## 6. Go-live gate (PRODUCTION-SECURITY-CHECKLIST.md must be all-checked)
ICP number issued → TLS valid → staging run with synthetic data green (RBAC + SYNC suites against the real DB) → school sign-off (PIPIA §16) → migrate teachers per MIGRATION-PLAN → 48 h dual-running watch.
