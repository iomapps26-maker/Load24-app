-- Redesigns the truck form (020_add_trucks.sql) to match the fixed field
-- list the product actually wants: drops free-text document number/detail
-- columns in favor of real uploaded documents (RC, permit, PUC, insurance,
-- three vehicle photos), and adds the vehicle-spec fields that were missing
-- (tyres, body type, dimensions, owner name, fuel type, axle type).
-- RC has no expiry field per spec (only permit/PUC/insurance do).
alter table public.trucks
  drop column if exists chassis_number,
  drop column if exists engine_number,
  drop column if exists manufacturing_year,
  drop column if exists rc_number,
  drop column if exists rc_expiry,
  drop column if exists permit_number,
  drop column if exists insurance_number,
  drop column if exists driver_license_number;

alter table public.trucks
  add column if not exists tyre_count integer,
  add column if not exists body_type text check (body_type in ('open', 'closed', 'container')),
  add column if not exists length_ft numeric,
  add column if not exists width_ft numeric,
  add column if not exists owner_name text,
  add column if not exists fuel_type text check (fuel_type in ('diesel', 'cng', 'electric')),
  add column if not exists axle_type text check (axle_type in ('single_axle', 'multi_axle'));

-- ============================================================
-- truck_documents — one row per uploaded document type per truck, same
-- shape/relationship as kyc_documents (008_add_kyc_documents.sql) but keyed
-- to a truck instead of a kyc_case, since the document set here is fixed
-- (no per-role variation) rather than driven by config.
-- ============================================================
create table if not exists public.truck_documents (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  document_type text not null check (document_type in (
    'rc', 'permit', 'puc', 'insurance', 'photo_front', 'photo_back', 'photo_side'
  )),
  storage_path text not null,
  file_name text,
  mime_type text,
  uploaded_at timestamptz not null default now(),
  unique (truck_id, document_type)
);
create index if not exists truck_documents_truck_id_idx on public.truck_documents (truck_id);

alter table public.truck_documents enable row level security;

create policy "truck_documents_select_own_or_staff" on public.truck_documents
  for select using (
    exists (
      select 1 from public.trucks t
      where t.id = truck_id
        and (t.owner_id = auth.uid() or public.has_role(array['admin','support_executive','support_manager']))
    )
  );
create policy "truck_documents_insert_own" on public.truck_documents
  for insert with check (
    exists (select 1 from public.trucks t where t.id = truck_id and t.owner_id = auth.uid())
  );
create policy "truck_documents_update_own" on public.truck_documents
  for update using (
    exists (select 1 from public.trucks t where t.id = truck_id and t.owner_id = auth.uid())
  );
create policy "truck_documents_delete_own" on public.truck_documents
  for delete using (
    exists (select 1 from public.trucks t where t.id = truck_id and t.owner_id = auth.uid())
  );

-- Private bucket, same "signed URLs only, minted server-side" model as
-- kyc-documents in 008_add_kyc_documents.sql.
insert into storage.buckets (id, name, public)
values ('truck-documents', 'truck-documents', false)
on conflict (id) do nothing;

-- Object path convention: `${owner_id}/${truck_id}/${document_type}.${ext}`.
create policy "truck_documents_storage_select_own_or_staff" on storage.objects
  for select using (
    bucket_id = 'truck-documents'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.has_role(array['admin','support_executive','support_manager']))
  );
create policy "truck_documents_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'truck-documents' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "truck_documents_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'truck-documents' and auth.uid()::text = (storage.foldername(name))[1]
  );
