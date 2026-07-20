# Migrating LOAD24 to Expo / Express / Supabase

This repo now contains two new sibling projects alongside the existing Vite
web app, implementing the target stack for one full vertical slice
(sign in → find loads → like a load), so the pattern can be repeated across
the other 65+ pages.

```
Backend/   Node + Express REST API, talks to Supabase
mobile/   Expo Router app (React Native + NativeWind + Paper + TanStack Query)
```

## What's implemented

- **`Backend/sql/001_init.sql`** — Postgres schema for `user_profiles`, `loads`,
  `load_likes`, translated 1:1 from `base44/entities/{User,UserProfile,Load,LoadLike}.jsonc`,
  including the same RLS rules (owner-or-staff-role access) as native Postgres
  Row Level Security policies instead of Base44's RLS config.
- **`Backend/src`** — Express API (`/api/profile`, `/api/loads`, `/api/load-likes`).
  Auth middleware (`middleware/auth.js`) verifies the Supabase JWT sent by the
  app and builds a per-request Supabase client scoped to that user's token, so
  RLS is enforced exactly as if the client called Supabase directly — the
  Express layer is a thin, extensible proxy, not a bypass.
- **`mobile/app`** — Expo Router with `(auth)` and `(app)` route groups and an
  `AuthGate` in the root layout that redirects between them based on Supabase
  session state (replaces `AuthProvider`/`AuthenticatedApp` in `src/App.jsx`).
  - `(auth)/login.jsx` — email OTP sign-in via `supabase.auth.signInWithOtp`.
  - `(app)/find-loads.jsx` — full port of `src/pages/FindLoads.jsx`: truck-type
    filter, pincode search, TanStack Query for loads/likes/profile, optimistic
    like/unlike.
  - `lib/AuthContext.js`, `lib/api.js`, `lib/supabase.js`, `lib/queryClient.js`
    mirror `src/lib/AuthContext.jsx`, `src/api/base44Client.js`,
    `src/lib/query-client.js` from the web app.

## Running it

1. Create a Supabase project, then run `Backend/sql/001_init.sql` in its SQL editor.
2. Enable Email OTP under Supabase Auth settings (phone OTP needs an SMS provider
   configured — swap `sendOtp`/`verifyOtp` in `mobile/lib/AuthContext.js` to use
   `phone` once that's set up, matching the app's existing WhatsApp verification flow).
3. `cd Backend && cp .env.example .env` and fill in your Supabase URL + service role key, then `npm install && npm run dev`.
4. `cd mobile`, put your Supabase URL/anon key and API URL in `app.json`'s `extra`
   block, then `npm install && npm start`.

## Repeating this pattern for the rest of the app

For each remaining page/entity:

1. Add the table + RLS policies to a new `Backend/sql/00N_*.sql` migration,
   translating the matching `base44/entities/*.jsonc` (`properties` → columns,
   `rls` → Postgres policies) the same way `001_init.sql` does.
2. Add an Express route file under `Backend/src/routes`, mounted with `requireAuth`.
3. Add an Expo Router screen under `mobile/app/(app)/`, porting the existing
   `src/pages/*.jsx` file's queries/mutations to `lib/api.js` calls and its
   Radix/shadcn JSX to React Native Paper + NativeWind components.

Suggested order, following the app's own critical path: `PostLoad` →
`Dashboard` → `MyDeals`/`Deal` detail → `Wallet` → `TruckOwner*` flows →
`Admin*`/`Reports*` (lowest priority — internal tooling, could stay on the
existing web app indefinitely and be reached via a WebView or kept as a
separate admin web app rather than ported to mobile).

## Notes / deliberate simplifications in this slice

- Auth uses email OTP for simplicity; the original app verifies via WhatsApp
  (`WhatsAppVerification` entity, `verify-whatsapp` page) — recommend keeping
  phone-based OTP through Supabase Auth's phone provider to preserve that UX.
- File/image uploads (GST docs, Aadhaar, PAN, voice notes) aren't wired up yet —
  use Supabase Storage buckets + signed upload URLs from the Express API.
- Stripe payment flows (`PaymentController`-equivalent) and the AI sales agent
  (`base44/agents`) aren't ported — those need their own design pass since
  Base44's agent runtime doesn't have a direct Supabase equivalent.
