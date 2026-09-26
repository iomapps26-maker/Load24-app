-- "by Support Team" attribution for the Executive Desk
-- (apps/backend/src/routes/executive.js).
--
-- When a support executive creates or edits something on a user's behalf
-- (the user phoned in), the row is the user's own — same owner columns, same
-- verification queues — plus these two columns recording which staff member
-- did it and when. The mobile app shows "by Support Team" wherever
-- support_staff_id is set; the admin portal shows the same label (and the
-- executive's identity via audit_log).
--
-- Only the backend's service-role client ever writes these (see
-- stampSupportAction in executive.js). User-facing routes never accept them
-- from a request body: every table below is written through an explicit
-- field pick, except loads, where routes/loads.js strips them.

alter table public.user_profiles
  add column if not exists support_staff_id uuid references auth.users(id) on delete set null,
  add column if not exists support_action_at timestamptz;

alter table public.kyc_cases
  add column if not exists support_staff_id uuid references auth.users(id) on delete set null,
  add column if not exists support_action_at timestamptz;

alter table public.bank_details
  add column if not exists support_staff_id uuid references auth.users(id) on delete set null,
  add column if not exists support_action_at timestamptz;

alter table public.trucks
  add column if not exists support_staff_id uuid references auth.users(id) on delete set null,
  add column if not exists support_action_at timestamptz;

alter table public.truck_availabilities
  add column if not exists support_staff_id uuid references auth.users(id) on delete set null,
  add column if not exists support_action_at timestamptz;

alter table public.loads
  add column if not exists support_staff_id uuid references auth.users(id) on delete set null,
  add column if not exists support_action_at timestamptz;
