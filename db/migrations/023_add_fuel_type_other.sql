-- Adds the same "Other" escape hatch (see 022_add_truck_type_other.sql) to
-- the truck's Fuel Type picker — a free-text detail column plus widening
-- the closed list to allow it.
alter table public.trucks drop constraint if exists trucks_fuel_type_check;
alter table public.trucks add constraint trucks_fuel_type_check check (fuel_type in ('diesel', 'cng', 'electric', 'other'));

alter table public.trucks
  add column if not exists fuel_type_other text;
