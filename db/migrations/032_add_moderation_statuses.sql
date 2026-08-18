-- Widens loads.status and trucks.status to support staff moderation
-- (PATCH /api/admin/moderation/loads/:id, /trucks/:id) — 'flagged' takes a
-- row out of normal circulation without deleting it (reversible: PATCH back
-- to whatever the row's real prior status was), 'removed' is a harder
-- takedown, still short of an actual delete so the data/audit trail
-- survives. Same drop-then-add-constraint pattern as
-- 022_add_truck_type_other.sql / 023_add_fuel_type_other.sql.

alter table public.loads drop constraint if exists loads_status_check;
alter table public.loads add constraint loads_status_check check (status in (
  'active', 'matched', 'in_transit', 'completed', 'cancelled', 'expired', 'flagged', 'removed'
));

alter table public.trucks drop constraint if exists trucks_status_check;
alter table public.trucks add constraint trucks_status_check check (status in (
  'active', 'inactive', 'flagged', 'removed'
));
