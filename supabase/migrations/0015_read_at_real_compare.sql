-- Slice 15 fix, found by the live check of 0014: compare progress as real.
--
-- read_progress is real, and real 0.9 is 0.89999998. Against the literal
-- 0.9, which is numeric, Postgres compares in double precision, so an
-- article at exactly 90% was not finished. The client rounds progress to
-- four places, so exactly 0.9 is a value it writes. Comparing against
-- 0.9::real puts both sides in the column's own precision.
begin;

-- 0014's backfill missed articles at exactly 0.9 for the same reason.
update public.items
   set read_at = updated_at
 where read_at is null
   and read_progress >= 0.9::real;

create or replace function public.stamp_read_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Only the first finish. Reopening an article from March must not move
  -- it into this week, and scrolling back up must not unfinish it.
  if old.read_at is null
     and new.read_at is null
     and new.read_progress >= 0.9::real then
    new.read_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_read_at() from public, anon, authenticated;

commit;
