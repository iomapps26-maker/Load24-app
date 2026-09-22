-- Referral codes + attribution: any user — public business-role user or
-- staff, both live in auth.users (see 004_add_business_roles.sql /
-- 003_add_roles_devices_consents.sql for why those are two separate role
-- tables) — can hold exactly one referral code and refer other signups by
-- sharing it.
--
-- Deliberately no denormalized counter and no payout hook into
-- incentive_rules (038_add_incentive_rules.sql) — Phase 1 is visibility
-- only. "Verified" contributions are computed live by joining referrals
-- against user_profiles.kyc_status in apps/backend/src/lib/referrals.js's
-- getReferralStats, so the count always reflects current KYC state without
-- this migration touching the KYC approval flow (kyc.js/onboarding.js) at
-- all. A payout tier (e.g. a new incentive_rules metric keyed off a
-- referrals_count) can be layered on top of this later without changing
-- this schema.

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists referral_codes_code_idx on public.referral_codes (code);

-- One referrer per referred person — captured once, at profile creation
-- (routes/profile.js POST /, first-time create only, never on a later
-- edit), and never reattributed afterwards.
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  code_used text not null,
  created_at timestamptz not null default now(),
  constraint referrals_no_self_referral check (referrer_user_id <> referred_user_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id);

-- ---- Code generation -----------------------------------------------------
--
-- 8 chars from a 32-symbol alphabet with ambiguous characters (0/O, 1/I/L)
-- removed, since these are meant to be read aloud / retyped by hand — 32^8
-- possibilities makes a collision astronomically unlikely, but
-- get_or_create_referral_code below still retries rather than assuming it
-- never happens.
create or replace function public._generate_referral_code()
returns text
language sql
as $$
  select string_agg(substr(alphabet, (random() * length(alphabet))::int + 1, 1), '')
  from (select 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' as alphabet) a, generate_series(1, 8);
$$;

-- Idempotent get-or-create, safe under concurrency — same shape as
-- assign_support_contact()/assign_sales_contact()
-- (061_add_support_sales_contacts.sql): check, take a per-user advisory
-- lock, re-check (the call queued behind us may have just created this
-- user's code), then create. Unlike those two, there's no shared roster row
-- to race over here, so the "atomic claim" step is just a plain insert with
-- a unique_violation retry loop instead of FOR UPDATE SKIP LOCKED.
--
-- Not SECURITY DEFINER: only ever called via supabaseAdmin.rpc(...)
-- (service_role, already bypasses RLS entirely) from
-- apps/backend/src/lib/referrals.js.
create or replace function public.get_or_create_referral_code(p_user_id uuid)
returns text
language plpgsql
as $$
declare
  v_code text;
  v_attempt int := 0;
begin
  select code into v_code from public.referral_codes where user_id = p_user_id;
  if v_code is not null then
    return v_code;
  end if;

  perform pg_advisory_xact_lock(hashtext('referral_code:' || p_user_id::text));

  select code into v_code from public.referral_codes where user_id = p_user_id;
  if v_code is not null then
    return v_code;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := public._generate_referral_code();
    begin
      insert into public.referral_codes (user_id, code) values (p_user_id, v_code);
      return v_code;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'Could not generate a unique referral code after % attempts', v_attempt;
      end if;
      -- loop again with a freshly generated code
    end;
  end loop;
end;
$$;

-- ---- RLS -------------------------------------------------------------
--
-- Reads only — all writes are supabaseAdmin (service_role) from
-- apps/backend/src/lib/referrals.js, or get_or_create_referral_code above.
-- No INSERT/UPDATE/DELETE policy on either table.

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;

drop policy if exists "referral_codes_select_own" on public.referral_codes;
create policy "referral_codes_select_own" on public.referral_codes
  for select using (user_id = auth.uid());

drop policy if exists "referrals_select_own" on public.referrals;
create policy "referrals_select_own" on public.referrals
  for select using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());
