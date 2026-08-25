import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeIndianPhone } from '../lib/phone.js';

const router = Router();

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
    .select('mobile, mobile_verified')
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