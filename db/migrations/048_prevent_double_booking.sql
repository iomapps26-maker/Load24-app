-- Prevent double booking (marketplace spec §9). Once a load is confirmed
-- (its poster approves a bid — routes/loadBids.js POST /:id/approve, which
-- moves the load 'active' -> 'matched'), the load must lock: no new bids, no
-- second confirmation, no way to end up with two accepted bids on one load.
--
-- The route already claims the load row atomically (a conditional
-- update ... where status = 'active') and returns a friendly 409, and
-- lib/bidEligibility.js rejects a bid on a non-'active' load. The two guards
-- below are the real enforcement boundary underneath that — same
-- friendly-error-in-route / constraint-is-the-boundary split as
-- 017_prevent_self_bidding.sql and 045/046.

-- ---- 1. At most one accepted bid per load -------------------------------
--
-- A partial unique index: whatever the app does (a poster double-tapping
-- Approve on two different bids, two approve requests racing, a stale retry
-- landing after the fact), only the first transaction to move a bid to
-- 'approved' for a given load_id commits — the rest fail with 23505.
--
-- Caveat: a staff-cancelled trip (routes/admin/trips.js) leaves its bid
-- 'approved' while the load goes to 'cancelled', so this index also means a
-- cancelled load keeps its one accepted bid forever. That's consistent with
-- today's behaviour — nothing re-lists a cancelled load for bidding. A future
-- re-list flow would need to reject the old bid first.
--
-- If any load already carries 2+ 'approved' bids (bad data from before this
-- migration), this index will fail to build — reconcile those rows first:
--   select load_id, count(*) from public.load_bids
--   where status = 'approved' group by load_id having count(*) > 1;

create unique index if not exists load_bids_one_approved_per_load
  on public.load_bids (load_id)
  where status = 'approved';

-- ---- 2. Bidding closes the moment a load leaves 'active' ----------------
--
-- Re-declare load_bids_insert_own (last set in 046_add_bidding_restrictions.sql)
-- with an added clause: the target load must still be 'active'. Postgres has
-- no "alter policy add clause", so the whole policy is restated — every
-- existing clause is kept verbatim, only the loads.status check is new.

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
      select 1 from public.loads
      where loads.id = load_bids.load_id
      and loads.status = 'active'
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
