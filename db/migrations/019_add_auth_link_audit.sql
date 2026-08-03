-- Records every account-linking decision (auto-link on verified phone OTP,
-- manual link-phone from Settings, blocked collisions) so support has a
-- trail to investigate the 409 "contact support" cases from
-- apps/backend/src/routes/auth.ts and whatsappAuth.ts. No RLS policies are
-- added — this table is only ever written/read via supabaseAdmin.
create table if not exists public.auth_link_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'phone_auto_linked', 'phone_link_blocked', 'phone_manual_linked', 'google_linked'
  )),
  phone text,
  ip_address text,
  created_at timestamptz not null default now()
);

alter table public.auth_link_events enable row level security;

create index if not exists auth_link_events_user_idx on public.auth_link_events (user_id);
