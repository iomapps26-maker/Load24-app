-- Marketplace spec §5: the wallet security deposit held when a bid is placed
-- now SCALES with the bid amount instead of being a single flat figure. This
-- replaces platform_settings.bidding.security_deposit_amount (seeded ₹1000 in
-- 043_add_platform_settings.sql) with a slab table:
--
--   bid ≤ 10,000         -> ₹750
--   bid 10,001 – 20,000  -> ₹1,000
--   bid 20,001 – 30,000  -> ₹1,100
--   bid above 30,000     -> ₹1,100 + 1% of (bid − 30,000)
--
-- The evaluator is lib/platformSettings.js's computeBidSecurityHold() (mirrored
-- in apps/mobile/lib/bidSecurityDeposit.js for the PlaceBidScreen breakup);
-- staff edit the table from the admin panel via
-- PATCH /api/admin/platform-settings/bidding (routes/admin/platformSettings.js).
--
-- An empty slabs array disables the deposit entirely (the role the old
-- security_deposit_amount: 0 played). In-flight holds are unaffected — the
-- amount is snapshotted on load_bids.security_hold_amount (047).
--
-- No schema change: platform_settings is a key -> jsonb store. This migration
-- just rewrites the 'bidding' row's value. Safe to re-run.

update public.platform_settings
set value = (value - 'security_deposit_amount')
            || jsonb_build_object(
                 'security_deposit',
                 jsonb_build_object(
                   'slabs', jsonb_build_array(
                     jsonb_build_object('up_to', 10000, 'amount', 750),
                     jsonb_build_object('up_to', 20000, 'amount', 1000),
                     jsonb_build_object('up_to', 30000, 'amount', 1100)
                   ),
                   'above_slab_percent', 1
                 )
               ),
    updated_at = now()
where key = 'bidding';

-- Keep the insert-if-missing seed in sync for a fresh database.
insert into public.platform_settings (key, value)
values (
  'bidding',
  '{"load24_charge_percent": 4.0, "security_deposit": {"slabs": [{"up_to": 10000, "amount": 750}, {"up_to": 20000, "amount": 1000}, {"up_to": 30000, "amount": 1100}], "above_slab_percent": 1}}'::jsonb
)
on conflict (key) do nothing;
