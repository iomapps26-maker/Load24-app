import { supabaseAdmin } from './supabase.js';

// Referral codes: one per owner, either an app user (public business-role
// user or staff — both live in auth.users) or a sales_contact_roster entry
// (staff with no auth.users login at all — see 061_add_support_sales_contacts.sql).
// Both draw from the same code namespace (db/migrations/063_add_referrals.sql,
// 064_add_sales_contact_referrals.sql), lazily generated on first request via
// get_or_create_referral_code() / get_or_create_sales_contact_referral_code()
// — same idempotent get-or-assign shape as getOrAssignSalesContact in
// contactAssignment.js, just backed by a generator instead of a roster.
export async function getOrCreateReferralCode(userId) {
  const { data, error } = await supabaseAdmin.rpc('get_or_create_referral_code', { p_user_id: userId });
  if (error) throw error;
  return data;
}

export async function getOrCreateSalesContactReferralCode(salesContactId) {
  const { data, error } = await supabaseAdmin.rpc('get_or_create_sales_contact_referral_code', {
    p_sales_contact_id: salesContactId
  });
  if (error) throw error;
  return data;
}

// Attributes a signup to whoever owns `code` — an app user or a sales
// contact, recordReferral doesn't care which. Called only at first-time
// profile creation (routes/profile.js POST /, currentProfile === null) —
// never on a later edit. Soft-fails (returns null instead of throwing) on
// an unknown code, a self-referral, or a referred user who's already
// attributed to someone else (referrals.referred_user_id is unique) — a bad
// or duplicate code must never block profile creation, same soft-fail
// spirit as publicSalesContact.js.
export async function recordReferral(referredUserId, code) {
  if (!code) return null;
  const trimmed = String(code).trim().toUpperCase();
  if (!trimmed) return null;

  const { data: owner, error: lookupError } = await supabaseAdmin
    .from('referral_codes')
    .select('user_id, sales_contact_id')
    .eq('code', trimmed)
    .maybeSingle();
  if (lookupError || !owner) return null;
  if (owner.user_id && owner.user_id === referredUserId) return null;

  const { error: insertError } = await supabaseAdmin.from('referrals').insert({
    referrer_user_id: owner.user_id ?? null,
    referrer_sales_contact_id: owner.sales_contact_id ?? null,
    referred_user_id: referredUserId,
    code_used: trimmed
  });
  // 23505: referred_user_id already attributed to someone (unique
  // constraint) — this user was already referred once before, ignore.
  if (insertError && insertError.code !== '23505') throw insertError;

  return insertError ? null : (owner.user_id ?? owner.sales_contact_id);
}

// Live counts, not a denormalized counter — total_referred/verified_count
// stay accurate as kyc_status changes without needing a hook into the KYC
// approval flow (kyc.js/onboarding.js). Shared by both owner kinds below;
// they differ only in which referrals column identifies "theirs".
async function referralStatsFor(code, referrerColumn, referrerValue) {
  const { data: referrals, error: referralsError } = await supabaseAdmin
    .from('referrals')
    .select('referred_user_id')
    .eq(referrerColumn, referrerValue);
  if (referralsError) throw referralsError;

  const referredIds = (referrals || []).map((r) => r.referred_user_id);
  let verifiedCount = 0;
  if (referredIds.length > 0) {
    const { data: verifiedProfiles, error: profilesError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .in('user_id', referredIds)
      .eq('kyc_status', 'verified');
    if (profilesError) throw profilesError;
    verifiedCount = (verifiedProfiles || []).length;
  }

  return { code, total_referred: referredIds.length, verified_count: verifiedCount };
}

export async function getReferralStats(userId) {
  const code = await getOrCreateReferralCode(userId);
  return referralStatsFor(code, 'referrer_user_id', userId);
}

export async function getSalesContactReferralStats(salesContactId) {
  const code = await getOrCreateSalesContactReferralCode(salesContactId);
  return referralStatsFor(code, 'referrer_sales_contact_id', salesContactId);
}
