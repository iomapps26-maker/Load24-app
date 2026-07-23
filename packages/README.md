# packages/

Shared code used by more than one app in `apps/`, referenced via npm
workspaces (no publishing to a registry needed) — e.g. a future
`packages/shared-types` for types/constants shared between `apps/backend`
and `apps/mobile` (truck types, load statuses, role enums).

Empty for now; add a package here once something is genuinely duplicated
between apps rather than pre-building an abstraction no one needs yet.
