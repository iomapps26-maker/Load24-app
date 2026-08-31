-- Small key -> jsonb store for tunable platform-wide values that are neither
-- a per-row rule engine (commission_rules, 035) nor CMS content
-- (content_blocks, 040). Seeded here with the 'bidding' key:
--
--   load24_charge_percent  — the headline Load24 charge shown to a bidder as
--                            part of the payment breakup on PlaceBidScreen
--   security_deposit_amount — the amount a bidder must be holding in their
--                            wallet before a bid is accepted
--
-- Both are read by the mobile app via GET /api/load-bids/config
-- (routes/loadBids.js) to render the breakup, and security_deposit_amount is
-- enforced server-side by that same file's POST / (a bid is rejected unless
-- the caller's available wallet balance is at least this amount). Staff
-- raise or lower either value from the admin panel via
-- /api/admin/platform-settings/bidding (routes/admin/platformSettings.js).
--
-- Writes always go through the service-role client in that admin router, so
-- the staff_all policy below is a defense-in-depth backstop, same disclaimer
-- as commission_rules_staff_all (035). Reads are open to any authenticated
-- user so the bid screen can fetch the current values.
create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

create policy "platform_settings_staff_all" on public.platform_settings
  for all using (
    public.has_role(array['admin','support_executive','support_manager'])
  ) with check (
    public.has_role(array['admin','support_executive','support_manager'])
  );

create policy "platform_settings_select_authenticated" on public.platform_settings
  for select using (auth.role() = 'authenticated');

insert into public.platform_settings (key, value)
values ('bidding', '{"load24_charge_percent": 4.0, "security_deposit_amount": 1000}'::jsonb)
on conflict (key) do nothing;
