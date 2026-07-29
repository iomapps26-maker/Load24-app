-- WhatsApp/phone-OTP signups have no real email — auth.users.email is a
-- synthetic placeholder (see 009_add_whatsapp_otp_login.sql /
-- apps/backend/src/routes/whatsappAuth.js), so it can't be used as the
-- user's contact email. This column holds an optional, user-entered email
-- collected on the profile setup screen, distinct from user_email (which
-- always mirrors the auth identity).
alter table public.user_profiles
  add column if not exists contact_email text;
