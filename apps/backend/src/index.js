import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import { requireConsents } from './middleware/requireConsents.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import profileRouter from './routes/profile.js';
import kycRouter from './routes/kyc.js';
import loadsRouter from './routes/loads.js';
import loadLikesRouter from './routes/loadLikes.js';
import loadBidsRouter from './routes/loadBids.js';
import onboardingRouter from './routes/onboarding.js';
import authRouter from './routes/auth.js';
import whatsappAuthRouter from './routes/whatsappAuth.js';
import bankDetailsRouter from './routes/bankDetails.js';
import trucksRouter from './routes/trucks.js';
import truckAvailabilityRouter from './routes/truckAvailability.js';
import reviewsRouter from './routes/reviews.js';
import supportTicketsRouter from './routes/supportTickets.js';
import walletRouter, { razorpayWebhookHandler } from './routes/wallet.js';

const app = express();
app.use(cors());
// The `verify` hook stashes the raw request bytes on req.rawBody, which the
// Razorpay webhook handler needs for HMAC signature verification — deriving
// it from the already-parsed req.body wouldn't reproduce the exact bytes
// Razorpay signed.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', apiRateLimiter);

// WhatsApp OTP login is the login step itself, so it runs with no session at
// all — mounted at the more specific /api/auth/whatsapp path *before* the
// requireAuth-gated /api/auth block below so it never hits that middleware.
app.use('/api/auth/whatsapp', whatsappAuthRouter);

// Same reasoning as WhatsApp OTP above: Razorpay calls this directly with no
// user session, authenticated only by its HMAC signature.
app.post('/api/wallet/razorpay-webhook', razorpayWebhookHandler);

// Onboarding-safe routes: reachable with just a valid session, before the
// user has recorded the consents requireConsents checks for below. Profile
// setup and terms acceptance necessarily have to happen pre-consent.
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/profile/kyc', requireAuth, kycRouter);
app.use('/api/onboarding', requireAuth, onboardingRouter);
app.use('/api/auth', requireAuth, authRouter);

// Everything else requires REQUIRED_CONSENTS (see src/lib/consents.js) to
// have been recorded via POST /api/auth/accept-terms first.
app.use('/api/loads', requireAuth, requireConsents, loadsRouter);
app.use('/api/load-likes', requireAuth, requireConsents, loadLikesRouter);
app.use('/api/load-bids', requireAuth, requireConsents, loadBidsRouter);
app.use('/api/bank-details', requireAuth, requireConsents, bankDetailsRouter);
app.use('/api/trucks', requireAuth, requireConsents, trucksRouter);
app.use('/api/truck-availability', requireAuth, requireConsents, truckAvailabilityRouter);
app.use('/api/reviews', requireAuth, requireConsents, reviewsRouter);
app.use('/api/support-tickets', requireAuth, requireConsents, supportTicketsRouter);
app.use('/api/wallet', requireAuth, requireConsents, walletRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`LOAD24 API listening on :${port}`));

// Render's free tier spins the service down after ~15 min with no inbound
// HTTP traffic. A self-ping only counts as "inbound" if it hits the public
// URL (RENDER_EXTERNAL_URL, set automatically by Render) rather than
// localhost, so this only runs when that var is present — i.e. never locally.
const selfPingUrl = process.env.RENDER_EXTERNAL_URL;
if (selfPingUrl) {
  setInterval(() => {
    fetch(`${selfPingUrl}/health`).catch(() => {});
  }, 10 * 60 * 1000);
}
