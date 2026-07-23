# infra/

Infrastructure-as-code and local-environment definitions.

Currently empty — this app runs against a hosted Supabase project rather
than self-hosted Postgres, so there's no local `docker-compose.dev.yml` yet.
Add one here (Postgres/Redis/etc.) if/when local services beyond Supabase
are needed (e.g. Redis for OTP rate-limiting), and Terraform under
`infra/terraform/` if staging/production infra ever needs to be provisioned
as code rather than clicked together in the Supabase dashboard.
