-- Staff-managed enum values that used to be hardcoded arrays in route code
-- (TRUCK_TYPES/BODY_TYPES in apps/backend/src/routes/trucks.js) or would
-- otherwise become one as new features need their own closed lists
-- (material_category, cancellation_reason, support_category — no hardcoded
-- constant exists for these yet, so they're seeded empty below; add rows
-- via POST /api/admin/master-data whenever the feature that needs them
-- lands, same as any other category). `value` is the machine key routes
-- validate against and store; `label` is what the admin site / mobile app
-- display for it.
--
-- fuel_type and axle_type (trucks.js's other two closed lists) are
-- deliberately NOT migrated here or added to the category check below —
-- only truck_type/body_type were named in scope for this pass. Widen the
-- check constraint (and re-seed) if/when those move too.
create table if not exists public.master_data (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('truck_type', 'body_type', 'material_category', 'cancellation_reason', 'support_category')),
  value text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, value)
);

create index if not exists master_data_category_active_idx on public.master_data (category, is_active);

alter table public.master_data enable row level security;

-- Same shape as content_blocks: staff write everywhere, public read of
-- active rows as a defense-in-depth backstop (the actual read paths —
-- GET /api/master-data/:category and trucks.js's own validation query —
-- both go through supabaseAdmin, same reasoning as content_blocks_select_
-- active in 040_add_content_blocks_and_app_versions.sql).
create policy "master_data_staff_all" on public.master_data
  for all using (
    public.has_role(array['admin','support_executive','support_manager'])
  ) with check (
    public.has_role(array['admin','support_executive','support_manager'])
  );

create policy "master_data_select_active" on public.master_data
  for select using (is_active = true);

-- Seed: the exact values TRUCK_TYPES/BODY_TYPES held in trucks.js
-- immediately before this migration, so switching validation over to this
-- table (see trucks.js's validateEnums) changes nothing about which trucks
-- validate. on conflict do nothing makes this safe to re-run.
insert into public.master_data (category, value, label) values
  ('truck_type', 'mahindra_pickup', 'Mahindra Pickup'),
  ('truck_type', 'tata_407', 'Tata 407'),
  ('truck_type', 'tata_ace', 'Tata Ace'),
  ('truck_type', 'chota_hathi', 'Chota Hathi'),
  ('truck_type', 'four_vehicle_loader', 'Four Vehicle Loader'),
  ('truck_type', 'eicher_truck', 'Eicher Truck'),
  ('truck_type', 'ashok_leyland', 'Ashok Leyland'),
  ('truck_type', 'lcv', 'LCV'),
  ('truck_type', 'lgv', 'LGV'),
  ('truck_type', 'trailer', 'Trailer'),
  ('truck_type', 'tanker', 'Tanker'),
  ('truck_type', 'tipper', 'Tipper'),
  ('truck_type', 'flatbed', 'Flatbed'),
  ('truck_type', 'car_carrier', 'Car Carrier'),
  ('truck_type', 'other', 'Other'),
  ('body_type', 'open', 'Open'),
  ('body_type', 'closed', 'Closed'),
  ('body_type', 'container', 'Container'),
  ('body_type', 'other', 'Other')
on conflict (category, value) do nothing;
