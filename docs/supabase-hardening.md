# Supabase hardening plan — SPR cloud channels

**Status: DOCUMENT ONLY. Nothing in this file has been applied to the live
project. Written 2026-10-22 for the owner (Mohammed Shehzad Khan).**

SPR uses one Supabase project as a dumb encrypted-blob store. Two features
depend on it: **Device Sync** (the admin's whole encrypted markbook, one row
per channel) and **Save & Share** (one sealed row per shared class). This page
explains, in plain terms, what the internet can and cannot do to those rows
today, and gives a step-by-step plan to tighten it without breaking any paired
device.

---

## (a) What is true today (verified by live probing, 2026-10-21/22)

Everything below was tested with nothing but the public key that ships inside
the app (so anyone who opens the site's dev tools has the same power):

| Capability of an anonymous internet user | Today |
|---|---|
| **List every row** in `spr_channels` (`GET /rest/v1/spr_channels`) | **YES** — the table is listable by anyone with the publishable key |
| **Read one row by exact id** | YES (needed by design: the share link carries the id) |
| **Overwrite a row's payload** (`PATCH`) | **YES** — anonymous PATCH is allowed; an attacker can replace a row's content or blank it |
| **Delete a row** (`DELETE`) | Verified earlier: the DELETE is accepted (HTTP 204) even when RLS silently ignores it — behaviour may vary with policies; treat as **possible** |
| **Decrypt a payload** | **NO** — payloads are AES-GCM sealed under a 256-bit key that only exists in pairing links/backups; each envelope also carries an HMAC the app verifies, so tampered ciphertext is detected and rejected |
| **Read student names, scores, passwords from a row** | **NO** — only unreadable ciphertext is ever stored |

Net effect: an attacker **cannot read or forge** the school's data, but they
**can destroy availability** — overwrite/tombstone rows so devices can't sync
(the app would report integrity failures / "cloud copy damaged"; local data and
JSON backups are untouched and remain the source of truth). Row ids are random
UUIDs, so an attacker must first LIST the table to find victim rows — which
today they can.

UNVERIFIED: the exact RLS policies created at setup time live in
`assets/supabase-setup.md`, which is **not in this repository** — I could not
read them. The probes above are the ground truth; if a policy document says
something different, trust the probes.

## (b) The fix (copy-pasteable)

Goal: anonymous users can read **only by exact id**, can never list, and can
update a row **only with a per-channel write token** whose hash lives in the
row. Run each block in the Supabase SQL editor.

### 1) Add the token column (harmless on its own)

```sql
alter table public.spr_channels
  add column if not exists write_token_hash text;

-- store hash of the token, never the token itself
comment on column public.spr_channels.write_token_hash is
  'sha256 hex of the per-channel write token; null = legacy row, update still open (dual-mode period)';
```

### 2) Lock listing down (RLS read policy: exact id only)

```sql
alter table public.spr_channels enable row level security;

drop policy if exists "read by exact id" on public.spr_channels;
create policy "read by exact id" on public.spr_channels
  for select to anon, authenticated
  using (true);   -- see NOTE below before deploying this exact line
```

**NOTE — read policy nuance.** Supabase REST filters are enforced *after* RLS:
a `using (true)` SELECT policy still lets anyone LIST. To make listing useless
you have two options; choose ONE:

*Option 1 (simplest, recommended):* keep `using (true)` for SELECT but move the
secret off the row — since payloads are already encrypted, listing only
exposes ciphertext + metadata (ids, timestamps). Accept metadata exposure,
block writes hard (step 3). Zero client changes.

*Option 2 (strict, needs client change):* require the request to know
something secret about the row. Add a `read_token_hash` column like below and
make SELECT `using (id = any(string_to_array(current_setting('request.headers', true)::json->>'x-spr-read', ',')::uuid[]))` — complex; only do this if metadata
exposure is unacceptable.

### 3) Lock writes behind the token (SECURITY DEFINER RPC)

```sql
-- anonymous users may ONLY write through this function, and only with the
-- token whose hash is stored in the row.
create or replace function public.spr_channel_write(
  p_id uuid,
  p_payload jsonb,
  p_share_name text,
  p_pushed_by text,
  p_pushed_at timestamptz,
  p_write_token text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  row_write_token_hash text;
begin
  select write_token_hash into row_write_token_hash
    from spr_channels where id = p_id for update;
  if row_write_token_hash is null then
    return 'legacy';                 -- dual-mode: old rows stay writable (see rollout)
  end if;
  if row_write_token_hash <> encode(digest(p_write_token, 'sha256'), 'hex') then
    return 'denied';
  end if;
  update spr_channels
     set payload = p_payload, share_name = p_share_name,
         pushed_by = p_pushed_by, pushed_at = p_pushed_at
   where id = p_id;
  return 'ok';
end; $$;

revoke all on function public.spr_channel_write(uuid, jsonb, text, text, timestamptz, text) from public;
grant execute on function public.spr_channel_write(uuid, jsonb, text, text, timestamptz, text) to anon, authenticated;

-- then REMOVE direct table write access:
drop policy if exists "anon write" on public.spr_channels;   -- name UNVERIFIED (see assets note)
revoke insert, update, delete on public.spr_channels from anon, authenticated;
```

(`digest()` needs the `pgcrypto` extension: `create extension if not exists pgcrypto;`)

### Matching client changes (sketch — do NOT ship before the SQL)

```js
// when a channel is created (Device Sync enable / Save & Share setup):
const writeToken = b64uFromBytes(crypto.getRandomValues(new Uint8Array(24)));
// PUT/POST the row with write_token_hash: sha256hex(writeToken)
// store writeToken next to the channel id in the local config (and pairing link)
// sbSave() switches from PATCH to:
await fetch(url + '/rest/v1/rpc/spr_channel_write', { method: 'POST',
  headers: sbHeaders(), body: JSON.stringify({ p_id: channel, p_payload: payload,
    p_share_name: name, p_pushed_by: who, p_pushed_at: at, p_write_token: token }) });
// tombstone/delete flows call the same RPC with a tombstone payload
```

Deletion (turn-off & delete cloud copy) should become a soft tombstone via the
RPC (already how the app degrades today), or an owner-run SQL snippet — never a
direct anon DELETE.

## (c) Staged rollout (keeps every current user working)

1. **Add column only.** Deploy step 1 alone. Nothing changes for anyone.
2. **Ship client dual-mode.** App version that: uses direct PATCH when the row
   has no `write_token_hash` (server answers `legacy`), and the RPC when it
   does. New channels are created WITH a token; old channels keep working.
3. **Migrate at leisure.** Re-enable Device Sync / re-share classes on each
   device — each re-creation gets a token-protected row. (The owner controls
   all channels; there are no external users to coordinate.)
4. **Close direct writes.** Deploy step 3 (revoke + RPC). Old un-migrated
   channels now fail writes — by then none should exist; verify with
   `select id, write_token_hash is null as legacy, pushed_at from spr_channels order by pushed_at desc;`
5. *(Optional)* strict SELECT per option 2 in step 2.

## (d) Rollback

Every stage is independently reversible:
- Column added, regretted: `alter table public.spr_channels drop column if exists write_token_hash;`
- RPC deployed, regretted: re-`grant insert, update, delete on public.spr_channels to anon;` and drop the function (`drop function public.spr_channel_write(uuid, jsonb, text, text, timestamptz, text);`) — the token-aware client detects the failure and falls back to PATCH (build this fallback in during stage 2).
- Before any stage: `select * from spr_channels order by pushed_at desc;` exported as JSON is a full backup of the cloud side (ciphertext is fine — devices hold the keys).

## (e) How to test each stage

With `curl` (or the REST runner in Supabase's dashboard), using ONLY the
publishable key:

1. **List attempt** `GET /rest/v1/spr_channels` → expect it to still work after
   stage 1 (accepted metadata exposure) or return `[]`/403 after a strict
   SELECT policy.
2. **Read by exact id** with a real channel id → must return the row (share
   links depend on it).
3. **Direct PATCH** `PATCH /rest/v1/spr_channels?id=eq.<id>` → expect
   403/empty after stage 4.
4. **RPC write, wrong token** → expect `"denied"`.
5. **RPC write, right token** → expect `"ok"` and `pushed_at` advanced.
6. **Legacy row RPC write** (during stages 2–3) → expect `"legacy"` and the row
   unchanged by that call (client falls back to PATCH, which still works).
7. **End-to-end**: two paired browsers, teacher edit → admin pull, then
   re-run `qa_rk/qa_devicesync.py` and `qa_rk/qa_ds_conflict.py` locally.

## What this does NOT change

- Encryption model, keys, pairing links, master password: untouched.
- Anyone with the pairing link AND a valid account password can still fully
  use the channel — that is the design (the link *is* the credential).
- The strongest protection remains: local data + downloaded JSON backups.
  The cloud is a convenience, never the only copy.
