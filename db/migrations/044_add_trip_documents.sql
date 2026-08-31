-- Per-trip paperwork the two counterparties attach after a bid is approved:
-- the E-Way Bill and the Bilty (lorry receipt). One of each per trip —
-- either party (the load's poster or the approved bidder) can upload or
-- replace it, and both parties see it on the Trip Details screen
-- (GET /api/load-bids/load/:load_id/trip-details). Writes go through
-- supabaseAdmin after an explicit JS party check in routes/loadBids.js —
-- loads.posted_by / load_bids.bid_by_email are emails, not user_ids, so
-- "is this caller a party to this trip" can't be a clean RLS check (same
-- constraint trip_location_pings / the trip-details+deliver routes document
-- and handle the same way). The policy below is therefore just a staff-only
-- read backstop.
--
-- Every `create policy` here is drop-then-create (Postgres has no
-- `create policy if not exists`) so this script is safe to re-run.
create table if not exists public.trip_documents (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  bid_id uuid not null references public.load_bids(id) on delete cascade,
  document_type text not null check (document_type in ('eway_bill', 'bilty')),
  uploaded_by uuid references auth.users(id),
  uploaded_by_email text,
  storage_path text not null,
  file_name text,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (load_id, document_type)
);
create index if not exists trip_documents_load_id_idx on public.trip_documents (load_id);

alter table public.trip_documents enable row level security;

drop policy if exists "trip_documents_select_staff" on public.trip_documents;
create policy "trip_documents_select_staff" on public.trip_documents
  for select using (
    public.has_role(array['admin', 'support_executive', 'support_manager'])
  );

-- Private bucket (public = false) — objects are only ever reachable through
-- short-lived signed URLs the Express API mints via the service-role client,
-- same as kyc-documents / wallet-payment-proofs.
insert into storage.buckets (id, name, public)
values ('trip-documents', 'trip-documents', false)
on conflict (id) do nothing;

-- Object path convention: `${uploader_user_id}/${load_id}-${document_type}.${ext}`
-- — keyed by the uploader so the `foldername[1] = auth.uid()` backstop below
-- still holds; a replace by the other party lands under their own folder and
-- routes/loadBids.js removes the previous object. Signed upload/view URLs are
-- minted server-side and already scope the exact path, so these policies are
-- a defense-in-depth backstop, same reasoning as kyc_documents_storage_*.
drop policy if exists "trip_documents_storage_select_own_or_staff" on storage.objects;
create policy "trip_documents_storage_select_own_or_staff" on storage.objects
  for select using (
    bucket_id = 'trip-documents'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.has_role(array['admin', 'support_executive', 'support_manager'])
    )
  );
drop policy if exists "trip_documents_storage_insert_own" on storage.objects;
create policy "trip_documents_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'trip-documents' and auth.uid()::text = (storage.foldername(name))[1]
  );
drop policy if exists "trip_documents_storage_update_own" on storage.objects;
create policy "trip_documents_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'trip-documents' and auth.uid()::text = (storage.foldername(name))[1]
  );
