-- Truck availability postings — the reverse of `loads` (020_add_trucks.sql
-- is the vehicle *registry*; this is a truck being advertised as free for
-- work). A registered truck can have many postings over its life, each with
-- its own lifecycle, so this is its own table rather than columns on
-- `trucks`. owner_id is denormalized from trucks.owner_id purely so RLS here
-- doesn't need a join to enforce "only the truck's owner may post/edit it".
create table if not exists public.truck_availabilities (
  id uuid primary key default gen_random_uuid(),
  truck_id uuid not null references public.trucks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,

  available_now boolean not null default true,
  available_from date,

  current_pincode text,
  current_city text,
  current_state text,
  preferred_routes text,
  destination_preference text,
  operating_radius_km numeric,

  expected_freight numeric,
  minimum_freight numeric,

  trip_preference text not null default 'single_trip' check (
    trip_preference in ('single_trip', 'return_load', 'regular_lane')
  ),

  -- Repeat availability schedule for regular fleet lanes — when
  -- is_recurring is true, recurring_days holds the weekday abbreviations
  -- (e.g. '{mon,wed,fri}') this posting should be re-created on. Actually
  -- regenerating future postings from this is a scheduled-job concern, not
  -- something this migration/table implements on its own.
  is_recurring boolean not null default false,
  recurring_days text[],

  status text not null default 'available' check (
    status in ('available', 'offered', 'held', 'booked', 'loading', 'trip_active', 'unavailable', 'maintenance')
  ),

  -- Auto-expiry: a background job flips stale postings to 'unavailable' and
  -- should prompt the owner to refresh — the job itself isn't part of this
  -- migration, just the column it reads/writes.
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists truck_availabilities_owner_id_idx on public.truck_availabilities (owner_id);
create index if not exists truck_availabilities_truck_id_idx on public.truck_availabilities (truck_id);
create index if not exists truck_availabilities_status_idx on public.truck_availabilities (status);

alter table public.truck_availabilities enable row level security;

-- Anyone authenticated can browse 'available' postings (this is the Find
-- Trucks side, same "any signed-in user can browse open listings" model as
-- `loads`) — the owner (or staff) can also see their own postings in every
-- other status. drop-then-create (rather than a bare create) so this script
-- is safe to re-run — Postgres has no `create policy if not exists`.
drop policy if exists "truck_availabilities_select_available_or_own_or_staff" on public.truck_availabilities;
create policy "truck_availabilities_select_available_or_own_or_staff" on public.truck_availabilities
  for select using (
    status = 'available'
    or owner_id = auth.uid()
    or public.has_role(array['admin','support_executive','support_manager'])
  );

drop policy if exists "truck_availabilities_insert_own" on public.truck_availabilities;
create policy "truck_availabilities_insert_own" on public.truck_availabilities
  for insert with check (
    owner_id = auth.uid()
    and exists (select 1 from public.trucks t where t.id = truck_id and t.owner_id = auth.uid())
  );

drop policy if exists "truck_availabilities_update_own" on public.truck_availabilities;
create policy "truck_availabilities_update_own" on public.truck_availabilities
  for update using (owner_id = auth.uid());

drop policy if exists "truck_availabilities_update_staff" on public.truck_availabilities;
create policy "truck_availabilities_update_staff" on public.truck_availabilities
  for update using (public.has_role(array['admin','support_executive','support_manager']));

drop policy if exists "truck_availabilities_delete_own" on public.truck_availabilities;
create policy "truck_availabilities_delete_own" on public.truck_availabilities
  for delete using (owner_id = auth.uid());

