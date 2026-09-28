-- Slice 15: reading stats, and read_at finally written.
--
-- read_at was declared in 0001 and read by the library's Read/Unread filter,
-- but nothing ever wrote it (a Slice 8 box, found in Slice 5), so nothing
-- could be counted as finished. From here it is a first-finish stamp: set
-- the first time read_progress reaches 0.9, the line the backlog strip uses
-- for "unfinished", and never moved or cleared after. A trigger does it in
-- the same statement as the progress write, so every path that writes
-- progress stamps the same way, and two tabs racing cannot stamp twice.
begin;

-- Articles already read that far get a date too. When they were finished
-- was never recorded, so their last change stands in for it; the stats page
-- says those dates are approximate. The touch trigger moves their
-- updated_at to now, which nothing shows.
update public.items
   set read_at = updated_at
 where read_at is null
   and read_progress >= 0.9;

create function public.stamp_read_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only the first finish. Reopening an article from March must not move
  -- it into this week, and scrolling back up must not unfinish it.
  if old.read_at is null
     and new.read_at is null
     and new.read_progress >= 0.9 then
    new.read_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_read_at() from public, anon, authenticated;

create trigger items_stamp_read_at
  before update of read_progress on public.items
  for each row execute function public.stamp_read_at();

-- The last p_weeks ISO weeks up to and including p_week, newest first. The
-- weeks come from generate_series and everything is counted into them, so a
-- week with nothing in it is a row of zeros and not a missing row. Items in
-- Trash count nowhere, nor do their highlights. SECURITY INVOKER with no
-- user filter, like backlog_strip: RLS confines every count to the caller.
-- p_week comes from the server's clock, as the strip's does, so nothing here
-- reads now().
create function public.reading_stats(p_week text, p_weeks integer)
returns table (
  week_start       date,
  saved            integer,
  finished         integer,
  finished_minutes integer,
  highlights       integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with weeks as (
    select (to_date(p_week, 'IYYY-"W"IW') - 7 * g)::date as week_start
      from generate_series(0, least(greatest(p_weeks, 1), 52) - 1) as g
  ),
  span as (
    select min(week_start)::timestamp at time zone 'UTC' as starts from weeks
  ),
  saved as (
    select date_trunc('week', i.created_at at time zone 'UTC')::date
             as week_start,
           count(*)::integer as n
      from public.items i, span
     where i.deleted_at is null
       and i.created_at >= span.starts
     group by 1
  ),
  finished as (
    select date_trunc('week', i.read_at at time zone 'UTC')::date
             as week_start,
           count(*)::integer as n,
           -- Null when none of them has a reading time: unknown, not zero.
           sum(i.reading_minutes)::integer as minutes
      from public.items i, span
     where i.deleted_at is null
       and i.read_at >= span.starts
     group by 1
  ),
  marked as (
    select date_trunc('week', h.created_at at time zone 'UTC')::date
             as week_start,
           count(*)::integer as n
      from public.highlights h
      join public.items i on i.id = h.item_id, span
     where i.deleted_at is null
       and h.created_at >= span.starts
     group by 1
  )
  select w.week_start,
         coalesce(s.n, 0),
         coalesce(f.n, 0),
         f.minutes,
         coalesce(m.n, 0)
    from weeks w
    left join saved s on s.week_start = w.week_start
    left join finished f on f.week_start = w.week_start
    left join marked m on m.week_start = w.week_start
   order by w.week_start desc;
$$;

revoke all on function public.reading_stats(text, integer)
  from public, anon, service_role;
grant execute on function public.reading_stats(text, integer) to authenticated;

commit;
