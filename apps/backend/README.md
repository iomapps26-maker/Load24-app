# apps/backend

Node + Express REST API. Talks to Supabase (Postgres + Auth) on behalf of the
mobile app — the mobile client attaches the caller's Supabase access token as
a bearer token, and every request runs under that user's Row Level Security
policies (see `db/migrations/`).

## Setup

```
cd apps/backend
npm install
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
npm run dev
```

Runs on `PORT` from `.env` (default 4000).

## Routes

- `GET /health` — liveness check
- `/api/profile` — current user's profile (`src/routes/profile.js`)
- `/api/loads` — post/list loads (`src/routes/loads.js`)
- `/api/load-likes` — like/unlike a load (`src/routes/loadLikes.js`)

All routes except `/health` require a valid Supabase bearer token, enforced by
`src/middleware/auth.js`.
