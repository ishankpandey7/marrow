-- Slice 11: highlights get length caps and a note-only update.
--
-- The table has existed since 0001 and nothing has written to it until now.
-- Its policies let a signed-in user write any row they own, and Supabase's
-- default table grants let that user set every column. The reader only ever
-- needs to create a highlight, change its note and delete it, so:
--
-- * quote and note are capped in SQL. The server action checks the same
--   caps, but PostgREST is reachable directly with a session, and sign-up is
--   open, so the limit has to live where every door leads.
-- * sessions may insert only the content columns (not id or created_at) and
--   may update only note. A highlight whose quote or offsets could be edited
--   after the fact would stop being the text the reader actually marked;
--   changing where a highlight points means deleting it and making another.
--
-- char_length counts code points; the app counts UTF-16 units, which is never
-- fewer, so anything the app accepts also passes here.
--
-- Precheck on 2026-09-25: zero highlights rows, so no existing row can fail.
begin;

alter table public.highlights
  add constraint highlights_quote_length check (char_length(quote) <= 2000),
  add constraint highlights_note_length
    check (note is null or char_length(note) <= 10000);

revoke insert, update on table public.highlights from anon, authenticated;
grant insert (item_id, user_id, quote, note, start_offset, end_offset)
  on public.highlights to authenticated;
grant update (note) on public.highlights to authenticated;

commit;
