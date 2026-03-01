# JSKIT Provider Runtime Migration Dashboard

## Objective
Move JSKIT server runtime to a provider/kernel architecture with explicit lifecycle and deterministic wiring.

## Workstreams

| Workstream | Status | Notes |
| --- | --- | --- |
| Governance + ADRs | In Progress | ADR-001..003 added |
| Core Container | Completed | `@jskit-ai/container-core` with lifecycle, tags, cycle detection tests |
| Core Kernel | Completed | `@jskit-ai/kernel-core` with provider graph + lifecycle diagnostics |
| HTTP Kernel Adapter | In Progress | `@jskit-ai/http-fastify-core` route facade + registrar added |
| Queue + Worker Kernel | In Progress | `@jskit-ai/queue-core` with registry + drain lifecycle |
| Console Kernel | In Progress | `@jskit-ai/console-core` command/schedule runtime added |
| Support + Tokens | Completed | `@jskit-ai/support-core` token + normalization primitives added |
| Database Knex Runtime | In Progress | `@jskit-ai/database-knex-core` transaction/repository primitives added |
| Package Wave A Migration | Pending | Runtime foundation packages |
| Package Wave B Migration | Pending | Auth + workspace |
| Package Wave C Migration | Pending | Remaining domain packages |
| Legacy Runtime Removal | Pending | Remove contribution runtime path |

## Immediate Milestones

1. Migrate `create-app` server bootstrap to provider runtime kernels.
2. Add architecture lint gates for provider-only route registration.
3. Migrate Wave A runtime modules to provider classes.
4. Expand platform runtime boot tests to app/admin/console/worker profiles.

## Acceptance Gates

1. Deterministic provider ordering in tests.
2. No silent fallback behavior in core runtime.
3. Auth/workspace parity tests remain green during migration.
