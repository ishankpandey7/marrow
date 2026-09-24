-- Child rows can hang only off their owner's parent.
--
-- The item_tags and highlights policies check user_id = auth.uid() and
-- nothing else, and a plain foreign key checks that the parent exists, not
-- whose it is — foreign-key checks ignore RLS. So a signed-in user who knew
-- another user's item or tag UUID could insert a row pointing at it; for
-- item_tags that silently blocks the owner's own attach, which upserts with
-- ignoreDuplicates. Referencing (id, user_id) instead makes the row's user_id,
-- already pinned to auth.uid() by the policy, also have to own the parent.
--
-- Precheck on 2026-09-24: zero mismatched item_tags rows, zero highlights.
begin;

alter table public.items
  add constraint items_id_user_id_key unique (id, user_id);

alter table public.tags
  add constraint tags_id_user_id_key unique (id, user_id);

alter table public.item_tags
  drop constraint item_tags_item_id_fkey,
  drop constraint item_tags_tag_id_fkey,
  add constraint item_tags_item_owner_fkey
    foreign key (item_id, user_id)
    references public.items (id, user_id) on delete cascade,
  add constraint item_tags_tag_owner_fkey
    foreign key (tag_id, user_id)
    references public.tags (id, user_id) on delete cascade;

alter table public.highlights
  drop constraint highlights_item_id_fkey,
  add constraint highlights_item_owner_fkey
    foreign key (item_id, user_id)
    references public.items (id, user_id) on delete cascade;

commit;
