# Framework Capability Catalog (Stage 5)

Capability declarations are enforced by `jskit` during add/update/remove operations and by `jskit doctor`.

## Runtime + Contracts

| Capability | Providers | Common Consumers |
| --- | --- | --- |
| `runtime.module-framework` | `@jskit-ai/module-framework-core` | `@jskit-ai/server-runtime-core`, `@jskit-ai/action-runtime-core` |
| `runtime.env` | `@jskit-ai/runtime-env-core` | `@jskit-ai/server-runtime-core` |
| `runtime.server` | `@jskit-ai/server-runtime-core` | `@jskit-ai/platform-server-runtime`, `@jskit-ai/health-fastify-adapter`, `@jskit-ai/redis-ops-core`, `@jskit-ai/security-audit-core`, `@jskit-ai/web-runtime-core` |
| `runtime.platform-server` | `@jskit-ai/platform-server-runtime` | Shell bundles |
| `runtime.actions` | `@jskit-ai/action-runtime-core` | Shell bundles |
| `contracts.http` | `@jskit-ai/http-contracts` | `@jskit-ai/health-fastify-adapter`, `@jskit-ai/web-runtime-core` |
| `contracts.realtime` | `@jskit-ai/realtime-contracts` | `@jskit-ai/realtime-server-socketio`, `@jskit-ai/realtime-client-runtime` |
| `runtime.http-client` | `@jskit-ai/http-client-runtime` | `@jskit-ai/web-runtime-core` |
| `runtime.surface-routing` | `@jskit-ai/surface-routing` | `@jskit-ai/web-runtime-core` |
| `runtime.web` | `@jskit-ai/web-runtime-core` | Web shell bundles |

## Infrastructure + Security

| Capability | Providers | Common Consumers |
| --- | --- | --- |
| `db-provider` | `@jskit-ai/db-mysql`, `@jskit-ai/db-postgres` | `@jskit-ai/security-audit-core`, `@jskit-ai/security-audit-knex-mysql` |
| `db.driver.knex-mysql` | `@jskit-ai/knex-mysql-core` | `@jskit-ai/security-audit-knex-mysql` |
| `realtime.server` | `@jskit-ai/realtime-server-socketio` | Realtime bundle consumers |
| `realtime.client` | `@jskit-ai/realtime-client-runtime` | Realtime bundle consumers |
| `ops.redis` | `@jskit-ai/redis-ops-core` | `@jskit-ai/retention-core` |
| `ops.retention` | `@jskit-ai/retention-core` | Retention bundle consumers |
| `security.audit.core` | `@jskit-ai/security-audit-core` | `@jskit-ai/security-audit-knex-mysql` |
| `security.audit.store` | `@jskit-ai/security-audit-knex-mysql` | Security audit bundle consumers |

## Domain Wave A (Auth, Communications, Observability)

| Capability | Providers | Common Consumers |
| --- | --- | --- |
| `auth.access` | `@jskit-ai/access-core` | `@jskit-ai/rbac-core`, `@jskit-ai/auth-fastify-adapter`, `@jskit-ai/auth-provider-supabase-core` |
| `auth.rbac` | `@jskit-ai/rbac-core` | `@jskit-ai/fastify-auth-policy` |
| `auth.policy` | `@jskit-ai/fastify-auth-policy` | `@jskit-ai/auth-fastify-adapter` |
| `auth.routes` | `@jskit-ai/auth-fastify-adapter` | Auth bundle consumers |
| `auth.provider` | `@jskit-ai/auth-provider-supabase-core` | Auth provider bundles |
| `contracts.communications` | `@jskit-ai/communications-contracts` | `@jskit-ai/communications-core`, `@jskit-ai/communications-fastify-adapter` |
| `communications.provider` | `@jskit-ai/communications-provider-core` | `@jskit-ai/communications-core`, `@jskit-ai/email-core`, `@jskit-ai/sms-core` |
| `communications.core` | `@jskit-ai/communications-core` | `@jskit-ai/communications-fastify-adapter` |
| `communications.routes` | `@jskit-ai/communications-fastify-adapter` | Communications bundle consumers |
| `communications.email` | `@jskit-ai/email-core` | Communications bundle consumers |
| `communications.sms` | `@jskit-ai/sms-core` | Communications bundle consumers |
| `observability.core` | `@jskit-ai/observability-core` | `@jskit-ai/observability-fastify-adapter`, `@jskit-ai/console-errors-client-element` |
| `observability.routes` | `@jskit-ai/observability-fastify-adapter` | Observability bundle consumers |
| `observability.console-errors-client` | `@jskit-ai/console-errors-client-element` | Observability bundle consumers |

## Tooling Capabilities

| Capability | Providers |
| --- | --- |
| `tooling.jskit-cli` | `@jskit-ai/jskit` |
| `tooling.create-app` | `@jskit-ai/create-app` |
| `tooling.app-scripts` | `@jskit-ai/app-scripts` |
| `tooling.eslint-config` | `@jskit-ai/config-eslint` |
