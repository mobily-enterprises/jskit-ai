# Package Extraction Migration Plan

This document defines the extraction target architecture for reusable server code and points to completed migration tracks.

## Layering Rules

- `*-core`: business logic only (no Fastify, Knex, or provider SDK imports).
- `*-knex-mysql`: repository/storage adapters only.
- `*-fastify-adapter`: HTTP routes/controllers/schema only.
- `*-provider-*`: third-party SDK integration only.
- App code must remain thin: configuration and composition only.

## App-Specific Boundary

- App-specific server features remain restricted to `deg2rad` and `projects`.

## Migration Strategy

- Extract domain code into package.
- Keep temporary app wrappers to preserve import compatibility.
- Rewire runtime composition to package imports.
- Add guardrails preventing app-local reintroduction.
- Remove wrappers only when downstream imports are fully migrated.

## Completed Domain Tracks

- [communications migration](./migrations/communications.md)
- [chat + transcript storage migration](./migrations/chat-and-transcripts-storage.md)
- [billing migration](./migrations/billing.md)
- [auth migration](./migrations/auth.md)
- [workspace/console/settings adapter migration](./migrations/workspace-console-settings-adapters.md)
- [health + observability adapter migration](./migrations/health-and-observability-adapters.md)
- [platform runtime migration](./migrations/platform-runtime.md)

## Future App Guidance

- [package extension points](./package-extension-points.md)
- [headless client contract](./headless-client-contract.md)
