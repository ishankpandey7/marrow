-- Slice 4: executable psql plan checks. No writes or planner switches.
-- Supply real values at the prompts. Repeat with offsets 0 and 950.
-- SQL Editor users: replace psql variables with SQL literals and omit \prompt lines.
\set ON_ERROR_STOP on
\prompt 'Your user UUID: ' slice4_user
\prompt 'An existing tag UUID owned by that user: ' slice4_tag
\prompt 'Page offset (0 for page 1; 950 for page 20): ' slice4_offset
\prompt 'One or more owned item UUIDs, comma separated: ' slice4_items
\prompt 'An existing normalized tag slug: ' slice4_slug

begin;
set local request.jwt.claim.sub = :'slice4_user';
set local request.jwt.claim.role = 'authenticated';
set local role authenticated;
select auth.uid() as verify_this_is_your_user;

-- inbox / all / all tags
-- Expected items access: items_inbox_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.archived_at is null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- inbox / all / tag filter
-- Expected items access: items_inbox_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.archived_at is null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- inbox / read / all tags
-- Expected items access: items_inbox_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.archived_at is null
  and i.read_at is not null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- inbox / read / tag filter
-- Expected items access: items_inbox_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.archived_at is null
  and i.read_at is not null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- inbox / unread / all tags
-- Expected items access: items_inbox_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.archived_at is null
  and i.read_at is null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- inbox / unread / tag filter
-- Expected items access: items_inbox_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.archived_at is null
  and i.read_at is null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- archive / all / all tags
-- Expected items access: items_archive_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.archived_at is not null
order by i.archived_at desc, i.id desc
limit 51 offset :slice4_offset;

-- archive / all / tag filter
-- Expected items access: items_archive_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.archived_at is not null
order by i.archived_at desc, i.id desc
limit 51 offset :slice4_offset;

-- archive / read / all tags
-- Expected items access: items_archive_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.archived_at is not null
  and i.read_at is not null
order by i.archived_at desc, i.id desc
limit 51 offset :slice4_offset;

-- archive / read / tag filter
-- Expected items access: items_archive_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.archived_at is not null
  and i.read_at is not null
order by i.archived_at desc, i.id desc
limit 51 offset :slice4_offset;

-- archive / unread / all tags
-- Expected items access: items_archive_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.archived_at is not null
  and i.read_at is null
order by i.archived_at desc, i.id desc
limit 51 offset :slice4_offset;

-- archive / unread / tag filter
-- Expected items access: items_archive_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.archived_at is not null
  and i.read_at is null
order by i.archived_at desc, i.id desc
limit 51 offset :slice4_offset;

-- favourites / all / all tags
-- Expected items access: items_favourites_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.favourite = true
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- favourites / all / tag filter
-- Expected items access: items_favourites_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.favourite = true
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- favourites / read / all tags
-- Expected items access: items_favourites_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.favourite = true
  and i.read_at is not null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- favourites / read / tag filter
-- Expected items access: items_favourites_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.favourite = true
  and i.read_at is not null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- favourites / unread / all tags
-- Expected items access: items_favourites_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
where i.deleted_at is null
  and i.favourite = true
  and i.read_at is null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- favourites / unread / tag filter
-- Expected items access: items_favourites_idx; RLS supplies user_id = auth.uid().
explain (analyze, buffers, verbose)
select i.id, i.url, i.canonical_url, i.title, i.site_name, i.excerpt, i.reading_minutes, i.status, i.fail_reason, i.created_at, i.favourite, i.archived_at, i.deleted_at, i.read_at,
       coalesce(item_tags.item_tags, '[]'::json) as item_tags,
       matched_tags.matched_tags
from public.items as i
left join lateral (
  select json_agg(links) as item_tags
  from (select it.tag_id from public.item_tags as it where it.item_id = i.id) as links
) as item_tags on true
inner join lateral (
  select json_agg(matches) as matched_tags
  from (
    select mt.tag_id from public.item_tags as mt
    where mt.item_id = i.id and mt.tag_id = :'slice4_tag'::uuid
  ) as matches
) as matched_tags on matched_tags.matched_tags is not null
where i.deleted_at is null
  and i.favourite = true
  and i.read_at is null
order by i.created_at desc, i.id desc
limit 51 offset :slice4_offset;

-- Tag catalogue: auxiliary query, no items table / no partial index needed.
-- tags_user_id_slug_key supports ownership; tags_pkey supports id order.
-- Repeat with offsets 500, 1000, ... if your catalogue spans several pages.
explain (analyze, buffers, verbose)
select id, name, slug from public.tags order by id asc limit 500 offset 0;

-- Mutation ownership checks: direct primary-key lookups, not library scans.
-- These run before item writes and before tag attachment/removal.
explain (analyze, buffers, verbose)
select id from public.items
where id = any(string_to_array(:'slice4_items', ',')::uuid[]) and deleted_at is null;

-- Undo ownership check also admits soft-deleted rows; expected items_pkey.
explain (analyze, buffers, verbose)
select id from public.items
where id = any(string_to_array(:'slice4_items', ',')::uuid[]);

-- Resolve an existing or concurrently created tag; expected tags_user_id_slug_key.
explain (analyze, buffers, verbose)
select id from public.tags where slug = :'slice4_slug';

rollback;
