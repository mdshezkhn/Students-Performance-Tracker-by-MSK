# SCHOOL PLATFORM ISOLATION AUDIT — 2026-11-15

Question: does any **runtime** component of the school platform (school-edition
backend, school sync client, adapter, audit, migrations, build) reference the
legacy personal-scorebook Supabase project? Answer: **no — isolation is complete.**

## 1. What was searched (this session, at `e4beda8`)

- `grep -rn "hvjswsedoapsskedrkoj"` across the whole repo (excluding `.git`,
  `node_modules`, `.freshclone` mirror).
- `grep -c "hvjswsedoapsskedrkoj|supabase"` over `server/*.mjs`,
  `source/schoolsync.js`, `source/spradapter.js`, `source/spraudit.js`,
  `server/migrations/*.sql` → **0 hits everywhere**.
- Environment variables: no `SUPABASE*` env vars exist anywhere in
  `source/`, `server/`, `tests/`, `package.json` (the scorebook's URL+key are
  hardcoded in `source/app.js` by design; the school backend uses none).

## 2. Reference census (complete list)

| Location | Kind | Runtime? |
|---|---|---|
| `source/app.js` (1 hit) | scorebook cloud config | **yes — personal scorebook only** |
| `app/index.html`, `deploy/app/index.html`, `dist/app/index.html` (1 hit each) | generated copies of the same line; all three byte-identical (`f924b90a…`) | yes — scorebook only |
| `docs/*.md` (5 files), `docs/qa/voice/copy-changes.md` | documentation / evidence | **no** |
| `.freshclone/…` | archived pre-round5 mirror (kept deliberately as history) | no |
| `tests/*` | Supabase behavior is **mocked** (jsdom fetch stubs / PGlite); no suite contacts the legacy project | no |

## 3. Coupling risks checked

- **Shared credentials**: none. The school backend's secrets are its own
  (`SESSION_SECRET`, admin bootstrap password via env); the scorebook's
  Supabase publishable key is public-by-design and appears nowhere in
  `server/`.
- **Shared endpoints**: none. School client talks same-origin `/api/*` only
  (`source/schoolsync.js`), school server never calls out to Supabase.
- **Build coupling**: `python source/build2.py` inlines `source/*.js` only;
  the school modules (`schoolsync.js`, `spradapter.js`, `spraudit.js`) contain
  zero Supabase references, so the generated bundle's single Supabase hit is
  the scorebook line above.
- **Server-side**: `server/spr-server.mjs`, `server/store.mjs`,
  `server/migrations/001..002.sql` — clean (0 hits).
- **Deployment scripts / workflows**: `.github/workflows/*` run tests only;
  no Supabase CLI, no env injection, no deploy-to-Supabase step.

## 4. Conclusion

The school platform has **no runtime, build, credential, endpoint or
environment coupling** to the legacy project. The only executable dependency
on `hvjswsedoapsskedrkoj.supabase.co` is the personal scorebook's cloud save
(single table `spr_channels`), which the executed containment now protects
(token-gated writes, sealed payloads). Documentation references are evidence,
not code paths. **PASS.**
