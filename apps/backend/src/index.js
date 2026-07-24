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
import onboardingRouter from './routes/onboarding.js';
import authRouter from './routes/auth.js';
import whatsappAuthRouter from './routes/whatsappAuth.js';
import bankDetailsRouter from './routes/bankDetails.js';
import reviewsRouter from './routes/reviews.js';
import supportTicketsRouter from './routes/supportTickets.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', apiRateLimiter);

// WhatsApp OTP login is the login step itself, so it runs with no session at
// all — mounted at the more specific /api/auth/whatsapp path *before* the
// requireAuth-gated /api/auth block below so it never hits that middleware.
app.use('/api/auth/whatsapp', whatsappAuthRouter);

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
app.use('/api/bank-details', requireAuth, requireConsents, bankDetailsRouter);
app.use('/api/reviews', requireAuth, requireConsents, reviewsRouter);
app.use('/api/support-tickets', requireAuth, requireConsents, supportTicketsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`LOAD24 API listening on :${port}`));
