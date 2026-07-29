import { supabaseAdmin, supabaseForUser } from '../lib/supabase.js';

// Reads a claim out of a JWT without verifying its signature. Safe to use
// for the `iat` check below because supabaseAdmin.auth.getUser() has (by
// the time that check runs) already verified the token against Supabase
// Auth. `sub` is read speculatively, before verification, purely to kick
// off the token_valid_after lookup in parallel — see requireAuth.
function decodeClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
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

  const claims = decodeClaims(token);

  // The token_valid_after lookup only needs the user id, which we can read
  // off the JWT payload without waiting for getUser() to verify it over the
  // network — so fire both requests together instead of one after the
  // other. The speculative id is never trusted on its own: below we only
  // use profileResult once we've confirmed it matches the *verified* user
  // id from getUser(), and getUser() failing still 401s regardless of what
  // this lookup returned.
  const [{ data, error }, profileResult] = await Promise.all([
    supabaseAdmin.auth.getUser(token),
    typeof claims?.sub === 'string'
      ? supabaseAdmin.from('user_profiles').select('token_valid_after').eq('user_id', claims.sub).maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });

  // "Logout all devices" stamps user_profiles.token_valid_after; any token
  // issued before that cutoff is treated as revoked even though it hasn't
  // technically expired yet (Supabase access tokens can't be revoked early).
  const profile = claims?.sub === data.user.id ? profileResult.data : null;

  if (profile?.token_valid_after) {
    const issuedAt = typeof claims.iat === 'number' ? new Date(claims.iat * 1000) : null;
    if (!issuedAt || issuedAt < new Date(profile.token_valid_after)) {
      return res.status(401).json({ error: 'Session revoked, please log in again' });
    }
  }

  req.user = data.user;
  req.token = token;
  req.supabase = supabaseForUser(token);
  next();
}