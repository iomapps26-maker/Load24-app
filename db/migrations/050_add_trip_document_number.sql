-- The reference number printed on a trip document — today the 12-digit E-Way
-- Bill number captured on Trip Details (routes/loadBids.js
-- POST /load/:load_id/documents/number). Kept on the same trip_documents row as
-- the file (one per load_id+document_type) so it can be entered before, after,
-- or without an upload — which is why storage_path must become nullable: a
-- number-only row has no object in Storage yet.
--
-- Re-runnable, same as migration 044.
alter table public.trip_documents
  add column if not exists document_number text;

alter table public.trip_documents
  alter column storage_path drop not null;

alter table public.trip_documents
  drop constraint if exists trip_documents_document_number_len;
alter table public.trip_documents
  add constraint trip_documents_document_number_len
  check (document_number is null or char_length(document_number) <= 40);
