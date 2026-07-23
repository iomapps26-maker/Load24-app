# apps/mobile

Bare React Native CLI app (Android + iOS). NativeWind/Tailwind for styling,
React Navigation (bottom tabs + native stack) for navigation, TanStack Query
for data fetching, Supabase JS client for auth.

## Setup

```
cd apps/mobile
npm install
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_ANON_KEY / API_URL
npx react-native start
```

In another terminal:

```
npx react-native run-android
# or
npx react-native run-ios
```

`API_URL` should point at a running `apps/backend` instance — use
`http://10.0.2.2:4000` on the Android emulator to reach your host machine's
localhost.

## Structure

- `screens/` — one file per app screen
- `navigation/` — tab/stack navigators
- `components/` — shared UI pieces (e.g. `LoadCard`)
- `lib/` — Supabase client, API wrapper, i18n, auth context
