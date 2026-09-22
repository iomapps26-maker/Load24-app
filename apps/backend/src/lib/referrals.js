import { supabaseAdmin } from './supabase.js';

// Referral codes: one per user (public business-role user or staff — both
// live in auth.users), lazily generated on first request via
// get_or_create_referral_code() (db/migrations/063_add_referrals.sql) — same
// idempotent get-or-assign shape as getOrAssignSalesContact in
// contactAssignment.js, just backed by a generator instead of a roster.
export async function getOrCreateReferralCode(userId) {
  const { data, error } = await supabaseAdmin.rpc('get_or_create_referral_code', { p_user_id: userId });
  if (error) throw error;
  return data;
}

// Attributes a signup to whoever owns `code`, once. Called only at
// first-time profile creation (routes/profile.js POST /, currentProfile ===
// null) — never on a later edit. Soft-fails (returns null instead of
// throwing) on an unknown code, a self-referral, or a referred user who's
// already attributed to someone else (referrals.referred_user_id is
// unique) — a bad or duplicate code must never block profile creation, same
// soft-fail spirit as publicSalesContact.js.
export async function recordReferral(referredUserId, code) {
  if (!code) return null;
  const trimmed = String(code).trim().toUpperCase();
  if (!trimmed) return null;

  const { data: owner, error: lookupError } = await supabaseAdmin
    .from('referral_codes')
    .select('user_id')
    .eq('code', trimmed)
    .maybeSingle();
  if (lookupError || !owner || owner.user_id === referredUserId) return null;

  const { error: insertError } = await supabaseAdmin
    .from('referrals')
    .insert({ referrer_user_id: owner.user_id, referred_user_id: referredUserId, code_used: trimmed });
  // 23505: referred_user_id already attributed to someone (unique
  // constraint) — this user was already referred once before, ignore.
  if (insertError && insertError.code !== '23505') throw insertError;

  return insertError ? null : owner.user_id;
}

// Live counts, not a denormalized counter — total_referred/verified_count
// stay accurate as kyc_status changes without this needing a hook into the
// KYC approval flow (kyc.js/onboarding.js).
export async function getReferralStats(userId) {
  const code = await getOrCreateReferralCode(userId);

  const { data: referrals, error: referralsError } = await supabaseAdmin
    .from('referrals')
    .select('referred_user_id')
    .eq('referrer_user_id', userId);
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
