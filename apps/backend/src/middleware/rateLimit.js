import rateLimit from 'express-rate-limit';

// Generous per-IP cap on the whole API — enough headroom for normal mobile
// app usage (polling loads, liking, profile edits), just enough to blunt
// brute-force / scraping traffic. /health is mounted before this so it's
// never limited.
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
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
