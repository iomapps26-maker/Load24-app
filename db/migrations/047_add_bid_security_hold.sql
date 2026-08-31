-- ₹1,000 Load Confirmation Rule (marketplace spec §5): every bid a user
-- places moves the configurable security-deposit amount
-- (platform_settings.bidding.security_deposit_amount, seeded ₹1000 in
-- 043_add_platform_settings.sql) into a real WALLET HOLD — a 'security_hold'
-- row in wallet_transactions, which the 014_add_wallet.sql trigger debits
-- from wallets.balance. It is *not* revenue: it's released back
-- ('security_release') automatically when the bid is declined or expires,
-- and when the trip that a confirmed bid produces is completed or cancelled.
--
-- Until this migration the amount was only balance-checked (routes/loadBids.js
-- POST / — "keep ₹1000 in your wallet"), never actually held.
--
-- The three columns below track one hold per bid:
--   security_hold_txn_id     — the 'security_hold' wallet_transactions row
--   security_hold_amount     — the amount held, snapshotted so a later
--                              Super-Admin change to security_deposit_amount
--                              doesn't retro-alter in-flight holds
--   security_hold_released_at — set once the matching 'security_release' has
--                              been written; an active hold is
--                              security_hold_txn_id is not null
--                              and security_hold_released_at is null
--
-- All writes go through the service-role client in routes/loadBids.js,
-- routes/admin/trips.js and lib/bidSecurityHold.js (same trust model as the
-- rest of the wallet module), so no RLS change is needed — the existing
-- load_bids_insert_own / load_bids_select_own_or_poster policies already
-- cover these columns for the two parties who can see a bid.

alter table public.load_bids
  add column if not exists security_hold_txn_id uuid references public.wallet_transactions(id),
  add column if not exists security_hold_amount numeric check (security_hold_amount is null or security_hold_amount >= 0),
  add column if not exists security_hold_released_at timestamptz;

-- Partial index for lib/wallet.js's held-balance sum and the expired-hold
-- sweep — the common lookup is "this bid's hold, still active".
create index if not exists load_bids_active_security_hold_idx
  on public.load_bids (id)
  where security_hold_txn_id is not null and security_hold_released_at is null;
