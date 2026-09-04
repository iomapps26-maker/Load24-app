-- Guard against over-withdrawal races.
--
-- routes/wallet.js's POST /api/wallet/withdraw reads getAvailableBalance()
-- (wallets.balance minus the sum of pending+approved withdrawal_requests) and
-- then inserts a withdrawal_requests row — the balance itself isn't debited
-- until staff mark the request paid. Two concurrent requests (double-tap, two
-- devices) can both pass the JS check and both get queued, so open withdrawals
-- can exceed the wallet balance. The wallets.balance >= 0 CHECK
-- (014_add_wallet.sql) still stops the *second payout* from going through, so
-- no money is lost — but staff hit a confusing failure at pay time and the
-- user sees two pending requests for money they have once.
--
-- This trigger closes the race at the source: on insert (or on a transition
-- back into pending/approved) it locks the wallet row and asserts that the sum
-- of all open withdrawals for that wallet does not exceed its balance. The
-- FOR UPDATE lock serialises concurrent inserts against the same wallet, so
-- the second one sees the first's committed row and is rejected cleanly with a
-- 23514-style error the API already surfaces as a normal 400.

create or replace function public.assert_withdrawals_within_balance() returns trigger as $$
declare
  wallet_balance numeric;
  open_total numeric;
begin
  -- Only the states that hold money out of the available balance matter.
  if new.status not in ('pending', 'approved') then
    return new;
  end if;

  select balance into wallet_balance
    from public.wallets
    where id = new.wallet_id
    for update;

  if wallet_balance is null then
    raise exception 'wallet % not found for withdrawal request', new.wallet_id;
  end if;

  select coalesce(sum(amount), 0) into open_total
    from public.withdrawal_requests
    where wallet_id = new.wallet_id
      and status in ('pending', 'approved')
      and id <> new.id;

  if open_total + new.amount > wallet_balance then
    raise exception 'withdrawal of % would exceed available balance (open: %, balance: %)',
      new.amount, open_total, wallet_balance
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists withdrawal_requests_within_balance on public.withdrawal_requests;
create trigger withdrawal_requests_within_balance
  before insert or update of status, amount on public.withdrawal_requests
  for each row execute function public.assert_withdrawals_within_balance();
