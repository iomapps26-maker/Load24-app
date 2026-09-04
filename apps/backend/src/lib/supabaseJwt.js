import crypto from 'crypto';

// Local verification of a Supabase (GoTrue) access token, so requireAuth
// doesn't have to make a network round-trip to Supabase Auth's /user
// endpoint on every single API request (that call adds ~50-150ms to the
// critical path and is itself rate-limited by Supabase).
//
// OPT-IN: only used when SUPABASE_JWT_SECRET is set. Supabase's legacy JWT
// secret (Project Settings > API > JWT Settings > JWT Secret) is the HS256
// signing key, used as a raw UTF-8 string — the same value `jsonwebtoken`
// would take. Projects that have migrated to asymmetric (RS256/ES256) signing
// keys don't expose a shared secret; leave SUPABASE_JWT_SECRET unset there and
// requireAuth keeps calling getUser() as before.

function b64urlToBuffer(s) {
  return Buffer.from(s, 'base64url');
}

// Returns the decoded payload for a structurally valid, correctly signed,
// unexpired HS256 token, or null. Never throws.
export function verifySupabaseJwt(token, secret = process.env.SUPABASE_JWT_SECRET) {
  if (!secret || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  if (header?.alg !== 'HS256') return null;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  let provided;
  try {
    provided = b64urlToBuffer(signatureB64);
  } catch {
    return null;
  }
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // Small skew allowance, same spirit as jsonwebtoken's default clockTolerance.
  if (typeof payload.exp === 'number' && payload.exp < nowSec - 5) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 5) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;

  return payload;
}

// Shapes a verified payload into the same { id, email, ... } surface the rest
// of the code expects off supabaseAdmin.auth.getUser()'s `data.user`.
export function userFromJwtPayload(payload) {
  return {
    id: payload.sub,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
    role: payload.role ?? null,
    app_metadata: payload.app_metadata ?? {},
    user_metadata: payload.user_metadata ?? {}
  };
}
