-- spr_channels write-token upgrade (round 5, 2026-10-29)
--
-- =====================================================================
--  DO NOT RUN YET. This file is verified against a mock of PostgREST
--  (tests/test-round5.js) but has NOT been run against the real
--  Supabase project. The reviewer runs it after verification.
--  If you run it while clients are older than the round5 build, cloud
--  pushes from those clients fail (they fall back to nothing). Wait
--  for the reviewer.
-- =====================================================================
--
-- WHY: the channel id is derivable from a username, and the public
-- publishable key allowed anyone to PATCH garbage over a school's
-- encrypted cloud backup. The round-4 header alone did nothing: a row
-- policy cannot see headers. This file moves writes behind two RPCs.
--
-- WHAT IT DOES
--   1. keeps the last good payload in `previous` (one bad write is rollable),
--   2. stores only sha256(token) — the raw token lives only on paired devices,
--   3. moves writes behind spr_channel_write (requires the token in the body),
--   4. removes direct anon UPDATE on the table,
--   5. adds spr_channel_enrol so an existing unprotected row can be armed
--      from the app ("Test cloud connection" / the next push) with a proof
--      that only a paired device can produce: the sync key itself, verified
--      by recomputing the row's payload HMAC. No manual token pasting.
--   6. adds spr_channel_ping, a read-only check used by the app's
--      "Test cloud connection" button.
--
-- THE THREE OWNER STEPS (after the reviewer says go). Run these one at a
-- time, top to bottom, in the Supabase SQL editor. Nothing else to type.
--
--   STEP 1: run every statement in this file (whole file, one go).
--   STEP 2: open SPR as the admin on your main computer, Manage & setup.
--   STEP 3: press "Test cloud connection". Expected: "the server knows
--           this device's write token, and pushes are protected."
--           If it says the channel was enrolled just now: correct, that
--           was the enrol RPC arming your existing cloud copy.
--
-- WHAT THIS DOES NOT DO
--   - It cannot un-leak a token that an attacker already copied off a
--     paired device; rotate by turning sync off and on (regenerates the
--     token and re-arms on the next push).
--   - Reads stay public by design (share links need anon SELECT); the
--     payloads are sealed and HMAC-checked, so a read is not a leak.
--
-- 1. schema -----------------------------------------------------------------

alter table public.spr_channels
  add column if not exists write_token_hash text;
alter table public.spr_channels
  add column if not exists previous jsonb;

-- 2. write RPC ---------------------------------------------------------------

create or replace function public.spr_channel_write(
  p_id uuid,
  p_token text,
  p_payload jsonb,
  p_pushed_by text,
  p_pushed_at timestamptz,
  p_share_name text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.spr_channels;
begin
  select * into v_row from public.spr_channels where id = p_id;
  if not found then
    raise exception 'spr_channel_write: channel not found';
  end if;
  if v_row.write_token_hash is null then
    raise exception 'spr_channel_write: channel has no token enrolled yet';
  end if;
  if encode(extensions.digest(p_token, 'sha256'), 'hex') <> v_row.write_token_hash then
    raise exception 'spr_channel_write: write token rejected';
  end if;

  update public.spr_channels set
    previous    = payload,          -- keep the last good copy for rollback
    payload     = p_payload,
    pushed_by   = p_pushed_by,
    pushed_at   = p_pushed_at,
    share_name  = p_share_name
  where id = p_id;
end;
$$;

-- 3. enrol RPC ----------------------------------------------------------------
-- Arms a pre-upgrade row (write_token_hash IS NULL) with the caller's token.
-- Proof: p_key is the channel's sync key. Only paired devices hold it. The
-- server cannot store it, but it CAN verify it against data already in the
-- row: the payload carries mac = base64url(HMAC-SHA256(key, ct)). Recompute
-- that HMAC with the caller's key; a stranger's key fails.

create or replace function public.spr_channel_enrol(
  p_id uuid,
  p_token text,
  p_key text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.spr_channels;
  v_ct text;
  v_mac_calc text;
begin
  select * into v_row from public.spr_channels where id = p_id;
  if not found then
    raise exception 'spr_channel_enrol: channel not found';
  end if;
  if v_row.write_token_hash is not null then
    raise exception 'spr_channel_enrol: channel already enrolled';
  end if;
  v_ct := v_row.payload->>'ct';
  if coalesce(v_ct, '') = '' or coalesce(v_row.payload->>'mac', '') = '' then
    raise exception 'spr_channel_enrol: row has no sealed payload to verify against';
  end if;
  -- base64url -> standard base64 (translate, then pad to a multiple of 4)
  v_mac_calc := encode(
    hmac(
      decode(rpad(translate(v_ct, '-_', '+/'), (length(v_ct) + 3) / 4 * 4, '='), 'base64'),
      decode(rpad(translate(p_key, '-_', '+/'), (length(p_key) + 3) / 4 * 4, '='), 'base64'),
      'sha256'),
    'base64');
  -- compare in the payload's alphabet: base64url, no padding
  v_mac_calc := translate(v_mac_calc, '+/', '-_');
  v_mac_calc := regexp_replace(v_mac_calc, '=+\s*$', '');
  if v_mac_calc <> (v_row.payload->>'mac') then
    raise exception 'spr_channel_enrol: proof rejected';
  end if;

  update public.spr_channels set
    write_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  where id = p_id;
end;
$$;

-- 4. ping RPC (read-only; the app's "Test cloud connection" button) -----------

create or replace function public.spr_channel_ping(
  p_id uuid,
  p_token text
) returns text
language sql
security definer
set search_path = public, extensions
as $$
  select case
    when not exists (select 1 from public.spr_channels where id = p_id)                  then 'no-row'
    when write_token_hash is null                                                        then 'no-token'
    when encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') = write_token_hash then 'ok'
    else 'bad-token'
  end
  from public.spr_channels where id = p_id;
$$;

-- 5. who may call what ---------------------------------------------------------

revoke execute on function public.spr_channel_write(uuid, text, jsonb, text, timestamptz, text) from public;
grant execute on function public.spr_channel_write(uuid, text, jsonb, text, timestamptz, text) to anon, authenticated;
revoke execute on function public.spr_channel_enrol(uuid, text, text) from public;
grant execute on function public.spr_channel_enrol(uuid, text, text) to anon, authenticated;
revoke execute on function public.spr_channel_ping(uuid, text) from public;
grant execute on function public.spr_channel_ping(uuid, text) to anon, authenticated;

-- 6. close the direct-write hole ------------------------------------------------

drop policy if exists "anon can update channels" on public.spr_channels;
drop policy if exists "channels updatable" on public.spr_channels;

create policy "no direct updates"
  on public.spr_channels for update to anon, authenticated
  using (false)
  with check (false);

-- NOTE: INSERT stays allowed for anon (a fresh channel is created by the
-- first push). Rows created after this file is run arrive WITH their
-- write_token_hash already set by the client, so they are armed from birth.
