# Security Review Acceptance — Round 19

Reviewed 2026-11-14 by executing attacks and sweeping source. Children's
educational records are treated as highly sensitive regardless of legal
classification. Evidence suites: `test-server-adversarial.mjs` **45/0**,
`test-server-rbac.mjs` 43/0, `test-data-safety.js` 36/0, `npm audit`
(**0 vulnerabilities**, prod deps; dev deps 0), browser suite 18/0.

## Mandate §12.1 checklist — actual status

| Area | Status | Evidence / note |
|---|---|---|
| SQL injection | ✅ safe | every query parameterised (`$n` placeholders); injection-shaped params return normal 4xx (adversarial §11); regex split of user input never concatenated into SQL |
| XSS | ✅ controlled | API is JSON-only with `nosniff`; app renders user data via `textContent` (data-safety suite); CSP in the app template restricts connect-src to same-origin + Supabase |
| CSRF | ✅ | per-session CSRF token on every non-GET; wrong token → 403 (rbac §1, adversarial §8) |
| Broken access control / BOLA / IDOR | ✅ | school + membership + duty checked on every path from the SESSION, not the body; record-id manipulation refused (adversarial §13: cross-school 404, identity guard 400) |
| Session fixation | ✅ | new session + new CSRF token issued at every login; cookie is set only by the server, never scripted |
| Session theft | ✅ mitigated | HttpOnly cookie (no JS access), standalone admin `revoke-sessions` (new, §13), password change revokes other sessions |
| Brute-force login | ✅ | per-username lockout + per-IP throttle → 429 with backoff message; audited `login.throttled` (adversarial, rbac §rate) |
| Password reset abuse | ✅ model-appropriate | admin-driven reset (school has no email); resets force `must_change_pw` + revoke all sessions; no self-service token to phish |
| Account enumeration | ✅ | unknown user / deactivated / wrong password identical response (verified §source + probe) |
| Insecure cookies | ✅ | HttpOnly + SameSite=Lax + Secure (default on; tests disable Secure explicitly via opt) |
| CORS misconfiguration | ✅ none | no CORS header is ever emitted (asserted §13b) — same-origin only by construction |
| CSP misconfiguration | ✅ | app template CSP; server adds nosniff/no-referrer/DENY on API AND static responses (§13b, hardened this round) |
| Open redirects | ✅ none | zero redirect endpoints (source sweep) |
| File upload | ✅ n/a | no upload endpoint exists; workbooks parse client-side |
| Export authorisation | ✅ | class export duty-checked (adversarial §9) |
| Error leakage | ✅ | short fixed strings (`no such class`, `not your class`); no stack traces, no SQL, no internals in responses |
| Insecure HTTP | ⚠️ deployment | the server itself is HTTP; TLS is terminated by the reverse proxy — REQUIRED in production (see deployment guide; a production checklist item, not a code defect) |
| Secrets in frontend bundle | ✅ none | sweep of built `app/index.html`: 0 matches |
| Secrets in repo history | ✅ per prior rounds | rounds 1–10 swept history; the Supabase anon key (public by design) is the only value ever present, in code, not a secret |
| Debug endpoints | ✅ none | only `/api/health` (status + store kind, no data) |
| Open ports | ✅ | one port, one process; bind host documented in deployment guide |
| Unprotected admin routes | ✅ | all `/api/admin/*` admin-only (rbac) |
| Dependency vulnerabilities | ✅ | `npm audit` 0 (prod and dev); zero runtime deps in the server |
| Crypto practices | ✅ | node:crypto scrypt (OWASP parameters) for passwords; AES-GCM (WebCrypto) for client sealing; sha256 token hashes; no custom primitives |

## Data protection (§12.2)

- In transit: TLS at the proxy (deployment requirement); cookie Secure by default.
- At rest: database volume encryption is a HOSTING control (checklist item);
  browser safety copies are sealed with the data key (data-safety suite).
- Keys: generated per class (WebCrypto), stored only in the owner's sealed
  storage, never in URLs (round-10 C3 fix, regression-tested), never logged.
- Backup encryption: Round 24 deliverable (encrypted export).
- Audit minimisation: audit events carry ids/versions/outcomes — never
  scores, notes or names (asserted by suite §12 which tries to mutate and
  reads back only counts).

## Logging (§12.3)

Server console output is startup lines only. No request logging of payloads.
The audit table is the operational log and is DB-immutable (trigger, §12).

## Audit immutability (§12.4) — honest threat model

- UPDATE/DELETE of `audit_events` raises at the DATABASE layer for ANY writer
  including the app role (adversarial §12: direct UPDATE and DELETE both
  throw; probe row survives).
- **Not claimed:** protection against a sufficiently privileged DBA altering
  rows by disabling the trigger, or altering backups. That requires separate
  privileged accounts + off-host WORM storage — deployment checklist items
  (ROUND 24/28), not achievable in application code alone. Documented as the
  actual residual risk.

## Findings register (severity, status)

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | Legacy Supabase rows anonymously readable (production project) | HIGH | Contained app-side; owner action pending (Round 20 doc) |
| F2 | `must_change_pw` not enforced | MEDIUM | **Fixed round 13** (server gate + bootstrap rule) |
| F3 | Static responses missing hardening headers | LOW | **Fixed round 19** (+ regression assertions §13b) |
| F4 | No standalone session revocation | LOW | **Fixed round 14** (`revoke-sessions`) |
| F5 | Outbox not per-account (shared-device edge) | LOW | Documented (offline acceptance); UX backlog |
| F6 | In-memory rate limiting (single instance only) | LOW | Accepted for single-instance deployment model; documented |
| F7 | No TLS at the app server itself | MEDIUM | By design (proxy terminates); production checklist gates it |

No CRITICAL findings open. F1 is the only HIGH — legacy, contained, awaiting
owner action; it does not affect the new backend.
