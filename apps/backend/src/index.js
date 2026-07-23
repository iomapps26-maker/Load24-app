import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import profileRouter from './routes/profile.js';
import loadsRouter from './routes/loads.js';
import loadLikesRouter from './routes/loadLikes.js';
import onboardingRouter from './routes/onboarding.js';
import authRouter from './routes/auth.js';
import bankDetailsRouter from './routes/bankDetails.js';
import reviewsRouter from './routes/reviews.js';
import supportTicketsRouter from './routes/supportTickets.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', apiRateLimiter);

app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/loads', requireAuth, loadsRouter);
app.use('/api/load-likes', requireAuth, loadLikesRouter);
app.use('/api/onboarding', requireAuth, onboardingRouter);
app.use('/api/auth', requireAuth, authRouter);
app.use('/api/bank-details', requireAuth, bankDetailsRouter);
app.use('/api/reviews', requireAuth, reviewsRouter);
app.use('/api/support-tickets', requireAuth, supportTicketsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`LOAD24 API listening on :${port}`));
