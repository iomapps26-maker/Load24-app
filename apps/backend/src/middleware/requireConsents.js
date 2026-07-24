import { missingRequiredConsents } from '../lib/consents.js';

// Blocks access to non-onboarding routes until the signed-in user has
// granted every consent in REQUIRED_CONSENTS at its current version. Must
// run after requireAuth (needs req.user / req.supabase). Onboarding routes
// (profile setup, /auth/*, /onboarding/*) are mounted without this
// middleware in index.js so a new user can still reach accept-terms itself.
export async function requireConsents(req, res, next) {
  const { data, error } = await req.supabase
    .from('consents')
    .select('consent_type, version, granted')
    .eq('user_id', req.user.id)
    .eq('granted', true);

  if (error) return res.status(400).json({ error: error.message });

  const missing = missingRequiredConsents(data);

  if (missing.length > 0) {
    return res.status(403).json({
      error: 'Required consents not recorded',
      missing_consents: missing
    });
  }

  next();
}
