-- ============================================================================
-- Marrow — schema
--
-- The schema as it currently stands. Migrations live in supabase/migrations/
-- and are forward-only: once one has run against a real database, never edit
-- it, write another. This file is the readable end state, so it carries every
-- correction those later migrations made — it is not a copy of 0001.
--
-- Two rules govern this file:
--
--   1. Every table has RLS enabled and a policy keyed on auth.uid(). There is
--      no table that relies on the application remembering to filter by user.
--   2. auth.uid() is wrapped as (select auth.uid()) in every policy. Postgres
--      then evaluates it once per statement instead of once per row. On a list
--      of a few thousand items that is the difference between 3 ms and 300 ms.
--
-- Verify after applying:
--
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' order by tablename;
--
-- Every row must read t.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

-- pending: saved, not yet fetched. ready: extracted. failed: see fail_reason.
create type public.item_status as enum ('pending', 'ready', 'failed');

-- Mirrors the failure taxonomy in ARCHITECTURE.md section 6. Every value has
-- user-facing copy. Adding a value here means adding copy there.
create type public.fail_reason as enum (
  'blocked_url',
  'unreachable',
  'not_found',
  'forbidden',
  'paywalled',
  'too_large',
  'unsupported_type',
  'js_required',
  'no_content',
  'server_error'
);

create type public.job_state as enum ('queued', 'running', 'done', 'failed');

-- ----------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles — one row per auth user
--
-- We do not query auth.users from the app. This is the public mirror, created
-- by a trigger on signup so there is never a window where a session exists
-- without a profile row to hang foreign keys off.
-- ----------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text        not null,
  display_name text,
  -- Reader preferences: font, theme, text size. Shaped by the client, not the
  -- database. Kept as jsonb so adding a preference is not a migration.
  settings     jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Runs as the definer because the signing-up user has no rights to public yet.
-- search_path is pinned: a security-definer function without it is a privilege
-- escalation waiting for someone to create a shadowing function in a schema
-- earlier on the path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- items — the list. This is the product.
--
-- Deliberately wide and deliberately without the article body: see item_content
-- below. Everything here is what the list needs to render a row.
-- ----------------------------------------------------------------------------

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,

  -- url is exactly what the user gave us, preserved for display and for the
  -- "open original" link. canonical_url is the normalised form from
  -- lib/canonical.ts; url_hash is its SHA-256, hex, lowercase. Dedupe keys on
  -- the hash, never on the raw url.
  url             text not null check (url <> ''),
  canonical_url   text not null check (canonical_url <> ''),
  url_hash        text not null check (url_hash ~ '^[0-9a-f]{64}$'),

  title           text,
  author          text,
  site_name       text,
  excerpt         text,
  lead_image_url  text,
  lang            text,
  word_count      integer check (word_count is null or word_count >= 0),
  reading_minutes integer check (reading_minutes is null or reading_minutes >= 0),
  published_at    timestamptz,

  status          public.item_status not null default 'pending',
  fail_reason     public.fail_reason,

  favourite       boolean not null default false,
  archived_at     timestamptz,
  -- 0..1. Written by the reader view as you scroll.
  read_progress   real not null default 0
                    check (read_progress >= 0 and read_progress <= 1),
  read_at         timestamptz,
  -- Soft delete. Purged for real after 30 days by /api/cron/purge.
  deleted_at      timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A failed item must say why, and a non-failed item must not claim a reason.
  -- Without this, a retry that forgets to clear fail_reason leaves a ready item
  -- permanently displaying an error, and nobody notices for a month.
  constraint items_fail_reason_matches_status
    check ((status = 'failed') = (fail_reason is not null))
);

create trigger items_touch_updated_at
  before update on public.items
  for each row execute function public.touch_updated_at();

-- Dedupe. Note what is NOT here: a "where deleted_at is null" clause. The
-- uniqueness spans deleted and archived rows on purpose, so re-saving a URL you
-- previously archived or deleted collides and is resurrected rather than
-- silently duplicated. See the Slice 1 gotcha in ROADMAP.md.
create unique index items_user_url_hash_key
  on public.items (user_id, url_hash);

-- The inbox query: not archived, not deleted, newest first.
create index items_inbox_idx
  on public.items (user_id, created_at desc)
  where deleted_at is null and archived_at is null;

