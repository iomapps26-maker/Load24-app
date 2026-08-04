-- Truck registry for the driver / vehicle_owner roles: the actual vehicle
-- details (registration, RC/insurance/permit/fitness papers, capacity) used
-- to authenticate that a truck is real and roadworthy, distinct from the
-- per-user KYC document uploads in 008_add_kyc_documents.sql (which cover the
-- person, not the vehicle). A vehicle_owner may register several trucks
-- (fleet); a driver typically registers the one they operate.
create table if not exists public.trucks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  registration_number text not null unique,
  truck_type text not null check (truck_type in (
    'mahindra_pickup','tata_407','tata_ace','chota_hathi','four_vehicle_loader',
    'eicher_truck','ashok_leyland','lcv','lgv','open_body','closed_body',
    'container','trailer','tanker','tipper','flatbed','car_carrier'
  )),
  capacity_tons numeric,
  chassis_number text,
  engine_number text,
  manufacturing_year integer,
  rc_number text,
  rc_expiry date,
  insurance_number text,
  insurance_expiry date,
  permit_number text,
  permit_expiry date,
  fitness_expiry date,
  puc_expiry date,
  driver_name text,
  driver_mobile text,
  driver_license_number text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trucks_owner_id_idx on public.trucks (owner_id);

alter table public.trucks enable row level security;

create policy "trucks_select_own_or_staff" on public.trucks
  for select using (
    owner_id = auth.uid()
    or public.has_role(array['admin','support_executive','support_manager'])
  );

create policy "trucks_insert_own" on public.trucks
  for insert with check (owner_id = auth.uid());

-- Owner can edit their own truck's details; verification (verified,
-- verified_at) is only ever set by staff via the service-role client, same
-- "owner can update the row, API controls which values it actually sends"
-- trust model used for kyc_cases_update_own in 008_add_kyc_documents.sql.
create policy "trucks_update_own" on public.trucks
  for update using (owner_id = auth.uid());

create policy "trucks_update_staff" on public.trucks
  for update using (public.has_role(array['admin','support_executive','support_manager']));

create policy "trucks_delete_own" on public.trucks
  for delete using (owner_id = auth.uid());
