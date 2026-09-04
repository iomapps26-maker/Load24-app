import rateLimit from 'express-rate-limit';

// Reads the `sub` (user id) claim straight off the bearer token's payload
// WITHOUT verifying the signature — safe here because this is only used to
// pick a rate-limit bucket, not to authorize anything: requireAuth verifies
// the token for real a beat later and 401s a forged one regardless, and the
// per-IP backstop below still covers someone rotating the token to dodge
// their per-user bucket. Returns null for anything that isn't a well-formed
// bearer JWT so the caller falls back to keying by IP.
function subjectFromBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const payload = JSON.parse(Buffer.from(header.slice(7).split('.')[1], 'base64url').toString('utf8'));
    return typeof payload?.sub === 'string' ? `user:${payload.sub}` : null;
  } catch {
    return null;
  }
}

// Coarse per-IP ceiling on the whole API. Deliberately high: India's mobile
// carriers (Jio, Airtel) route large user populations through small pools of
// public IPs via carrier-grade NAT, so dozens of unrelated legitimate users
// routinely share one `req.ip`. This only exists to blunt a single host
// hammering the API (including the token-rotation dodge noted above), not to
// pace normal use — that's the per-user limiter's job. Requires
// `app.set('trust proxy', ...)` in index.js or every request keys to the
// Render load balancer's address and this bucket is shared by everyone.
export const apiIpBackstopRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 4000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Per-user budget for the whole API, keyed by the token subject (see
// subjectFromBearer) and falling back to per-IP for the few pre-auth
// endpoints (/api/app-config, /api/master-data, the WhatsApp OTP routes have
// their own tighter limiters). 1500 / 15 min is ~100/min — comfortably above
// real usage (SeeBidding polls at 12/min, a busy session touches maybe
// 200-400/15min) while still catching a client stuck in a retry loop.
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: (req) => (subjectFromBearer(req) ? 1500 : 300),
  keyGenerator: (req) => subjectFromBearer(req) || req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// The mobile app POSTs a location ping during an active trip. Each ping is 2
// SELECTs + 1 INSERT (routes/tripLocationPings.js), and the route has no
// natural ceiling on how often a client may call it — a stuck or hostile
// client could flood it. One ping every ~10s per user is plenty for live
// tracking; keyed by the signed-in user (requireAuth has run).
export const tripLocationPingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip || 'unknown',
  message: { error: 'Location pings are coming in too fast — slow down.' }
});

// MPIN is a short numeric code, so brute-forcing it is much cheaper than
// brute-forcing a password — cap attempts tightly and key by the signed-in
// user (requireAuth has already run by the time this applies) rather than by
// IP, since a NAT/proxy shouldn't let one bad actor lock out everyone behind
// it. Persisted lockout state on user_profiles (see requireAuth-gated
// /auth/mpin/login handler) backs this up across server restarts.
export const mpinLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many MPIN attempts, please try again later.' }
});

// WhatsApp OTP send/verify run before requireAuth (there's no signed-in user
// yet), so these key by phone number instead — capped low since each send
// costs a WhatsApp template message and a bare phone number is cheap to
// enumerate.
export const whatsappSendOtpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.phone || req.ip,
  message: { error: 'Too many OTP requests, please try again later.' }
});

export const whatsappVerifyOtpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.phone || req.ip,
  message: { error: 'Too many attempts, please try again later.' }
});

// Authenticated "link a phone number to my account" flow (auth.js
// /link-phone/*) — same shape as the WhatsApp limiters above but keyed by
// the signed-in user, since there's always a req.user by the time these run.
export const linkPhoneSendOtpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many OTP requests, please try again later.' }
});

export const linkPhoneVerifyOtpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many attempts, please try again later.' }
});
