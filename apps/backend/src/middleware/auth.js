import { supabaseAdmin, supabaseForUser } from '../lib/supabase.js';
import { verifySupabaseJwt, userFromJwtPayload } from '../lib/supabaseJwt.js';

// Reads a claim out of a JWT without verifying its signature. Safe to use
// for the `iat` check below because — on the getUser() path —
// supabaseAdmin.auth.getUser() has already verified the token against
// Supabase Auth by the time that check runs. `sub` is read speculatively,
// before verification, purely to kick off the token_valid_after lookup in
// parallel — see requireAuth.
function decodeClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Looks up the "logout all devices" revocation cutoff for a user id.
function tokenValidAfterFor(userId) {
  return typeof userId === 'string'
    ? supabaseAdmin.from('user_profiles').select('token_valid_after').eq('user_id', userId).maybeSingle()
    : Promise.resolve({ data: null });
}

// "Logout all devices" stamps user_profiles.token_valid_after; any token
// issued before that cutoff is treated as revoked even though it hasn't
// technically expired yet (Supabase access tokens can't be revoked early).
function isRevoked(claims, profile) {
  if (!profile?.token_valid_after) return false;
  const issuedAt = typeof claims?.iat === 'number' ? new Date(claims.iat * 1000) : null;
  return !issuedAt || issuedAt < new Date(profile.token_valid_after);
}

// Verifies the Supabase access token sent by the Expo app and attaches:
//   req.user      -> the auth.users record (or the JWT claims shaped like it)
//   req.token     -> the raw access token (used by /auth/logout-all-devices)
//   req.supabase  -> a Postgres client scoped to that user (RLS-enforced)
//
// Two verification paths:
//  - SUPABASE_JWT_SECRET set  -> verify the token's signature locally, no
//    network call. See lib/supabaseJwt.js. This is the hot path once
//    configured.
//  - unset (default)          -> call supabaseAdmin.auth.getUser(token), the
//    original behaviour.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  const claims = decodeClaims(token);

  // ---- Local verification path (opt-in) --------------------------------
  if (process.env.SUPABASE_JWT_SECRET) {
    const payload = verifySupabaseJwt(token);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

    const { data: profile } = await tokenValidAfterFor(payload.sub);
    if (isRevoked(payload, profile)) {
      return res.status(401).json({ error: 'Session revoked, please log in again' });
    }

    req.user = userFromJwtPayload(payload);
    req.token = token;
    req.supabase = supabaseForUser(token);
    return next();
  }

  // ---- Network verification path (default) -----------------------------
  // The token_valid_after lookup only needs the user id, which we can read
  // off the JWT payload without waiting for getUser() to verify it over the
  // network — so fire both requests together. The speculative id is never
  // trusted on its own: profileResult is only used once it's confirmed to
  // match the *verified* user id from getUser(), and getUser() failing still
  // 401s regardless of what this lookup returned.
  const [{ data, error }, profileResult] = await Promise.all([
    supabaseAdmin.auth.getUser(token),
    typeof claims?.sub === 'string' ? tokenValidAfterFor(claims.sub) : Promise.resolve({ data: null })
  ]);

  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired token' });

  const profile = claims?.sub === data.user.id ? profileResult.data : null;
  if (isRevoked(claims, profile)) {
    return res.status(401).json({ error: 'Session revoked, please log in again' });
  }

  req.user = data.user;
  req.token = token;
  req.supabase = supabaseForUser(token);
  next();
}