-- The archive query.
create index items_archive_idx
  on public.items (user_id, archived_at desc)
  where deleted_at is null and archived_at is not null;

create index items_favourites_idx
  on public.items (user_id, created_at desc)
  where deleted_at is null and favourite;

-- Drives the purge cron.
create index items_purge_idx
  on public.items (deleted_at)
  where deleted_at is not null;

-- Full-text search over the metadata. Weighted: a title match should beat a
-- match on the site name. The body is indexed separately on item_content so a
-- large article does not bloat the row the list reads.
alter table public.items
  add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')),     'A') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')),   'B') ||
    setweight(to_tsvector('english', coalesce(author, '')),    'C') ||
    setweight(to_tsvector('english', coalesce(site_name, '')), 'D')
  ) stored;

create index items_search_idx on public.items using gin (search_tsv);

-- ----------------------------------------------------------------------------
-- item_content — the extracted article body
--
-- Split from items because it is tens of kilobytes and is read only when
-- someone opens one article, while items is read on every page load.
--
-- user_id is denormalised here. It is redundant against items.user_id, and it
-- is worth it: the RLS policy becomes a plain column comparison instead of an
-- EXISTS subquery against items, which Postgres would otherwise run per row.
-- The FK to items with ON DELETE CASCADE keeps the two in step.
-- ----------------------------------------------------------------------------

create table public.item_content (
  item_id      uuid primary key references public.items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- Sanitised HTML. Passed through lib/sanitize.ts before it ever gets here.
  -- Anything in this column is rendered into our own origin, so this column is
  -- a security boundary, not a cache.
  html         text not null,
  -- Plain text, for search and for word counting.
  text         text not null,
  -- Which extractor produced this, e.g. 'readability@0.6.0'. When a library
  -- upgrade changes output, this is how you find what to re-extract.
  extractor    text not null,
  extracted_at timestamptz not null default now()
);

alter table public.item_content
  add column search_tsv tsvector
  generated always as (to_tsvector('english', coalesce(text, ''))) stored;

create index item_content_search_idx on public.item_content using gin (search_tsv);
create index item_content_user_idx on public.item_content (user_id);

-- ----------------------------------------------------------------------------
-- tags
-- ----------------------------------------------------------------------------

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- What the user typed.
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  -- Normalised for matching: lowercased, spaces to hyphens. Two tags that
  -- differ only in case are one tag.
  slug       text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table public.item_tags (
  item_id    uuid not null references public.items (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, tag_id)
);

-- "Show me everything tagged X", the reverse of the primary key.
create index item_tags_tag_idx on public.item_tags (tag_id, item_id);
create index item_tags_user_idx on public.item_tags (user_id);

-- ----------------------------------------------------------------------------
-- highlights
-- ----------------------------------------------------------------------------

create table public.highlights (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- The highlighted text itself, stored verbatim. Offsets alone are not enough:
  -- a re-extraction can shift them, and a highlight that silently points at the
  -- wrong sentence is worse than one that fails to anchor.
  quote        text not null check (quote <> ''),
  note         text,
  start_offset integer not null check (start_offset >= 0),
  end_offset   integer not null,
  created_at   timestamptz not null default now(),
  check (end_offset > start_offset)
);

