-- Real-time trip location pings the mobile app posts periodically during an
-- active trip (matched/in_transit load) — powers the admin map view
-- (GET /api/admin/trips/:loadId/pings). recorded_at is the client-reported
-- capture time; created_at is when the server actually received it (these
-- can differ if a ping was queued offline and sent late).
create table if not exists public.trip_location_pings (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now(),
  reported_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists trip_location_pings_load_id_idx on public.trip_location_pings (load_id, recorded_at);

alter table public.trip_location_pings enable row level security;

-- Writes go through supabaseAdmin (see routes/tripLocationPings.js) — loads
-- .posted_by / load_bids.bid_by_email are emails, not user_ids, so "is this
-- caller a party to this trip" can't be expressed as a clean RLS check the
-- way owner_id = auth.uid() tables can (loadBids.js's trip-details/deliver
-- routes document the same constraint and use the same explicit-JS-check +
-- supabaseAdmin pattern). This policy is therefore just a read-only
-- backstop, staff-only — matching the admin-only surface this table
-- currently has.
create policy "trip_location_pings_select_staff" on public.trip_location_pings
  for select using (
    public.has_role(array['admin','support_executive','support_manager'])
  );
