-- Load24 Wallet module: one wallet per verified user, an append-only ledger
-- (wallet_transactions) that's the only source of truth for balance, and a
-- withdrawal_requests table for the staff-approved payout flow. All writes
-- go through the Express API using the service-role client (see
-- apps/backend/src/routes/wallet.js) — RLS below only gates reads, so a
-- compromised client token can never move money, only look at its own.
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  balance numeric not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in (
    'add_money', 'credit', 'debit', 'refund',
    'commission', 'service_charge',
    'security_hold', 'security_release', 'withdrawal'
  )),
  amount numeric not null check (amount > 0),
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  reference_load_id uuid references public.loads(id),
  razorpay_order_id text,
  razorpay_payment_id text unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wallet_transactions_wallet_id_idx on public.wallet_transactions (wallet_id);
create index if not exists wallet_transactions_user_id_idx on public.wallet_transactions (user_id);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  amount numeric not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  bank_account_holder_name text not null,
  bank_account_number text not null,
  bank_ifsc_code text not null,
  bank_name text not null,
  rejection_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  wallet_transaction_id uuid references public.wallet_transactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists withdrawal_requests_user_id_idx on public.withdrawal_requests (user_id);

-- Balance is derived state, never written directly: this trigger is the only
-- thing that ever changes wallets.balance, firing once per transaction the
-- moment it becomes 'completed' (on insert already-completed, or on update
-- from pending -> completed once a Razorpay webhook confirms payment).
create or replace function public.apply_wallet_transaction() returns trigger as $$
declare
  delta numeric;
begin
  if new.status <> 'completed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return new; -- already applied, never double-apply
  end if;

  if new.type in ('add_money', 'credit', 'refund', 'security_release') then
    delta := new.amount;
  else
    delta := -new.amount;
  end if;

  update public.wallets set balance = balance + delta, updated_at = now() where id = new.wallet_id;
  return new;
end;
$$ language plpgsql;

create trigger wallet_transactions_apply
  after insert or update of status on public.wallet_transactions
  for each row execute function public.apply_wallet_transaction();

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.withdrawal_requests enable row level security;

create policy "wallets_select_own_or_staff" on public.wallets
  for select using (
    user_id = auth.uid() or public.has_role(array['admin','support_executive','support_manager','accounts_executive','accounts_manager'])
  );

create policy "wallet_transactions_select_own_or_staff" on public.wallet_transactions
  for select using (
    user_id = auth.uid() or public.has_role(array['admin','support_executive','support_manager','accounts_executive','accounts_manager'])
  );

create policy "withdrawal_requests_select_own_or_staff" on public.withdrawal_requests
  for select using (
    user_id = auth.uid() or public.has_role(array['admin','support_executive','support_manager','accounts_executive','accounts_manager'])
  );
