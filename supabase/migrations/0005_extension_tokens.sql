-- Slice 6: one save implementation, authenticated web and save-only token entry points.
-- Keep creation and grants in one transaction: PUBLIC receives EXECUTE by default.
begin;
create or replace function public.save_item_impl(
  p_user_id       uuid,
  p_url           text,
  p_canonical_url text,
  p_url_hash      text
)
returns public.items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := p_user_id;
  v_item public.items;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.items (user_id, url, canonical_url, url_hash)
  values (v_user, p_url, p_canonical_url, p_url_hash)
  on conflict (user_id, url_hash) do update
    set
      -- Bring it back into the inbox.
      archived_at = null,
      deleted_at  = null,
      -- Refresh the display URL: the new one may carry a working link where the
      -- old one has rotted.
      url         = excluded.url,
      updated_at  = now(),
      -- Re-queue extraction only if we never got the content. A ready item
      -- keeps its body, its excerpt and its read position. Deliberately NOT
      -- touching read_progress, read_at, favourite, or any tag.
      -- Casts are load-bearing. Without them both branches are unknown-type
      -- literals, the CASE resolves to text, and assigning text to an enum
      -- column fails at runtime with 42804 — but only on a conflict, because a
      -- first save takes the INSERT path and never evaluates this. Fixed in
      -- 0002_save_item_enum_cast.sql.
      status      = case
                      when items.status = 'ready' then 'ready'::public.item_status
                      else 'pending'::public.item_status
                    end,
      fail_reason = case
                      when items.status = 'ready' then items.fail_reason
                      else null::public.fail_reason
                    end
  returning * into v_item;

  -- Queue a fetch unless the content is already here, or a job is already open
  -- for this item. The partial unique index makes the second condition safe
  -- under concurrency; do nothing swallows the collision.
  if v_item.status <> 'ready' then
    insert into public.fetch_jobs (item_id, user_id)
    values (v_item.id, v_user)
    on conflict do nothing;
  end if;

  insert into public.save_events (user_id) values (v_user);

  return v_item;
end;
$$;

revoke all on function public.save_item_impl(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_item_impl(uuid, text, text, text)
  to service_role;

-- An identity argument is safe only behind the service-role-only grant above.
-- Authenticated callers still enter here and cannot choose another user id.
create or replace function public.save_item(
  p_url           text,
  p_canonical_url text,
  p_url_hash      text
)
returns public.items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.save_item_impl(
    (select auth.uid()), p_url, p_canonical_url, p_url_hash
  );
end;
$$;

revoke all on function public.save_item(text, text, text) from public;
grant execute on function public.save_item(text, text, text) to authenticated;

-- Bearer plaintext is shown once and stays in the extension's local storage.
-- The server stores only HMAC-SHA256(token), keyed by EXTENSION_TOKEN_SECRET.
create table public.extension_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create index extension_tokens_user_idx
  on public.extension_tokens (user_id, created_at desc);

alter table public.extension_tokens enable row level security;

create policy extension_tokens_select_own on public.extension_tokens
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy extension_tokens_insert_own on public.extension_tokens
  for insert to authenticated
  with check ((select auth.uid()) = user_id and revoked_at is null);

create policy extension_tokens_revoke_own on public.extension_tokens
  for update to authenticated
  using ((select auth.uid()) = user_id and revoked_at is null)
  with check ((select auth.uid()) = user_id and revoked_at is not null);

-- Override Supabase's default table grants: sessions can issue and revoke,
-- but cannot read hashes, alter ownership, or reactivate revoked credentials.
revoke all on table public.extension_tokens from public, anon, authenticated;
grant select (id, user_id, name, created_at, revoked_at)
  on public.extension_tokens to authenticated;
grant insert (user_id, name, token_hash)
  on public.extension_tokens to authenticated;
grant update (revoked_at) on public.extension_tokens to authenticated;
grant all on table public.extension_tokens to service_role;

commit;
