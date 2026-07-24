-- WhatsApp OTP sign-in/sign-up. Supabase's Free tier has no custom "Send
-- SMS" Auth Hook, so OTP codes are generated/verified entirely in the
-- Express backend and delivered via the WhatsApp Business Cloud API
-- (apps/backend/src/lib/whatsapp.js), then exchanged for a real Supabase
-- session via a server-generated magic-link token
-- (POST /api/auth/whatsapp/verify-otp in apps/backend/src/routes/whatsappAuth.js).
--
-- This table is only ever touched by the service-role client (there is no
-- authenticated session yet when these routes run), so RLS is enabled with
-- no policies -- default-deny for the anon/authenticated roles.
create table if not exists public.whatsapp_otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_otp_codes_phone_idx
  on public.whatsapp_otp_codes (phone, created_at desc);

alter table public.whatsapp_otp_codes enable row level security;
