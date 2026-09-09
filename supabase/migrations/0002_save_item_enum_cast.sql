-- ============================================================================
-- Fix: save_item() failed with 42804 on every re-save.
--
--   column "status" is of type item_status but expression is of type text
--
-- In `status = case when ... then 'ready' else 'pending' end`, both results are
-- unknown-type literals, so Postgres resolves the CASE to text and then refuses
-- to assign text to an enum column. The comparison on the left of the WHEN is
-- fine — a lone literal compared against an enum coerces — which is why the
-- statement looks correct and only fails when it runs.
--
-- The failure was invisible until the first conflict: a first save takes the
-- INSERT path and never evaluates the CASE. So the bug only appeared when
-- someone saved a URL they already had, which is exactly the behaviour the
-- Slice 1 gotcha is about.
--
-- Also switches the ON CONFLICT references from `public.items.x` to `items.x`.
-- Inside DO UPDATE the existing row is addressed by the table's name in the
-- statement, and the schema-qualified spelling is not the documented form.
--
-- 0001_init.sql is left untouched: it has been applied, and applied migrations
-- are frozen. docs/SCHEMA.sql carries the corrected function, because it
-- documents the schema as it now stands.
-- ============================================================================

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
declare
  v_user uuid := (select auth.uid());
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

revoke all on function public.save_item(text, text, text) from public;
grant execute on function public.save_item(text, text, text) to authenticated;
