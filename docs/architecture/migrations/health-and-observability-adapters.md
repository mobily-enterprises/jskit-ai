# Health And Observability Adapter Migration

## Extracted Packages

- `@jskit-ai/health-fastify-adapter`
- `@jskit-ai/observability-fastify-adapter`

## App Wiring Pattern

- App modules are thin wrappers that re-export package controllers/routes/schemas.
- Metrics behavior remains driven by `@jskit-ai/observability-core` service wiring.

## Extension Points For New Apps

- Reuse transport adapter package unchanged.
- Configure metrics policy and registry behavior in service/runtime wiring.
