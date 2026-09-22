import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeIndianPhone } from '../lib/phone.js';
import { KYC_REQUIRED_DOCUMENTS, KYC_REQUIRES_LOCATION } from '../lib/kycRequiredDocs.js';

const router = Router();

// Switching user_type mid-life (not first-time signup) re-targets the
// caller's single kyc_cases row at the new role's document/location
// requirements and forces it back out of 'verified' — same "any edit
// (re)starts review" rule bankDetails.js already applies to bank proof
// changes. Required docs already on file that the new role also happens to
// need still count (kyc_documents rows are keyed by case_id, untouched
// here), so a role switch between roles with overlapping requirements
// doesn't force re-uploading everything — but it always forces a fresh
// admin look, since 'verified' can only ever be set by the staff
// :userId/verify route, never by this recompute.
async function resetKycCaseForRoleChange(userId, newType) {
  const { data: kycCase, error: caseError } = await supabaseAdmin
    .from('kyc_cases')
    .select('id, location_address, location_lat, location_lng')
    .eq('user_id', userId)
    .maybeSingle();
  if (caseError) throw caseError;
  // No case yet: the next KYC screen visit lazily creates one already frozen
  // to the new role (routes/kyc.js's getOrCreateCase reads user_type fresh).
  if (!kycCase) return null;

  const { data: docs, error: docsError } = await supabaseAdmin
    .from('kyc_documents')
    .select('document_type')
    .eq('case_id', kycCase.id);
  if (docsError) throw docsError;

  const required = KYC_REQUIRED_DOCUMENTS[newType] || [];
  const uploadedTypes = new Set((docs || []).map((d) => d.document_type));
  const missing = required.filter((docType) => !uploadedTypes.has(docType));
  const locationMissing =
    KYC_REQUIRES_LOCATION.includes(newType) &&
    !(kycCase.location_address && kycCase.location_lat != null && kycCase.location_lng != null);
  const isComplete = missing.length === 0 && !locationMissing;
  const status = isComplete ? 'submitted' : missing.length < required.length ? 'partial' : 'pending';

  const { error: updateCaseError } = await supabaseAdmin
    .from('kyc_cases')
    .update({
      kyc_type: newType,
      status,
      rejection_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', kycCase.id);
  if (updateCaseError) throw updateCaseError;

  const { error: updateProfileError } = await supabaseAdmin.from('user_profiles').update({ kyc_status: status }).eq('user_id', userId);
  if (updateProfileError) throw updateProfileError;

  return status;
}

// GET /api/profile/me — current user's profile row, or null if not created yet
router.get('/me', async (req, res) => {
  const { data, error } = await req.supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  // mpin_hash is a bcrypt hash, not something the client needs — never send
  // credential material back over the wire even to its own owner. Expose
  // only whether one is set, so the app knows whether to gate on re-entry.
  if (data) {
    data.has_mpin = !!data.mpin_hash;
    delete data.mpin_hash;
  }
  res.json(data);
});

// POST /api/profile — create/complete the profile for the signed-in user
router.post('/', async (req, res) => {
  const { full_name, mobile, user_type, company_name, city, state, pincode, contact_email } = req.body;
  if (!mobile || !user_type) {
    return res.status(400).json({ error: 'mobile and user_type are required' });
  }

  const normalizedMobile = normalizeIndianPhone(mobile);
  if (!normalizedMobile) {
    return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number' });
  }

  // RLS scopes req.supabase to the caller's own row, so it can't see whether
  // another account already holds this number — check with the admin client,
  // which bypasses RLS, before writing. This also catches the case the DB's
  // unique constraint (user_profiles_mobile_unique) would otherwise reject
  // with an opaque 23505, giving the user an actionable message instead.
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('mobile', normalizedMobile)
    .neq('user_id', req.user.id)
    .maybeSingle();

  if (lookupError) return res.status(400).json({ error: lookupError.message });
  if (existing) {
    return res.status(409).json({
      error: 'This mobile number is already registered with another account. Please use a different number.'
    });
  }

  // Whether to mark this number verified: either it's the same number this
  // account's login already proved possession of (WhatsApp OTP sign-up sets
  // auth.users.phone + phone_confirm — see whatsappAuth.ts — so req.user.phone
  // here is real OTP proof, not user input), or it's unchanged from a value
  // this profile already had marked verified (e.g. set earlier via the
  // link-phone flow in identityLinking.ts). Any other number — including one
  // typed in over the top of a previously-verified different number — starts
  // unverified until it's proven the same way.
  const verifiedAuthPhone = req.user.phone ? normalizeIndianPhone(req.user.phone) : null;
  const { data: currentProfile, error: currentProfileError } = await supabaseAdmin
    .from('user_profiles')
    .select('mobile, mobile_verified, user_type')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (currentProfileError) return res.status(400).json({ error: currentProfileError.message });
  const mobileVerified =
    normalizedMobile === verifiedAuthPhone ||
    (currentProfile?.mobile === normalizedMobile && !!currentProfile?.mobile_verified);

  const { data, error } = await req.supabase
    .from('user_profiles')
    .upsert(
      {
        user_id: req.user.id,
        user_email: req.user.email,
        full_name,
        mobile: normalizedMobile,
        mobile_verified: mobileVerified,
        user_type,
        company_name,
        city,
        state,
        pincode,
        contact_email: contact_email || undefined
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'This mobile number is already registered with another account. Please use a different number.'
      });
    }
    return res.status(400).json({ error: error.message });
  }

  // A real role switch (not first-time signup, not a resave of the same
  // role) puts the account's KYC back under review for the new role — see
  // resetKycCaseForRoleChange above.
  if (currentProfile?.user_type && currentProfile.user_type !== user_type) {
    try {
      const kycStatus = await resetKycCaseForRoleChange(req.user.id, user_type);
      if (kycStatus) data.kyc_status = kycStatus;
    } catch (err) {
      return res.status(400).json({ error: `Profile saved, but could not reset KYC for the new role: ${err.message}` });
    }
  }

  res.status(201).json(data);
});

// DELETE /api/profile — permanently deletes the caller's account. Cascades
// to user_profiles and every table FK'd to auth.users (bank_details,
// reviews, support_tickets, user_devices, ...).
router.delete('/', async (req, res) => {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).end();
});

export default router;