-- spr_channels write-token upgrade (data-safety item 5, 2026-10-28)
--
-- WHY: the channel id is derivable from a username, and the public publishable
-- key allowed anyone to PATCH garbage over a school's encrypted cloud backup.
-- HMAC inside each payload makes devices refuse tampered copies, but the
-- backup itself was being destroyed.
--
-- WHAT THIS DOES
--   1. keeps the last good payload in `previous` (one bad write is rollable),
--   2. stores only sha256(token) — the raw token lives only on paired devices,
--   3. moves writes behind a security definer RPC that requires the token,
--   4. removes direct anon UPDATE on the table.
--
-- RUN AS the project owner in the Supabase SQL editor. Devices on the
-- data-safety branch already send the header; older clients keep working for
-- READ (share links, pulls) but can no longer push until updated.
--
-- WHAT THIS DOES NOT DO
--   - It cannot un-leak a token that an attacker already copied off a paired
--     device; rotate by turning sync off and on (regenerates the token).
--   - Reads stay public by design (share links need anon SELECT).

-- 1. schema -----------------------------------------------------------------

alter table public.spr_channels
  add column if not exists write_token_hash text;
alter table public.spr_channels
  add column if not exists previous jsonb;

-- 2. backfill: rows written before this upgrade have no token yet. Leave
--    write_token_hash NULL; the RPC below REJECTS writes to NULL-hash rows
--    until the owner sets one, so nobody can quietly enrol a token of their
--    own on an unprotected row. To arm a row, run the app once as the admin
--    with sync on (it pushes with its token), then:
--      update spr_channels set write_token_hash =
--        encode(extensions.digest('<paste token from Manage & setup', 'sha256'), 'hex')
--      where id = '<channel uuid>';
--    (Manage & setup → Device sync shows the token after this app update.)

-- 3. write RPC ----------------------------------------------------------------

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

revoke execute on function public.spr_channel_write(uuid, text, jsonb, text, timestamptz, text) from public;
grant execute on function public.spr_channel_write(uuid, text, jsonb, text, timestamptz, text) to anon, authenticated;

-- 4. close the direct-write hole ----------------------------------------------

drop policy if exists "anon can update channels" on public.spr_channels;
drop policy if exists "channels updatable" on public.spr_channels;

create policy "no direct updates"
  on public.spr_channels for update to anon, authenticated
  using (false)
  with check (false);
