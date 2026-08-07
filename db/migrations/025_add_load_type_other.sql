-- Adds the same "Other" escape hatch used for trucks (022/023) to the load's
-- Required Truck Type, Fuel Type, Axle Type, and Body Type pickers on the
-- Post Load form — each otherwise a closed list, but real requirements
-- sometimes don't fit any of the presets. Selecting "other" also fills a
-- free-text column with what the poster actually typed. Special Conditions
-- needs no migration: it's already a free-form text[] with no check
-- constraint, so a custom condition is just appended as its own entry.
alter table public.loads drop constraint if exists loads_required_truck_type_check;
alter table public.loads add constraint loads_required_truck_type_check check (required_truck_type in (
  'mahindra_pickup', 'tata_407', 'tata_ace', 'chota_hathi', 'four_vehicle_loader',
  'eicher_truck', 'ashok_leyland', 'lcv', 'lgv', 'open_body', 'closed_body',
  'container', 'trailer', 'tanker', 'tipper', 'flatbed', 'car_carrier', 'other'
));

alter table public.loads drop constraint if exists loads_fuel_type_required_check;
alter table public.loads add constraint loads_fuel_type_required_check check (fuel_type_required in ('diesel', 'cng', 'electric', 'any', 'other'));

alter table public.loads drop constraint if exists loads_axle_type_check;
alter table public.loads add constraint loads_axle_type_check check (axle_type in ('single_axle', 'multi_axle', 'any', 'other'));

alter table public.loads drop constraint if exists loads_body_type_check;
alter table public.loads add constraint loads_body_type_check check (body_type in ('open', 'closed', 'container', 'any', 'other'));

alter table public.loads
  add column if not exists required_truck_type_other text,
  add column if not exists fuel_type_required_other text,
  add column if not exists axle_type_other text,
  add column if not exists body_type_other text;