create index highlights_item_idx on public.highlights (item_id, start_offset);
create index highlights_user_idx on public.highlights (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- fetch_jobs — the extraction queue
--
-- Written only by the service role. Users can read their own rows so the UI can
-- show "retrying in a minute", and that is all.
-- ----------------------------------------------------------------------------

create table public.fetch_jobs (
  id           bigint generated always as identity primary key,
  item_id      uuid not null references public.items (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  state        public.job_state not null default 'queued',
  attempts     smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts > 0),
  -- Backoff. The claim query is "state = queued and run_after <= now()".
  run_after    timestamptz not null default now(),
  last_error   text,
  -- Set when a worker claims the row. A row stuck in running with a locked_at
  -- older than a few minutes is a crashed worker; the cron reclaims it.
  locked_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger fetch_jobs_touch_updated_at
  before update on public.fetch_jobs
  for each row execute function public.touch_updated_at();

-- The claim query. Partial, because done and failed rows are the vast majority
-- and are never claimed.
create index fetch_jobs_claim_idx
  on public.fetch_jobs (run_after)
  where state = 'queued';

-- Reclaiming crashed workers.
create index fetch_jobs_stuck_idx
  on public.fetch_jobs (locked_at)
  where state = 'running';

-- One open job per item. Without this, a user hammering "retry" queues five
-- fetches of the same URL and we hit someone else's server five times.
create unique index fetch_jobs_one_open_per_item
  on public.fetch_jobs (item_id)
  where state in ('queued', 'running');

create index fetch_jobs_user_idx on public.fetch_jobs (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- save_events — rate limiting
--
-- One row per accepted save. The limiter counts rows in a window. Kept in
-- Postgres rather than adding a Redis dependency for a counter; if this becomes
-- a bottleneck it is a good problem to have and a small change.
-- ----------------------------------------------------------------------------

create table public.save_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index save_events_window_idx on public.save_events (user_id, created_at desc);

-- ============================================================================
-- Row Level Security
--
-- Enabled on every table above, with no exceptions. Policies are split by
-- command rather than written as "for all", because select and delete deserve
-- different thought and a single "for all" policy hides that.
--
-- Note the absence of insert/update/delete policies on fetch_jobs and
-- save_events. That is deliberate: RLS denies by default, so those tables are
-- read-only to end users and writable only by the service role, which bypasses
-- RLS. Do not "fix" this by adding a policy.
-- ============================================================================

alter table public.profiles      enable row level security;
alter table public.items         enable row level security;
alter table public.item_content  enable row level security;
alter table public.tags          enable row level security;
alter table public.item_tags     enable row level security;
alter table public.highlights    enable row level security;
alter table public.fetch_jobs    enable row level security;
alter table public.save_events   enable row level security;

-- profiles ------------------------------------------------------------------
-- No insert policy: rows are created by the signup trigger, not by clients.
-- No delete policy: account deletion cascades from auth.users.

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- items ----------------------------------------------------------------------
-- with check on insert is what stops a client from writing a row owned by
-- someone else. using alone would not.

create policy items_select_own on public.items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy items_insert_own on public.items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy items_update_own on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Hard delete is allowed but the app soft-deletes. This policy exists so
-- "delete my account data" works without the service role.
create policy items_delete_own on public.items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- item_content ---------------------------------------------------------------
-- Read-only to users. The body is written by the extraction worker under the
-- service role; a client has no business authoring article HTML, and allowing
-- it would let anyone store arbitrary HTML that we later render.

create policy item_content_select_own on public.item_content
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- tags -----------------------------------------------------------------------

create policy tags_select_own on public.tags
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy tags_insert_own on public.tags
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy tags_update_own on public.tags
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy tags_delete_own on public.tags
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- item_tags ------------------------------------------------------------------

create policy item_tags_select_own on public.item_tags
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy item_tags_insert_own on public.item_tags
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy item_tags_delete_own on public.item_tags
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- highlights -----------------------------------------------------------------

create policy highlights_select_own on public.highlights
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy highlights_insert_own on public.highlights
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy highlights_update_own on public.highlights
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy highlights_delete_own on public.highlights
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- fetch_jobs / save_events ---------------------------------------------------
-- Select only. See the note at the top of this section.

create policy fetch_jobs_select_own on public.fetch_jobs
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy save_events_select_own on public.save_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ============================================================================
-- save_item — the save path, as one atomic statement
--
-- This exists because the re-save case is genuinely hard to get right in
-- application code. Saving a URL you already have must not error, must not
-- duplicate, and must bring the item back if you had archived or deleted it —
-- while leaving your tags, highlights and read position alone. Doing that as
-- select-then-insert-or-update in the app is a race: two taps of the extension
-- and you get a unique-violation 500.
--
-- security definer so it can write fetch_jobs, which end users cannot. It never
-- takes a user id as a parameter — it reads auth.uid() itself. A definer
-- function that accepts the caller's identity as an argument is a hole.
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
      -- Casts are load-bearing. Without them both branches are unknown-type
      -- literals, the CASE resolves to text, and assigning text to an enum
      -- column fails at runtime with 42804 — but only on a conflict, because a
      -- first save takes the INSERT path and never evaluates this. Fixed in
      -- 0002_save_item_enum_cast.sql.
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

-- ============================================================================
-- The extraction queue's machinery — added in 0003_jobs.sql
--
-- The tables above are the state; these are the only things allowed to move
-- it. All three run as the service role and nobody else: end users read
-- fetch_jobs through RLS and write nothing.
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

-- ============================================================================
-- Search (0004)
--
-- The two search_tsv columns and their GIN indexes are declared with their
-- tables above. What lives here is the query that reads them, because it is
-- not expressible through PostgREST: websearch_to_tsquery, ts_rank_cd and
-- ts_headline are not reachable from the query builder, and neither is the
-- union below.
--
-- The shape is the decision. Title and body are indexed in different tables,
-- and `where i.search_tsv @@ q or c.search_tsv @@ q` across a join uses
-- neither index. So each table is asked separately — one ordinary lookup per
-- GIN index — and the two answers are folded together by item id. Full
-- reasoning, including the ranking constants and how they were measured
-- against the real articles, is in supabase/migrations/0004_search.sql.
-- ============================================================================

create type public.search_hit as (
  id              uuid,
  url             text,
  title           text,
  site_name       text,
  excerpt         text,
  reading_minutes integer,
  status          public.item_status,
  fail_reason     public.fail_reason,
  created_at      timestamptz,
  favourite       boolean,
  archived_at     timestamptz,
  read_at         timestamptz,
  -- rank is the sort key. meta_rank and body_rank are the two halves it was
  -- built from, kept separate so that the next person to argue about ranking
  -- can call this function and read the two numbers instead of re-deriving
  -- them. Nothing renders them; the page has no business showing a relevance
  -- score, and tuning is done from a SQL client.
  rank            real,
  meta_rank       real,
  body_rank       real,
  snippet         text,
  snippet_source  text
);
create or replace function public.search_items(
  include_query  text,
  exclude_query  text,
  required_tags  uuid[],
  forbidden_tags uuid[],
  library_state  text,
  read_filter    text,
  limit_count    integer,
  offset_count   integer
)
returns setof public.search_hit
language sql
stable
set search_path = public, pg_temp
as $$
with matched as (
  -- Branch one: items_search_idx. Metadata only.
  select
    i.id as item_id,
    ts_rank_cd(i.search_tsv, websearch_to_tsquery('english', include_query), 32) as meta_rank,
    0::real as body_rank,
    false as body_hit
  from public.items i
  where include_query <> ''
    and i.search_tsv @@ websearch_to_tsquery('english', include_query)

  union all

  -- Branch two: item_content_search_idx. The article body.
  select
    c.item_id,
    0::real,
    ts_rank_cd(c.search_tsv, websearch_to_tsquery('english', include_query), 1|32),
    true
  from public.item_content c
  where include_query <> ''
    and c.search_tsv @@ websearch_to_tsquery('english', include_query)

  union all

  -- Branch three: `tag:physics` with no words. There is nothing to look up,
  -- so every item is a candidate and the filters below do the narrowing.
  select i.id, 0::real, 0::real, false
  from public.items i
  where include_query = ''
),
ranked as (
  select
    m.item_id,
    max(m.meta_rank) as meta_rank,
    max(m.body_rank) as body_rank,
    bool_or(m.body_hit) as body_hit
  from matched m
  group by m.item_id
),
filtered as (
  select
    i.*,
    r.meta_rank,
    r.body_rank,
    r.body_hit,
    -- BODY_WEIGHT. See the header.
    (r.meta_rank + 0.4 * r.body_rank)::real as score
  from ranked r
  join public.items i on i.id = r.item_id
  where i.deleted_at is null
    -- The Slice 4 filters, with the same meanings parseFilters gives them.
    and (library_state <> 'inbox' or i.archived_at is null)
    and (library_state <> 'archive' or i.archived_at is not null)
    and (library_state <> 'favourites' or i.favourite)
    and (read_filter <> 'read' or i.read_at is not null)
    and (read_filter <> 'unread' or i.read_at is null)
    -- Asked of the whole item: title or body, either one is enough to drop it.
    and (
      exclude_query = ''
      or (
        not (i.search_tsv @@ websearch_to_tsquery('english', exclude_query))
        and not exists (
          select 1
          from public.item_content x
          where x.item_id = i.id
            and x.search_tsv @@ websearch_to_tsquery('english', exclude_query)
        )
      )
    )
    -- Every required tag, not any of them: `tag:physics tag:optics` asks for
    -- items that are both, the same way two words do.
    and (
      coalesce(cardinality(required_tags), 0) = 0
      or (
        select count(distinct t.tag_id)
        from public.item_tags t
        where t.item_id = i.id and t.tag_id = any(required_tags)
      ) = cardinality(required_tags)
    )
    and not exists (
      select 1
      from public.item_tags t
      where t.item_id = i.id
        and t.tag_id = any(coalesce(forbidden_tags, '{}'::uuid[]))
    )
),
page as (
  select *
  from filtered
  -- created_at then id, so a page boundary cannot wobble between two items
  -- that scored identically — which, with no text query at all, is all of them.
  order by score desc, created_at desc, id desc
  limit limit_count
  offset offset_count
)
select
  p.id,
  p.url,
  p.title,
  p.site_name,
  p.excerpt,
  p.reading_minutes,
  p.status,
  p.fail_reason,
  p.created_at,
  p.favourite,
  p.archived_at,
  p.read_at,
  p.score,
  p.meta_rank,
  p.body_rank,
  -- ts_headline re-parses the whole document, so it runs here, after the
  -- limit, and never on the matches that did not make the page. On the
  -- 9,442-word article that is the difference between one re-parse and nine.
  --
  -- chr(2) and chr(3) are STX and ETX: markers the page splits on to render
  -- <mark> as elements. Not `<mark>` itself — the snippet is text from
  -- somebody else's web page, and it must never be handed to a renderer as
  -- HTML. Written as chr() so no invisible character has to survive being
  -- copied between this file, lib/search.ts and a test.
  case
    when include_query = '' then p.excerpt
    when p.body_hit and c.text is not null then
      ts_headline(
        'english', c.text,
        websearch_to_tsquery('english', include_query),
        -- The delimiter is quoted so its spaces survive the option parser.
        -- Unquoted, "…cycle, making some operations more…times faster…" is
        -- what comes back, and the ellipsis reads as a typo rather than a cut.
        'StartSel=' || chr(2) || ', StopSel=' || chr(3) ||
        ', MaxFragments=2, MaxWords=20, MinWords=8, FragmentDelimiter=" … "'
      )
    -- Neither branch below can be dropped in favour of the other. An item
    -- that matched on its title alone — every failed extraction is one, since
    -- it has no body — would otherwise be shown the opening words of an
    -- excerpt that does not contain the term, highlighting nothing and
    -- explaining nothing about why it is in the results.
    when to_tsvector('english', coalesce(p.excerpt, ''))
         @@ websearch_to_tsquery('english', include_query) then
      ts_headline(
        'english', p.excerpt,
        websearch_to_tsquery('english', include_query),
        'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', HighlightAll=TRUE'
      )
    when coalesce(p.title, '') <> '' then
      ts_headline(
        'english', p.title,
        websearch_to_tsquery('english', include_query),
        'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', HighlightAll=TRUE'
      )
    else p.excerpt
  end,
  case
    when include_query = '' then 'excerpt'
    when p.body_hit and c.text is not null then 'body'
    when to_tsvector('english', coalesce(p.excerpt, ''))
         @@ websearch_to_tsquery('english', include_query) then 'excerpt'
    when coalesce(p.title, '') <> '' then 'title'
    else 'excerpt'
  end
from page p
left join public.item_content c on c.item_id = p.id
$$;

-- EXECUTE on a new function is granted to PUBLIC by default, so the revoke
-- comes first and the grant second — the same order, and for the same reason,
-- as 0003. anon has no items and no business searching for any.
--
-- service_role is revoked too, and that one is not housekeeping. This
-- function is safe because RLS filters it, and RLS is exactly what the
-- service role bypasses: called from the worker it would happily return every
-- user's items to whoever asked. Nothing needs to call it that way, so the
-- warning above is made structural rather than left as a comment.
revoke all on function public.search_items(
  text, text, uuid[], uuid[], text, text, integer, integer
) from public, anon, service_role;

grant execute on function public.search_items(
  text, text, uuid[], uuid[], text, text, integer, integer
) to authenticated;
