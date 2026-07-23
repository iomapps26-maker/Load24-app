-- Profile page features: bank details, reviews/ratings, support tickets.

-- ============================================================
-- bank_details
-- ============================================================
create table if not exists public.bank_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  account_holder_name text not null,
  account_number text not null,
  ifsc_code text not null,
  bank_name text not null,
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bank_details enable row level security;

create policy "bank_details_select_own" on public.bank_details
  for select using (user_id = auth.uid());
create policy "bank_details_insert_own" on public.bank_details
  for insert with check (user_id = auth.uid());
create policy "bank_details_update_own" on public.bank_details
  for update using (user_id = auth.uid());

-- ============================================================
-- reviews
-- ============================================================
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  reviewee_user_id uuid not null references auth.users(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  reviewer_name text,
  deal_reference text,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists reviews_reviewee_idx on public.reviews (reviewee_user_id, created_at desc);

alter table public.reviews enable row level security;

create policy "reviews_select_own_or_authored" on public.reviews
  for select using (reviewee_user_id = auth.uid() or reviewer_user_id = auth.uid());
create policy "reviews_insert_own" on public.reviews
  for insert with check (reviewer_user_id = auth.uid());

-- Keep user_profiles.rating_score / total_ratings in sync with reviews.
create or replace function public.sync_review_rating() returns trigger as $$
begin
  update public.user_profiles
  set
    rating_score = coalesce((select avg(rating)::numeric(3,2) from public.reviews where reviewee_user_id = new.reviewee_user_id), 0),
    total_ratings = (select count(*) from public.reviews where reviewee_user_id = new.reviewee_user_id)
  where user_id = new.reviewee_user_id;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_review_rating on public.reviews;
create trigger trg_review_rating
after insert on public.reviews
for each row execute function public.sync_review_rating();

-- ============================================================
-- support_tickets
-- ============================================================
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at desc);

alter table public.support_tickets enable row level security;

create policy "support_tickets_select_own" on public.support_tickets
  for select using (user_id = auth.uid());
create policy "support_tickets_insert_own" on public.support_tickets
  for insert with check (user_id = auth.uid());
