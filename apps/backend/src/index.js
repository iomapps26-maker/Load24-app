import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import profileRouter from './routes/profile.js';
import loadsRouter from './routes/loads.js';
import loadLikesRouter from './routes/loadLikes.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/loads', requireAuth, loadsRouter);
app.use('/api/load-likes', requireAuth, loadLikesRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`LOAD24 API listening on :${port}`));
