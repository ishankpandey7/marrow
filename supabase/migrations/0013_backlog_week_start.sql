-- Slice 13 review fix: the backlog strip's pick must hold all week.
--
-- 0012 measured both time conditions against now(). The ranking was stable,
-- but the candidate set was not: an article crossing the 14-day line on a
-- Wednesday, or an old Not now running out, joined mid-week and could push
-- one of the three off the strip, although the strip says "A new pick every
-- Monday". Both conditions are now measured from the start of the ISO week
-- p_week names (Monday 00:00 UTC), so items join only when the week turns.
-- A fresh Not now still hides its item at once: its resurface_after is
-- always later than the week's start.
--
-- The minimum age becomes a parameter, so the number the strip states lives
-- once, in lib/backlog.ts. Changing it is then a code change, not a
-- migration. A caller passing another number changes only what they see:
-- RLS still confines the rows to their own.
begin;

drop function public.backlog_strip(text);

create function public.backlog_strip(p_week text, p_min_age_days integer)
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
  with week as (
    select to_date(p_week, 'IYYY-"W"IW')::timestamp at time zone 'UTC'
             as starts
  )
  select i.id, i.url, i.title, i.site_name, i.created_at,
         i.reading_minutes, i.read_progress
    from public.items i, week
   where i.status = 'ready'
     and i.deleted_at is null
     and i.archived_at is null
     and i.read_progress < 0.9
     and i.created_at <= week.starts - make_interval(days => p_min_age_days)
     and (i.resurface_after is null or i.resurface_after <= week.starts)
   order by md5(p_week || ':' || i.id::text), i.id
   limit 3;
$$;

revoke all on function public.backlog_strip(text, integer)
  from public, anon, service_role;
grant execute on function public.backlog_strip(text, integer) to authenticated;

commit;
