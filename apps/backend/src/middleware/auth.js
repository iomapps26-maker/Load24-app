import { supabaseAdmin, supabaseForUser } from '../lib/supabase.js';

// Reads the `iat` claim out of a JWT without verifying its signature — safe
// here because supabaseAdmin.auth.getUser() has already verified the token
// against Supabase Auth by the time this runs.
function decodeIssuedAt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.iat === 'number' ? new Date(payload.iat * 1000) : null;
  } catch {
    return null;
  }
}

// Verifies the Supabase access token sent by the Expo app and attaches:
//   req.user      -> the auth.users record
//   req.token     -> the raw access token (used by /auth/logout-all-devices)
//   req.supabase  -> a Postgres client scoped to that user (RLS-enforced)
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });

  // "Logout all devices" stamps user_profiles.token_valid_after; any token
  // issued before that cutoff is treated as revoked even though it hasn't
  // technically expired yet (Supabase access tokens can't be revoked early).
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('token_valid_after')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (profile?.token_valid_after) {
    const issuedAt = decodeIssuedAt(token);
    if (!issuedAt || issuedAt < new Date(profile.token_valid_after)) {
      return res.status(401).json({ error: 'Session revoked, please log in again' });
    }
  }

  req.user = data.user;
  req.token = token;
  req.supabase = supabaseForUser(token);
  next();
}