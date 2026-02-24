# Billing Migration

## Extracted Packages

- `@jskit-ai/billing-provider-stripe`
- `@jskit-ai/billing-provider-paddle`
- `@jskit-ai/billing-knex-mysql`
- `@jskit-ai/billing-service-core`
- `@jskit-ai/billing-worker-core`
- `@jskit-ai/billing-fastify-adapter`

## App Wiring Pattern

- Providers are composed in app runtime using provider package constructors.
- Billing repository comes from `billing-knex-mysql`.
- Domain orchestration and worker loops come from `billing-service-core` and `billing-worker-core`.
- HTTP controller/routes/schema are re-exported from `billing-fastify-adapter`.

## Extension Points For New Apps

- Configure provider choice and secrets in runtime env/config.
- Keep app-specific policy inputs in config only (no app-local billing orchestration forks).
- Reuse worker services with app-specific scheduling/runtime knobs only.
