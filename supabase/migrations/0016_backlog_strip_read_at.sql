-- The backlog strip asks read_at whether an article is finished (agreed with
-- Ishank on 2026-09-29, after Slice 15).
--
-- 0012 and 0013 wrote "unfinished" as read_progress < 0.9, because nothing
-- recorded finishing then. Since 0014 read_at does, and the two disagree in
-- two cases, both seen live: an article at exactly 90%, because real 0.9 is
-- below the numeric literal 0.9; and a finished article scrolled back up,
-- because read_progress is where the reader is now and falls again. Both
-- were Read in the library and still picked for the strip. read_at is never
-- cleared, so "read_at is null" is the rule the rest of the app already
-- uses. Everything else about the function is 0013's.
begin;

create or replace function public.backlog_strip(p_week text, p_min_age_days integer)
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
     and i.read_at is null
     and i.created_at <= week.starts - make_interval(days => p_min_age_days)
     and (i.resurface_after is null or i.resurface_after <= week.starts)
   order by md5(p_week || ':' || i.id::text), i.id
   limit 3;
$$;

-- create or replace keeps the grants; stated again so this file says them.
revoke all on function public.backlog_strip(text, integer)
  from public, anon, service_role;
grant execute on function public.backlog_strip(text, integer) to authenticated;

commit;
