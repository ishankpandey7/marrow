-- Slice 12: an index for the Trash list and for Empty trash.
--
-- /trash reads one user's soft-deleted items, newest deletion first, fifty
-- to a page, and Empty trash deletes that user's rows up to a cutoff. The
-- existing items_purge_idx is on (deleted_at) alone: it spans every user and
-- serves the cron's cross-user sweep, so it stays.
--
-- id is in the key because a bulk delete stamps one timestamp on every row
-- it touches. Ties on deleted_at are normal here, and paging has to break
-- them without a sort. The index is partial, so it holds at most about
-- thirty days of deletions.
begin;

create index items_trash_idx
  on public.items (user_id, deleted_at desc, id desc)
  where deleted_at is not null;

commit;
