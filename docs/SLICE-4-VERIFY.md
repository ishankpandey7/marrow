# Slice 4 verification

## Database plans — requires your Supabase access

Run `docs/SLICE-4-EXPLAIN.sql` in psql against your database. It prompts for
real user, tag and item IDs, a tag slug, and the page offset. It sets the JWT
subject and switches to `authenticated` inside a transaction so RLS participates
in each plan. Check the printed `auth.uid()` before interpreting results.
It rolls back and makes no data, schema, index or planner-setting changes.

For the Supabase SQL Editor, remove the psql `\set` / `\prompt` commands,
replace each `:'slice4_…'` with a quoted real value and `:slice4_offset` with an
integer. Keep the role/JWT setup and transaction. Do not run plans as the
service role: that bypasses the ownership predicate the indexes depend on.

The file contains all 18 item-list statements: three states × three read
statuses × with/without a tag. Each includes the selected metadata, the lateral
tag aggregates, optional inner membership join, ordering and 51-row limit used
by PostgREST. Its outer response JSON envelope is omitted. The extra row is the
pagination sentinel; only 50 are rendered. Run with offset **0**, then **950**
against a user with at least 1,000 actual saved items. Use a common tag and a
rare tag when checking tagged plans.

| State (including its read/tag variants) | Expected partial index on `items` | Predicate / leading order                                            |
| --------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| Inbox                                   | `items_inbox_idx`                 | `deleted_at is null and archived_at is null`; `created_at desc`      |
| Archive                                 | `items_archive_idx`               | `deleted_at is null and archived_at is not null`; `archived_at desc` |
| Favourites                              | `items_favourites_idx`            | `deleted_at is null and favourite`; `created_at desc`                |

RLS supplies `user_id = (select auth.uid())`, the leading index key. Read status
is a residual filter within the chosen state. `id desc` breaks timestamp ties;
an incremental sort or sort of tied groups is expected. Tag membership and
display use `item_tags_pkey` / `item_tags_tag_idx`, with `item_tags_user_idx`
also available to the planner. All variants have a usable partial index path;
none requires a sequential scan of `items` by its shape. Actual planner choices
and latency have **not** been verified without credentials. A selective tag
could also favor primary-key probes into `items`; record that plan for review
against the roadmap's stricter partial-index requirement.

If any real item-list plan reports `Seq Scan on public.items`, stop and return
the plan for review. Do not hide it with `enable_seqscan = off`, or add an index
outside a migration. A small test table can tempt the cost-based planner into
a sequential scan; the required review is still against representative data.

The file also includes the paged tag catalogue, owned-item lookups (including
Undo) and tag-slug lookup. These auxiliary queries use existing ordinary indexes,
not the three list partial indexes. The tag catalogue can legitimately scan a
small `tags` table; the prohibition concerns the main `items` list.

## Manual interaction checks

1. In an unread inbox with 200 items, press `a` then `e` to archive the visible 50. Repeat as each server response fills the page. Time four batches against
   the two-minute goal. Also try `j`/`k`, `x`, `e`, `f`, `#`, `t`, `/`, `?`.
   `e` unarchives in the Archive view. Shortcuts work with checkbox focus and
   ignore text entry. `/` finds a title or URL on this page; full-library search
   remains Slice 5.
2. Shift-click forward and backward across a range. Bulk archive or tag it.
   Confirm excluded rows stay unchanged. Double-toggle favourite quickly and
   queue archives on several rows while the connection is slow.
3. Delete an item, wait at least 10 seconds, then Undo. Also Undo while the
   original delete is still saving. The row should return immediately and then
   match the server response. Undo has no timer and lasts while this page's
   client state remains mounted; it is not retained across a reload.
4. Create `Deep Work`, then type `deep   WORK`. There must be one tag.
   Autocomplete must work offline from the cached catalogue. Remove it, rename
   it in Manage tags, and check every affected row and the tag filter label.
   Renaming to an existing slug must reject visibly and retain both old tags.
5. Combine every state with a tag and read status. Reload, copy the URL to
   yourself, and use Back/Forward. Check page 20, equal timestamps, the last
   page, and deleting/archiving the last item on a page.
6. Reject a write with a test RLS policy in a disposable environment. Archive,
   favourite, delete, tag addition/removal/rename and bulk operations must roll
   back to returned data and show a visible error. After a transport failure,
   the last confirmed view returns and more triage is blocked until **Reload
   saved state** succeeds. A lost response can follow a committed write, so the
   message must not claim the database rejected it.
7. Check phone layout, Tab order, focus after a disappearing row, tag dialog
   focus, Escape, screen-reader labels and shortcut help. Refresh after each
   operation to confirm persistence.

## Known implementation boundaries

Tag creation and item association are two PostgREST writes. Association failure
may leave an unused real tag; the error says so and the returned catalogue
reflects it. Bulk association itself is one insert statement. Rename conflicts
are rejected rather than merging existing tags. No dependencies or migrations
were added.

Optimistic operations are replayed over authoritative snapshots in a serialized
queue. An older route refresh cannot overwrite a newer confirmed read. Each
pending Undo carries its original row so an earlier delete response cannot hide
the restoration. Unconfirmed queued writes are cancelled after a transport or
reconciliation failure; reload determines what was actually committed.
