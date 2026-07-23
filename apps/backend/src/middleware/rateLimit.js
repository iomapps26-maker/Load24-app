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
