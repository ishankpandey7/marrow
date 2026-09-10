-- ============================================================================
-- Slice 7 — the extraction queue's moving parts.
--
-- The tables were created in 0001. What was missing is the machinery that lets
-- more than one worker touch them safely: a claim that two overlapping cron
-- invocations can both run without processing the same job, a way to recover
-- rows abandoned by a worker that died mid-fetch, and the purge.
--
-- Everything here is executable by the service role only. End users read
-- fetch_jobs through RLS and write nothing; see the note above the policies in
-- docs/SCHEMA.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The shape claim_fetch_jobs hands back.
--
-- A named composite rather than "returns table (...)": those output names are
-- in scope inside the function body, and half of them — item_id, user_id, url
-- — are also column names in the tables being queried. A named type has no
-- such scope, so no reference in the body can ever be ambiguous.
--
-- url and url_hash ride along so the worker does not need a second read per
-- job just to learn what to fetch.
-- ----------------------------------------------------------------------------

create type public.claimed_fetch_job as (
  job_id       bigint,
  item_id      uuid,
  user_id      uuid,
  url          text,
  url_hash     text,
  attempts     smallint,
  max_attempts smallint
);

-- ----------------------------------------------------------------------------
-- claim_fetch_jobs — the whole design, in one statement.
--
-- FOR UPDATE SKIP LOCKED is the reason this is safe under overlapping
-- invocations. Vercel Cron fires every minute and a fetch is allowed ten
-- seconds, so two runs overlapping is the normal case, not the edge case.
-- Without SKIP LOCKED the second run blocks on the first run's rows and then
-- processes them anyway the moment the lock clears: the same URL fetched
-- twice, two writes racing on one item. With it, the second run simply sees
-- fewer rows and gets on with its own.
--
-- The lock is taken in the inner SELECT and named with "of c", because the
-- join to items must not be locked — items is written by the app on every
-- archive and every read-progress update, and locking it here would make the
-- cron and the reader contend over rows they have no quarrel about.
--
-- attempts increments here, at claim time, not at settle time. A worker that
-- dies mid-fetch has still spent an attempt, and an attempt that is never
-- counted is how a permanently failing job retries for ever.
--
-- Soft-deleted items are skipped rather than cancelled. Delete is undoable
-- while the page is open (Slice 4), so a job whose item comes back becomes
-- claimable again on the next tick with no bookkeeping at all. A job whose
-- item stays deleted is removed by the 30-day purge, through the FK cascade.
-- ----------------------------------------------------------------------------

create or replace function public.claim_fetch_jobs(p_limit integer)
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
              where c.state = 'queued'
                and c.run_after <= now()
                and c.attempts < c.max_attempts
                and i.deleted_at is null
              order by c.run_after
              limit p_limit
              for update of c skip locked
           )
    returning j.id, j.item_id, j.user_id, j.attempts, j.max_attempts
  )
  select c.id, c.item_id, c.user_id, i.url, i.url_hash, c.attempts, c.max_attempts
    from claimed c
    join public.items i on i.id = c.item_id;
$$;

-- ----------------------------------------------------------------------------
-- reclaim_stalled_fetch_jobs — the crashed-worker path.
--
-- A serverless function killed mid-fetch leaves its row in "running" with a
-- locked_at that stops moving. Nothing else will ever touch it, so the item
-- says "Fetching the article" for ever. That is the exact failure
-- ARCHITECTURE section 6 forbids: a save that is a spinner nobody resolves.
--
-- Two outcomes, and the second is the one that is easy to forget. A row with
-- attempts left goes back to the queue. A row that stalled on its last attempt
-- has nowhere left to go, so the job is closed *and the item is resolved with
-- it* — otherwise the job table looks tidy and the user still sees a spinner.
-- Only a still-pending item is touched: an item that reached "ready" by
-- another path keeps its body.
--
-- A running row with a null locked_at cannot happen through claim_fetch_jobs,
-- and is reclaimed anyway. It would be permanently invisible otherwise, and
-- the cost of being wrong about "cannot happen" is a row nobody ever fixes.
-- ----------------------------------------------------------------------------

create or replace function public.reclaim_stalled_fetch_jobs(p_stale_after interval)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_abandoned integer;
  v_requeued  integer;
begin
  with abandoned as (
    update public.fetch_jobs
       set state      = 'failed'::public.job_state,
           locked_at  = null,
           last_error = coalesce(last_error, 'stalled')
     where state = 'running'
       and (locked_at is null or locked_at < now() - p_stale_after)
       and attempts >= max_attempts
    returning item_id
  ),
  resolved as (
    update public.items i
       set status      = 'failed'::public.item_status,
           fail_reason = 'server_error'::public.fail_reason
      from abandoned a
     where i.id = a.item_id
       and i.status = 'pending'::public.item_status
    returning i.id
  )
  select count(*)::integer into v_abandoned from abandoned;

  update public.fetch_jobs
     set state     = 'queued'::public.job_state,
         locked_at = null,
         run_after = now()
   where state = 'running'
     and (locked_at is null or locked_at < now() - p_stale_after)
     and attempts < max_attempts;

  get diagnostics v_requeued = row_count;

  return v_abandoned + v_requeued;
end;
$$;

-- ----------------------------------------------------------------------------
-- purge_deleted_items — the 30-day boundary, in one place.
--
-- item_content, item_tags, highlights and fetch_jobs all cascade from items,
-- so this one delete is the whole purge. The interval is a parameter rather
-- than a literal so that the caller states the policy out loud, and so a
-- shorter window can be exercised without editing the schema.
-- ----------------------------------------------------------------------------

create or replace function public.purge_deleted_items(p_older_than interval)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.items
   where deleted_at is not null
     and deleted_at < now() - p_older_than;

  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants. These three act across every user's rows, which is exactly what the
-- service role is for and exactly what nobody else may do. Revoking from
-- PUBLIC first is the load-bearing half: EXECUTE on a new function is granted
-- to PUBLIC by default, and "authenticated" inherits it.
-- ----------------------------------------------------------------------------

revoke all on function public.claim_fetch_jobs(integer) from public, anon, authenticated;
revoke all on function public.reclaim_stalled_fetch_jobs(interval) from public, anon, authenticated;
revoke all on function public.purge_deleted_items(interval) from public, anon, authenticated;

grant execute on function public.claim_fetch_jobs(integer) to service_role;
grant execute on function public.reclaim_stalled_fetch_jobs(interval) to service_role;
grant execute on function public.purge_deleted_items(interval) to service_role;
