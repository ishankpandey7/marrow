-- Slice 10: a page the reader sent is not held back by a fetch backoff.
--
-- claim_fetch_job_for_item (0008) waits for run_after, which exists so a
-- struggling publisher is not asked again too soon. When the reader has sent
-- the page there is no publisher request at all, so that wait only meant the
-- page was silently dropped: paste a link that comes back unreachable, save
-- it again from the open tab inside the backoff, and the claim found nothing.
--
-- Dropped and recreated rather than overloaded, so there is one function.
-- The new argument defaults to false, so a caller naming only the first two
-- arguments (the code deployed before this) gets exactly 0008's behaviour.
begin;

drop function public.claim_fetch_job_for_item(uuid, uuid);

create function public.claim_fetch_job_for_item(
  p_item_id   uuid,
  p_user_id   uuid,
  p_page_sent boolean default false
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
                and (p_page_sent or c.run_after <= now())
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

revoke all on function public.claim_fetch_job_for_item(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_fetch_job_for_item(uuid, uuid, boolean)
  to service_role;

commit;
