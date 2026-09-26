-- Slice 13: the "From your backlog" strip.
--
-- The strip shows up to three ready articles saved at least 14 days ago that
-- are not archived, not in Trash, less than 90% read, and not put off with
-- Not now. The rule is fixed and shown on the strip; ARCHITECTURE section 1
-- rules out an algorithmic feed, and a disclosed rule over the reader's own
-- saves is not one. lib/backlog.ts holds the same numbers, and
-- test/schema.test.ts fails if the two drift.
--
-- resurface_after: Not now sets it thirty days ahead. It is written through
-- the existing items_update_own policy, so no new policy is needed.
--
-- backlog_strip(p_week): which three is decided by ranking every candidate on
-- its own hash of the week and its id. Picking by index from one shuffle would
-- swap the whole strip whenever anything else in the backlog changed; ranked
-- per item, the strip changes only when one of its own items leaves. PostgREST
-- cannot order by an expression, so this has to be a function.
--
-- SECURITY INVOKER and no user filter, as search_items (0004): RLS confines it
-- to the caller. EXECUTE is revoked from service_role as well, because the
-- service role bypasses RLS and would get every user's backlog.
begin;

alter table public.items
  add column resurface_after timestamptz;

create function public.backlog_strip(p_week text)
returns table (
  id              uuid,
  url             text,
  title           text,
  site_name       text,
  created_at      timestamptz,
  reading_minutes integer,
  read_progress   real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select i.id, i.url, i.title, i.site_name, i.created_at,
         i.reading_minutes, i.read_progress
    from public.items i
   where i.status = 'ready'
     and i.deleted_at is null
     and i.archived_at is null
     and i.created_at <= now() - interval '14 days'
     and i.read_progress < 0.9
     and (i.resurface_after is null or i.resurface_after <= now())
   order by md5(p_week || ':' || i.id::text), i.id
   limit 3;
$$;

revoke all on function public.backlog_strip(text)
  from public, anon, service_role;
grant execute on function public.backlog_strip(text) to authenticated;

commit;
