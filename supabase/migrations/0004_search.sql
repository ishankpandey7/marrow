-- ============================================================================
-- Slice 5 — search.
--
-- What was already here, and is not repeated: both `search_tsv` columns and
-- both GIN indexes ship in 0001. `items.search_tsv` is weighted (A title,
-- B excerpt, C author, D site name); `item_content.search_tsv` is the article
-- body, unweighted. Nothing about the schema was missing.
--
-- What was missing is the query. It cannot be expressed through PostgREST:
-- `websearch_to_tsquery`, `ts_rank_cd` and `ts_headline` are not reachable
-- from the query builder, and neither is the shape below. So 0004 adds one
-- function and the row type it returns, and no columns and no indexes.
--
-- ----------------------------------------------------------------------------
-- The design problem, and the decision.
--
-- A title match must outrank a body match, but the title and the body live in
-- different tables with an index each. Three ways to combine them:
--
--   1. Join and OR: `where i.search_tsv @@ q or c.search_tsv @@ q`. Reads
--      well, and throws away both indexes — an OR across two relations cannot
--      be answered by either table's index, so it degrades to a scan of the
--      join. Rejected.
--   2. Denormalise the body into `items.search_tsv`. One index, one scan, and
--      it undoes the reason `item_content` exists: the list reads `items` on
--      every page load and would start dragging tens of kilobytes of article
--      text through every one of those reads. Rejected.
--   3. Ask each table separately and combine the answers. Each branch is an
--      ordinary single-table lookup, so each uses its own GIN index, and the
--      union is over item ids rather than over rows of article text.
--
-- Three is what this does. `matched` below is that union; `ranked` collapses
-- it to one row per item carrying both scores. The cost is that an item
-- matching in both places is found twice and then folded, which is a fold
-- over ids, not over documents.
--
-- ----------------------------------------------------------------------------
-- Why exclusion is a separate query rather than a `!term` inside the first.
--
-- It follows from the same split. `websearch_to_tsquery('radeon -nvidia')`
-- against `items.search_tsv` asks "the metadata says radeon and does not say
-- nvidia" — and the body remains free to say nvidia all it likes. A person
-- typing `-nvidia` means the item, not the title. So exclusions arrive as
-- their own query and are applied to both tables, and an item is dropped if
-- either one matches. lib/search.ts is what keeps them apart.
--
-- ----------------------------------------------------------------------------
-- Ranking, tuned against the nine real articles rather than fixtures.
--
--   metadata:  ts_rank_cd(..., 32)      normalisation 32 is rank/(rank+1),
--                                       which bounds the score to [0,1) so
--                                       the two ranks share a scale. No
--                                       length normalisation: titles and
--                                       excerpts are short by construction
--                                       and an item does not deserve a lower
--                                       rank for having a longer excerpt.
--
--   body:      ts_rank_cd(..., 1|32)    1 divides by 1 + log(length), then 32
--                                       bounds it. Cover density, because for
--                                       a multi-word query the terms landing
--                                       near each other is the signal.
--
-- The normalisation was chosen by measuring, and the losing options failed on
-- specific articles. Dividing by raw length (flag 2) put a 425-word review
-- that says "version" once above the 9,442-word PostgreSQL article that says
-- it thirty-nine times: too harsh on long documents. Plain `ts_rank` with the
-- same log normalisation scored every article in the corpus between 0.005 and
-- 0.010 for every term tried — flat enough to be no ordering at all. The
-- chosen pair puts the PostgreSQL article top for "version" and "support",
-- the storage-comparison article top for "storage" and "price", and drops the
-- PostgreSQL article to last for "price", which it mentions in passing.
--
-- BODY_WEIGHT below is 0.4, and the number is load-bearing rather than
-- decorative. A single title-only match scores 1.0 before normalisation and
-- therefore 0.5 after it, while a body rank cannot reach 1.0. At 0.4 the best
-- imaginable body match still loses to any title match — which is the
-- checklist's requirement — while comfortably beating a match found only in
-- an author (0.17) or a site name (0.09), which is the behaviour you want
-- when someone searches for a word that happens to appear in a domain.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A named composite rather than `returns table (...)`, for the reason spelled
-- out in 0003: those output names would be in scope inside the body, and half
-- of them — id, url, title, created_at — are column names in the very tables
-- being queried.
-- ----------------------------------------------------------------------------

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
  -- Kept separate from `rank` so a ranking argument can be settled by looking
  -- at a result page instead of by re-deriving it.
  rank            real,
  meta_rank       real,
  body_rank       real,
  snippet         text,
  snippet_source  text
);

-- ----------------------------------------------------------------------------
-- search_items
--
-- SECURITY INVOKER, which is to say: the default, deliberately. This function
-- has no ownership check of its own. It does not filter on user_id anywhere,
-- and it must not start to — the policies on items, item_content and
-- item_tags are the authorisation model (ARCHITECTURE section 4), and a
-- second copy of that rule living in here is a copy that drifts.
--
-- The consequence is the thing to remember: **this function must never be
-- made SECURITY DEFINER.** As invoker it sees exactly the caller's rows. As
-- definer it would see everyone's, and nothing else in the query would object.
--
-- include_query and exclude_query are the strings lib/search.ts builds. They
-- are only ever passed to websearch_to_tsquery, which accepts anything a
-- person can type and never throws. to_tsquery does throw, and is not used
-- here or anywhere else.
-- ----------------------------------------------------------------------------

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
