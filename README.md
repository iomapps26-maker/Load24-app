# LOAD24

A freight marketplace connecting shippers, transporters, and truck owners.

## Layout

```
apps/backend/   Node + Express REST API, talks to Supabase
apps/mobile/    React Native CLI app (Android + iOS) — the client
packages/       Code shared between apps (empty for now)
infra/          Infra-as-code / local-environment definitions (empty for now)
db/             Postgres schema migrations, applied via Supabase SQL Editor
docs/           Design notes and historical records
```

This is an npm workspaces monorepo (`package.json` at root lists
`apps/*` and `packages/*`). Each app still has its own independent
`package.json`/`node_modules` — install and run them from within their own
folder (`apps/backend/README.md`, `apps/mobile/README.md`), not from root.

## Getting started

1. Create a Supabase project and run the migrations in `db/migrations/`, in
   order, via its SQL Editor.
2. Follow `apps/backend/README.md` to get the API running locally.
3. Follow `apps/mobile/README.md` to get the mobile app running against it.

See `docs/MIGRATION.md` for the historical Base44 → Supabase migration
record, and `CONTRIBUTING.md` for the branching/PR workflow.
