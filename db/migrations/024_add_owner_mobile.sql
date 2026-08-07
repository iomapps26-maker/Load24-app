-- Adds the owner's contact number alongside the existing owner_name
-- (021_redesign_truck_form.sql) — the form asks for a way to reach the
-- vehicle owner directly, separate from the driver's own mobile number.
alter table public.trucks
  add column if not exists owner_mobile text;
