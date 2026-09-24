-- The save limit, enforced where every door to a save passes.
--
-- save_item has been granted to authenticated since 0001, and the 60-per-hour
-- check lived only in /api/save. Sign-up is open, so any account could call
-- /rest/v1/rpc/save_item directly, queue unlimited server-side fetches — the
-- egress ceiling ARCHITECTURE section 9 exists for — and push every other
-- user's saves back in claim_fetch_jobs' FIFO. The route keeps its own check,
-- because only it can put the wait into words and a Retry-After header; this
-- is the guard nobody can walk around.
--
-- Also adds retry_item. The reader's Try again used to call save_item, whose
-- re-save semantics un-archive the item and skipped the route's limit. A retry
-- changes fetch state and nothing else.
begin;

create or replace function public.enforce_save_limit(p_user_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Serialise this user's saves so count-then-insert cannot be raced by two
  -- requests that both see 59. Transaction-scoped: released at commit.
  perform pg_advisory_xact_lock(
    hashtext('public.save_events'), hashtext(p_user_id::text)
  );

  -- Keep in step with SAVE_LIMIT and SAVE_WINDOW_MS in lib/rate-limit.ts;
  -- test/schema.test.ts fails if they drift apart.
  if (
    select count(*)
    from public.save_events
    where user_id = p_user_id
      and created_at > now() - interval '1 hour'
  ) >= 60 then
    -- PT429 makes PostgREST answer a direct RPC call with HTTP 429.
    raise sqlstate 'PT429' using message = 'save rate limit exceeded';
  end if;
end;
$$;

-- Callable only from the definer functions below, which run as its owner.
revoke all on function public.enforce_save_limit(uuid)
  from public, anon, authenticated, service_role;

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

  perform public.enforce_save_limit(v_user);

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
      -- Casts are load-bearing; see 0002_save_item_enum_cast.sql.
      status      = case
                      when items.status = 'ready' then 'ready'::public.item_status
                      else 'pending'::public.item_status
                    end,
      fail_reason = case
                      when items.status = 'ready' then items.fail_reason
                      else null::public.fail_reason
                    end
  returning * into v_item;

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

create or replace function public.retry_item(p_item_id uuid)
returns public.items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_item public.items;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  perform public.enforce_save_limit(v_user);

  -- Only fetch state moves. Archive, favourite, tags and reading position stay
  -- where the reader left them: pressing Try again is not re-saving.
  update public.items
     set status      = 'pending'::public.item_status,
         fail_reason = null::public.fail_reason
   where id = p_item_id
     and user_id = v_user
     and deleted_at is null
     and status = 'failed'::public.item_status
  returning * into v_item;

  if not found then
    raise exception 'item cannot be retried' using errcode = 'P0002';
  end if;

  insert into public.fetch_jobs (item_id, user_id)
  values (v_item.id, v_user)
  on conflict do nothing;

  -- A retry is a server-side fetch like any save, so it spends the same limit.
  insert into public.save_events (user_id) values (v_user);

  return v_item;
end;
$$;

revoke all on function public.retry_item(uuid) from public, anon, service_role;
grant execute on function public.retry_item(uuid) to authenticated;

commit;
