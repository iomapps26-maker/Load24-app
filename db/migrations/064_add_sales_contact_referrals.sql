-- Sales contacts (public.sales_contact_roster — staff with no auth.users
-- login at all, see 061_add_support_sales_contacts.sql) now also get a
-- permanent referral code, generated automatically the moment they're added
-- (admin/salesContacts.js POST), the same way an app user's code is
-- generated in 063_add_referrals.sql. A prospect the sales rep talks to
-- types that code into the same "Referral code" box on the mobile signup
-- screen a friend referral would use — no separate capture flow.
--
-- referral_codes.user_id becomes optional and a new sales_contact_id column
-- is added, rather than forking off a second codes table, so both kinds of
-- owner draw from one unique code namespace and share
-- apps/backend/src/lib/referrals.js's recordReferral() lookup. Same move on
-- referrals.referrer_user_id / referrer_sales_contact_id. Exactly one owner
-- column is set in each case (enforced below), never both, never neither.

alter table public.referral_codes
  alter column user_id drop not null,
  add column if not exists sales_contact_id uuid unique references public.sales_contact_roster(id) on delete cascade;

alter table public.referral_codes
  drop constraint if exists referral_codes_exactly_one_owner,
  add constraint referral_codes_exactly_one_owner check (
    (user_id is not null and sales_contact_id is null) or
    (user_id is null and sales_contact_id is not null)
  );

-- Deliberately NOT "on delete cascade" here, unlike referral_codes.sales_
-- contact_id above — losing the code-to-contact mapping when a sales
-- contact is deleted is fine (the code becomes meaningless on its own), but
-- silently erasing the *history* of who referred which signup is not. This
-- means a sales contact with any referrals attributed to them can't be
-- hard-deleted at all (23503 — see admin/salesContacts.js DELETE's
-- pre-check for the friendlier 409), same "deactivate instead" rule
-- assigned_count already enforces for round-robin assignments.
alter table public.referrals
  alter column referrer_user_id drop not null,
  add column if not exists referrer_sales_contact_id uuid references public.sales_contact_roster(id);

alter table public.referrals
  drop constraint if exists referrals_exactly_one_referrer,
  add constraint referrals_exactly_one_referrer check (
    (referrer_user_id is not null and referrer_sales_contact_id is null) or
    (referrer_user_id is null and referrer_sales_contact_id is not null)
  );

create index if not exists referrals_referrer_sales_contact_idx on public.referrals (referrer_sales_contact_id);

-- Sales-contact twin of get_or_create_referral_code (063_add_referrals.sql)
-- — identical idempotent get-or-create shape, just keyed by sales_contact_id
-- instead of a user_id. Not SECURITY DEFINER: only ever called via
-- supabaseAdmin.rpc(...) from apps/backend/src/lib/referrals.js, same as
-- every other function this table's routes touch.
create or replace function public.get_or_create_sales_contact_referral_code(p_sales_contact_id uuid)
returns text
language plpgsql
as $$
declare
  v_code text;
  v_attempt int := 0;
begin
  select code into v_code from public.referral_codes where sales_contact_id = p_sales_contact_id;
  if v_code is not null then
    return v_code;
  end if;

  perform pg_advisory_xact_lock(hashtext('sales_referral_code:' || p_sales_contact_id::text));

  select code into v_code from public.referral_codes where sales_contact_id = p_sales_contact_id;
  if v_code is not null then
    return v_code;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := public._generate_referral_code();
    begin
      insert into public.referral_codes (sales_contact_id, code) values (p_sales_contact_id, v_code);
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
