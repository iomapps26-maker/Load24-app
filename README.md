# LOAD24

A freight marketplace connecting shippers, transporters, and truck owners.

This repo contains three projects:

```
.         Vite + React web app (this directory) — being migrated off Base44 onto Supabase
Backend/  Node + Express REST API, talks to Supabase
mobile/   Expo Router app (React Native) — the target Supabase-native client
```

See [MIGRATION.md](./MIGRATION.md) for the full migration plan and status.

## Web app (this directory)

The web app used to run entirely on Base44. It now talks to Supabase directly
(`src/api/base44Client.js`) for `UserProfile`, `Load`, and `LoadLike`, and to
the Express API in `Backend/` for profile writes. Every other entity (Deal,
Wallet, Invoice, Truck, Notification, etc.) doesn't have a Supabase table yet
and will throw/return empty until it's migrated — see MIGRATION.md for the
page-by-page plan.

### Setup

1. Create a Supabase project and run `Backend/sql/001_init.sql` in its SQL editor.
2. Copy `.env.example` to `.env.local` and fill in your Supabase project URL,
   anon key, and the URL of your local `Backend/` instance:

   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_API_URL=http://localhost:4000
   ```
3. Install dependencies and run the app:

   ```
   npm install
   npm run dev
   ```

You'll also want the `Backend/` API running locally (see its own setup in
MIGRATION.md) since profile creation goes through it.

### Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — production build
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run typecheck` — type-check the codebase (JSDoc-based, via `jsconfig.json`)
