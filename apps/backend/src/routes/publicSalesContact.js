import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { normalizeIndianPhone } from '../lib/phone.js';
import { getOrAssignSalesContact } from '../lib/contactAssignment.js';
import { publicSalesContactLookupRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

// GET /api/public/sales-contact?mobile= — unauthenticated lookup for the
// load24 marketing site's Support page, which has no login system at all
// (unlike the mobile app's GET /api/sales-contact/mine, which uses the
// caller's real session). Trusts whatever mobile number is typed in with no
// OTP proof of ownership — an accepted trade-off since this only ever
// reveals a sales rep's public contact info, never anything about the
// account itself. A number with no matching account, or no roster
// configured, both return the same shape with nulls so the page can fall
// back to a generic message either way.
router.get('/', publicSalesContactLookupRateLimiter, async (req, res) => {
  const phone = normalizeIndianPhone(req.query.mobile);
  if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit Indian mobile number' });

  const { data: profile, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('mobile', phone)
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!profile) return res.json({ id: null, name: null, phone: null, email: null });

  const contact = await getOrAssignSalesContact(profile.user_id).catch(() => null);
  res.json(contact ?? { id: null, name: null, phone: null, email: null });
});

export default router;
