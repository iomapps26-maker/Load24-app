import { supabaseAdmin } from './supabase.js';

export type OwningAccount = { userId: string; authEmail: string };

// Looks up which auth.users row (if any) already "owns" a phone number, via
// user_profiles.mobile — unique per db/migrations/013_unique_mobile_per_user.sql,
// so there's at most one match. This is the source of truth for "does a
// verified-elsewhere account already exist for this phone", used to decide
// whether a fresh OTP verification should link into that account instead of
// minting a new one.
export async function findAccountOwningPhone(phone: string): Promise<OwningAccount | null> {
  const { data: profile, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('mobile', phone)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!profile) return null;

  const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.user_id);
  if (userError || !userData?.user?.email) return null;

  return { userId: profile.user_id, authEmail: userData.user.email };
}

// Whether an account has completed onboarding (has a user_profiles row).
// Accounts without one are "empty shells" — e.g. a phone-only signup that
// verified an OTP but never finished profile setup — and can be safely
// re-homed without losing any real data.
export async function hasRealActivity(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('user_profiles').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

// Attaches a freshly-OTP-verified phone number to an existing auth.users
// row, and mirrors it onto that user's profile if one already exists.
// Never creates a new auth.users row — call sites decide separately whether
// linking vs. creating a new account is appropriate.
export async function linkVerifiedPhoneToUser(userId: string, phone: string): Promise<void> {
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    phone,
    phone_confirm: true
  });
  if (authError) throw new Error(authError.message);

  const { data: profile, error: fetchError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!profile) return;

  const { error: updateError } = await supabaseAdmin
    .from('user_profiles')
    .update({ mobile: phone, mobile_verified: true })
    .eq('user_id', userId);
  if (updateError) throw new Error(updateError.message);
}

// Clears a phone off an orphan account before it's re-homed elsewhere —
// auth.users.phone is unique, so the old row has to give it up first.
export async function clearPhoneFromUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { phone: '' });
  if (error) throw new Error(error.message);
}

export async function logAuthLinkEvent(event: {
  userId: string | null;
  eventType: 'phone_auto_linked' | 'phone_link_blocked' | 'phone_manual_linked' | 'google_linked';
  phone?: string | null;
  ipAddress?: string | null;
}): Promise<void> {
  await supabaseAdmin.from('auth_link_events').insert({
    user_id: event.userId,
    event_type: event.eventType,
    phone: event.phone ?? null,
    ip_address: event.ipAddress ?? null
  });
}
