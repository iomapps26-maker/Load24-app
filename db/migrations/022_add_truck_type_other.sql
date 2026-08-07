-- Adds an "Other" escape hatch to the truck's Vehicle Type and Body Type
-- pickers — both are otherwise closed lists, but real trucks sometimes
-- don't fit any of the presets. Selecting "other" also fills a free-text
-- column with what the owner actually typed.
alter table public.trucks drop constraint if exists trucks_truck_type_check;
alter table public.trucks add constraint trucks_truck_type_check check (truck_type in (
  'mahindra_pickup', 'tata_407', 'tata_ace', 'chota_hathi', 'four_vehicle_loader',
  'eicher_truck', 'ashok_leyland', 'lcv', 'lgv',
  'trailer', 'tanker', 'tipper', 'flatbed', 'car_carrier', 'other'
));

alter table public.trucks drop constraint if exists trucks_body_type_check;
alter table public.trucks add constraint trucks_body_type_check check (body_type in ('open', 'closed', 'container', 'other'));

alter table public.trucks
  add column if not exists truck_type_other text,
  add column if not exists body_type_other text;
