-- Slice 9: claim the one job a save just queued, so it can be fetched at once.
--
-- The same claim as claim_fetch_jobs, narrowed to one item of one owner.
-- claim_fetch_jobs takes the oldest jobs of any user; used inside a save it
-- would spend this user's request fetching someone else's links. SKIP LOCKED
-- keeps it safe against the cron, a second tap, or the extension replaying its
-- offline queue: whoever loses simply gets no row. attempts increments here,
-- at claim time, exactly as in 0003.
begin;

create or replace function public.claim_fetch_job_for_item(
  p_item_id uuid,
  p_user_id uuid
)
returns setof public.claimed_fetch_job
language sql
volatile
set search_path = public, pg_temp
as $$
  with claimed as (
    update public.fetch_jobs j
       set state     = 'running'::public.job_state,
           attempts  = j.attempts + 1,
           locked_at = now()
     where j.id in (
             select c.id
               from public.fetch_jobs c
               join public.items i on i.id = c.item_id
              where c.item_id = p_item_id
                and c.user_id = p_user_id
                and c.state = 'queued'
                and c.run_after <= now()
                and c.attempts < c.max_attempts
                and i.deleted_at is null
              limit 1
              for update of c skip locked
           )
    returning j.id, j.item_id, j.user_id, j.attempts, j.max_attempts
  )
  select c.id, c.item_id, c.user_id, i.url, i.url_hash, c.attempts, c.max_attempts
    from claimed c
    join public.items i on i.id = c.item_id;
$$;

revoke all on function public.claim_fetch_job_for_item(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_fetch_job_for_item(uuid, uuid)
  to service_role;

commit;
