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

## Domain Wave B (Chat, Social, Users)

| Capability | Providers | Common Consumers |
| --- | --- | --- |
| `contracts.chat` | `@jskit-ai/chat-contracts` | `@jskit-ai/chat-client-runtime`, `@jskit-ai/chat-core`, `@jskit-ai/chat-fastify-adapter` |
| `chat.storage` | `@jskit-ai/chat-storage-core` | `@jskit-ai/chat-core`, `@jskit-ai/chat-knex-mysql` |
| `chat.storage.mysql` | `@jskit-ai/chat-knex-mysql` | Chat bundle consumers |
| `chat.core` | `@jskit-ai/chat-core` | `@jskit-ai/chat-fastify-adapter` |
| `chat.routes` | `@jskit-ai/chat-fastify-adapter` | Chat/API composition bundles |
| `chat.client-runtime` | `@jskit-ai/chat-client-runtime` | `@jskit-ai/chat-client-element` |
| `chat.client-element` | `@jskit-ai/chat-client-element` | Chat UI bundles |
| `contracts.social` | `@jskit-ai/social-contracts` | `@jskit-ai/social-client-runtime`, `@jskit-ai/social-core`, `@jskit-ai/social-fastify-adapter` |
| `social.core` | `@jskit-ai/social-core` | `@jskit-ai/social-fastify-adapter`, `@jskit-ai/social-knex-mysql` |
| `social.storage.mysql` | `@jskit-ai/social-knex-mysql` | Social bundle consumers |
| `social.routes` | `@jskit-ai/social-fastify-adapter` | Social/API composition bundles |
| `social.client-runtime` | `@jskit-ai/social-client-runtime` | Social UI bundles |
| `users.profile.core` | `@jskit-ai/user-profile-core` | `@jskit-ai/user-profile-knex-mysql`, `@jskit-ai/profile-client-element`, `@jskit-ai/members-admin-client-element` |
| `users.profile.store.mysql` | `@jskit-ai/user-profile-knex-mysql` | Users profile bundles |
| `users.profile.client` | `@jskit-ai/profile-client-element` | Users profile bundles |
| `users.members-admin.client` | `@jskit-ai/members-admin-client-element` | Users profile bundles |

## Domain Wave C (Workspace + Console)

| Capability | Providers | Common Consumers |
| --- | --- | --- |
| `workspace.console.core` | `@jskit-ai/workspace-console-core` | Most workspace adapters/services |
| `workspace.console.store.mysql` | `@jskit-ai/workspace-console-knex-mysql` | `@jskit-ai/workspace-console-service-core` |
| `workspace.console.service` | `@jskit-ai/workspace-console-service-core` | Console/admin bundle consumers |
| `workspace.console.routes` | `@jskit-ai/console-fastify-adapter` | Workspace console bundle consumers |
| `workspace.console-errors.routes` | `@jskit-ai/console-errors-fastify-adapter` | Workspace console bundle consumers |
| `workspace.settings.routes` | `@jskit-ai/settings-fastify-adapter` | Workspace console bundle consumers |
| `workspace.store.mysql` | `@jskit-ai/workspace-knex-mysql` | `@jskit-ai/workspace-service-core` |
| `workspace.service` | `@jskit-ai/workspace-service-core` | `@jskit-ai/workspace-fastify-adapter` |
| `workspace.routes` | `@jskit-ai/workspace-fastify-adapter` | Workspace core/admin bundles |

## Tooling Capabilities

| Capability | Providers |
| --- | --- |
| `tooling.jskit-cli` | `@jskit-ai/jskit` |
| `tooling.create-app` | `@jskit-ai/create-app` |
| `tooling.app-scripts` | `@jskit-ai/app-scripts` |
| `tooling.eslint-config` | `@jskit-ai/config-eslint` |
