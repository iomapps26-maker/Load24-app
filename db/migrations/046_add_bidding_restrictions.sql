-- Bid eligibility (marketplace spec §2): a bid may only be placed when the
-- bidder's account clears a set of conditions. Most were already enforced
-- somewhere (kyc_status in 045, self-bid in 017); this migration adds the
-- two that had no home:
--
--   * account active           — user_profiles.is_active (exists since 001,
--                                never gated bidding until now)
--   * no active bid restriction — new columns below: a staff-set
--                                bidding_restricted_until in the future
--                                blocks bidding, with bidding_restriction_reason
--                                shown to the user. Clearing = set back to null.
--
-- Staff set/clear these via PATCH /api/admin/moderation/users/:userId
-- (routes/admin/moderation.js). The friendly per-condition error comes from
-- lib/bidEligibility.js via routes/loadBids.js's POST /; the widened
-- load_bids_insert_own policy below is the real enforcement boundary for the
-- account-level conditions, same split as 045_add_load_id_seq_and_bid_pickup.sql.
-- The vehicle-level conditions (verified truck, matching type/capacity, valid
-- documents) stay route-only — a correlated trucks<->loads subquery in RLS
-- would be brittle, especially around the 'other' truck_type escape hatch.

alter table public.user_profiles
  add column if not exists bidding_restricted_until timestamptz,
  add column if not exists bidding_restriction_reason text;

-- Replace the 045 version of this policy, adding the account-active,
-- mobile-verified and not-restricted checks alongside the existing
-- email / not-own-load / kyc clauses.
drop policy "load_bids_insert_own" on public.load_bids;

create policy "load_bids_insert_own" on public.load_bids
  for insert with check (
    bid_by_email = (auth.jwt() ->> 'email')
    and not exists (
      select 1 from public.loads
      where loads.id = load_bids.load_id
      and loads.posted_by = (auth.jwt() ->> 'email')
    )
    and exists (
      select 1 from public.user_profiles
      where user_profiles.user_id = auth.uid()
      and user_profiles.kyc_status = 'verified'
      and user_profiles.is_active = true
      and user_profiles.mobile_verified = true
      and (
        user_profiles.bidding_restricted_until is null
        or user_profiles.bidding_restricted_until <= now()
      )
    )
  );
