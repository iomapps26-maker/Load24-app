# Contributing

## Branch strategy

- `main` — production. Only merged into via a reviewed PR from `staging`.
- `staging` — pre-production. Feature branches merge here first for
  integration testing.
- Feature branches — cut off `staging`, named `feature/<short-description>`
  (or `fix/<short-description>` for bug fixes). Open a PR back into `staging`.

There is no `develop` branch — `staging` serves that role, since this
project doesn't yet have enough concurrent workstreams to need both.

## PR review

- Every PR into `staging` or `main` requires at least one review before
  merging.
- Keep PRs scoped to one app where possible (`apps/backend` vs
  `apps/mobile`) to keep review focused.

## Local setup

See the root `README.md` for the getting-started steps, and
`apps/backend/README.md` / `apps/mobile/README.md` for per-app setup.
