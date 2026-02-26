# Bundle Catalog (Stage 10)

This catalog documents each bundle in `packages/tooling/jskit/packs` with purpose, package set, capability requirements, options, and conflict notes.

## api-shell

- Purpose: Core shell with API contract packages.
- Included packages:
  - `@jskit-ai/action-runtime-core`
  - `@jskit-ai/health-fastify-adapter`
  - `@jskit-ai/http-contracts`
  - `@jskit-ai/module-framework-core`
  - `@jskit-ai/platform-server-runtime`
  - `@jskit-ai/realtime-contracts`
  - `@jskit-ai/runtime-env-core`
  - `@jskit-ai/server-runtime-core`
- Required capabilities:
  - `contracts.http`
  - `runtime.env`
  - `runtime.module-framework`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## assistant-base

- Purpose: Assistant runtime, API adapter, and transcript persistence base.
- Included packages:
  - `@jskit-ai/assistant-client-element`
  - `@jskit-ai/assistant-client-runtime`
  - `@jskit-ai/assistant-contracts`
  - `@jskit-ai/assistant-core`
  - `@jskit-ai/assistant-fastify-adapter`
  - `@jskit-ai/assistant-transcript-explorer-client-element`
  - `@jskit-ai/assistant-transcripts-core`
  - `@jskit-ai/assistant-transcripts-knex-mysql`
- Required capabilities:
  - `assistant.client-runtime`
  - `assistant.core`
  - `assistant.transcripts.core`
  - `contracts.assistant`
  - `contracts.http`
  - `db-provider`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.

## assistant-openai

- Purpose: Assistant base plus OpenAI provider integration.
- Included packages:
  - `@jskit-ai/assistant-client-element`
  - `@jskit-ai/assistant-client-runtime`
  - `@jskit-ai/assistant-contracts`
  - `@jskit-ai/assistant-core`
  - `@jskit-ai/assistant-fastify-adapter`
  - `@jskit-ai/assistant-provider-openai`
  - `@jskit-ai/assistant-transcript-explorer-client-element`
  - `@jskit-ai/assistant-transcripts-core`
  - `@jskit-ai/assistant-transcripts-knex-mysql`
- Required capabilities:
  - `assistant.client-runtime`
  - `assistant.core`
  - `assistant.transcripts.core`
  - `contracts.assistant`
  - `contracts.http`
  - `db-provider`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.

## auth-base

- Purpose: Core authentication and policy packages.
- Included packages:
  - `@jskit-ai/access-core`
  - `@jskit-ai/auth-fastify-adapter`
  - `@jskit-ai/fastify-auth-policy`
  - `@jskit-ai/rbac-core`
- Required capabilities:
  - `auth.access`
  - `auth.policy`
  - `auth.rbac`
  - `contracts.http`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## auth-supabase

- Purpose: Supabase authentication provider overlay.
- Included packages:
  - `@jskit-ai/access-core`
  - `@jskit-ai/auth-fastify-adapter`
  - `@jskit-ai/auth-provider-supabase-core`
  - `@jskit-ai/fastify-auth-policy`
  - `@jskit-ai/rbac-core`
- Required capabilities:
  - `auth.access`
  - `auth.policy`
  - `auth.rbac`
  - `contracts.http`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## billing-base

- Purpose: Billing domain core, service, storage, and API adapter.
- Included packages:
  - `@jskit-ai/billing-commerce-client-element`
  - `@jskit-ai/billing-console-admin-client-element`
  - `@jskit-ai/billing-core`
  - `@jskit-ai/billing-fastify-adapter`
  - `@jskit-ai/billing-knex-mysql`
  - `@jskit-ai/billing-plan-client-element`
  - `@jskit-ai/billing-provider-core`
  - `@jskit-ai/billing-service-core`
  - `@jskit-ai/entitlements-core`
  - `@jskit-ai/entitlements-knex-mysql`
- Required capabilities:
  - `auth.access`
  - `billing.core`
  - `billing.entitlements.core`
  - `billing.entitlements.store.mysql`
  - `billing.provider`
  - `billing.service`
  - `contracts.http`
  - `db-provider`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.
  - Requires auth capability providers such as `auth-base`.

## billing-paddle

- Purpose: Billing base with Paddle provider package.
- Included packages:
  - `@jskit-ai/billing-commerce-client-element`
  - `@jskit-ai/billing-console-admin-client-element`
  - `@jskit-ai/billing-core`
  - `@jskit-ai/billing-fastify-adapter`
  - `@jskit-ai/billing-knex-mysql`
  - `@jskit-ai/billing-plan-client-element`
  - `@jskit-ai/billing-provider-core`
  - `@jskit-ai/billing-provider-paddle`
  - `@jskit-ai/billing-service-core`
  - `@jskit-ai/entitlements-core`
  - `@jskit-ai/entitlements-knex-mysql`
- Required capabilities:
  - `auth.access`
  - `billing.core`
  - `billing.entitlements.core`
  - `billing.entitlements.store.mysql`
  - `billing.provider`
  - `billing.service`
  - `contracts.http`
  - `db-provider`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.
  - Requires auth capability providers such as `auth-base`.

## billing-stripe

- Purpose: Billing base with Stripe provider package.
- Included packages:
  - `@jskit-ai/billing-commerce-client-element`
  - `@jskit-ai/billing-console-admin-client-element`
  - `@jskit-ai/billing-core`
  - `@jskit-ai/billing-fastify-adapter`
  - `@jskit-ai/billing-knex-mysql`
  - `@jskit-ai/billing-plan-client-element`
  - `@jskit-ai/billing-provider-core`
  - `@jskit-ai/billing-provider-stripe`
  - `@jskit-ai/billing-service-core`
  - `@jskit-ai/entitlements-core`
  - `@jskit-ai/entitlements-knex-mysql`
- Required capabilities:
  - `auth.access`
  - `billing.core`
  - `billing.entitlements.core`
  - `billing.entitlements.store.mysql`
  - `billing.provider`
  - `billing.service`
  - `contracts.http`
  - `db-provider`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.
  - Requires auth capability providers such as `auth-base`.

## billing-worker

- Purpose: Billing service and worker processing packages.
- Included packages:
  - `@jskit-ai/billing-core`
  - `@jskit-ai/billing-provider-core`
  - `@jskit-ai/billing-service-core`
  - `@jskit-ai/billing-worker-core`
  - `@jskit-ai/entitlements-core`
- Required capabilities:
  - `auth.access`
  - `billing.core`
  - `billing.entitlements.core`
  - `billing.provider`
  - `billing.service`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - Requires auth capability providers such as `auth-base`.

## chat-base

- Purpose: Chat contracts, storage, API adapter, and client runtime.
- Included packages:
  - `@jskit-ai/chat-client-element`
  - `@jskit-ai/chat-client-runtime`
  - `@jskit-ai/chat-contracts`
  - `@jskit-ai/chat-core`
  - `@jskit-ai/chat-fastify-adapter`
  - `@jskit-ai/chat-knex-mysql`
  - `@jskit-ai/chat-storage-core`
- Required capabilities:
  - `auth.rbac`
  - `chat.client-runtime`
  - `chat.core`
  - `chat.storage`
  - `contracts.chat`
  - `contracts.http`
  - `db-provider`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.

## communications-base

- Purpose: Communications contracts, core services, and providers.
- Included packages:
  - `@jskit-ai/communications-contracts`
  - `@jskit-ai/communications-core`
  - `@jskit-ai/communications-fastify-adapter`
  - `@jskit-ai/communications-provider-core`
  - `@jskit-ai/email-core`
  - `@jskit-ai/sms-core`
- Required capabilities:
  - `communications.core`
  - `communications.provider`
  - `contracts.communications`
  - `contracts.http`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## community-suite

- Purpose: Combined chat, social, and users profile suite.
- Included packages:
  - `@jskit-ai/chat-client-element`
  - `@jskit-ai/chat-client-runtime`
  - `@jskit-ai/chat-contracts`
  - `@jskit-ai/chat-core`
  - `@jskit-ai/chat-fastify-adapter`
  - `@jskit-ai/chat-knex-mysql`
  - `@jskit-ai/chat-storage-core`
  - `@jskit-ai/members-admin-client-element`
  - `@jskit-ai/profile-client-element`
  - `@jskit-ai/social-client-runtime`
  - `@jskit-ai/social-contracts`
  - `@jskit-ai/social-core`
  - `@jskit-ai/social-fastify-adapter`
  - `@jskit-ai/social-knex-mysql`
  - `@jskit-ai/user-profile-core`
  - `@jskit-ai/user-profile-knex-mysql`
- Required capabilities:
  - `auth.rbac`
  - `chat.client-runtime`
  - `chat.core`
  - `chat.storage`
  - `contracts.chat`
  - `contracts.http`
  - `contracts.social`
  - `db-provider`
  - `runtime.server`
  - `social.core`
  - `users.profile.core`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.

## core-shell

- Purpose: Core runtime shell for JSKIT applications.
- Included packages:
  - `@jskit-ai/action-runtime-core`
  - `@jskit-ai/health-fastify-adapter`
  - `@jskit-ai/http-contracts`
  - `@jskit-ai/module-framework-core`
  - `@jskit-ai/platform-server-runtime`
  - `@jskit-ai/runtime-env-core`
  - `@jskit-ai/server-runtime-core`
- Required capabilities:
  - `contracts.http`
  - `runtime.env`
  - `runtime.module-framework`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## db

- Purpose: Database capability pack. Choose one db-provider package.
- Included packages:
  - `@jskit-ai/db-mysql`
  - `@jskit-ai/db-postgres`
- Required capabilities:
  - None
- Options:
  - `provider` (required) values: mysql | postgres
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## observability-base

- Purpose: Observability core, server adapter, and console client element.
- Included packages:
  - `@jskit-ai/console-errors-client-element`
  - `@jskit-ai/observability-core`
  - `@jskit-ai/observability-fastify-adapter`
- Required capabilities:
  - `contracts.http`
  - `observability.core`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## ops-retention

- Purpose: Operational retention workers and Redis queue support.
- Included packages:
  - `@jskit-ai/redis-ops-core`
  - `@jskit-ai/retention-core`
- Required capabilities:
  - `ops.redis`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## realtime

- Purpose: Realtime server/client infrastructure packages.
- Included packages:
  - `@jskit-ai/realtime-client-runtime`
  - `@jskit-ai/realtime-contracts`
  - `@jskit-ai/realtime-server-socketio`
- Required capabilities:
  - `contracts.realtime`
  - `runtime.server`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## saas-full

- Purpose: Composed assistant, billing, workspace, auth, and observability suite.
- Included packages:
  - `@jskit-ai/access-core`
  - `@jskit-ai/assistant-client-element`
  - `@jskit-ai/assistant-client-runtime`
  - `@jskit-ai/assistant-contracts`
  - `@jskit-ai/assistant-core`
  - `@jskit-ai/assistant-fastify-adapter`
  - `@jskit-ai/assistant-provider-openai`
  - `@jskit-ai/assistant-transcript-explorer-client-element`
  - `@jskit-ai/assistant-transcripts-core`
  - `@jskit-ai/assistant-transcripts-knex-mysql`
  - `@jskit-ai/auth-fastify-adapter`
  - `@jskit-ai/billing-commerce-client-element`
  - `@jskit-ai/billing-console-admin-client-element`
  - `@jskit-ai/billing-core`
  - `@jskit-ai/billing-fastify-adapter`
  - `@jskit-ai/billing-knex-mysql`
  - `@jskit-ai/billing-plan-client-element`
  - `@jskit-ai/billing-provider-core`
  - `@jskit-ai/billing-provider-stripe`
  - `@jskit-ai/billing-service-core`
  - `@jskit-ai/billing-worker-core`
  - `@jskit-ai/console-errors-client-element`
  - `@jskit-ai/db-mysql`
  - `@jskit-ai/entitlements-core`
  - `@jskit-ai/entitlements-knex-mysql`
  - `@jskit-ai/fastify-auth-policy`
  - `@jskit-ai/observability-core`
  - `@jskit-ai/observability-fastify-adapter`
  - `@jskit-ai/rbac-core`
  - `@jskit-ai/workspace-console-core`
  - `@jskit-ai/workspace-console-knex-mysql`
  - `@jskit-ai/workspace-console-service-core`
  - `@jskit-ai/workspace-fastify-adapter`
  - `@jskit-ai/workspace-knex-mysql`
  - `@jskit-ai/workspace-service-core`
- Required capabilities:
  - `assistant.client-runtime`
  - `assistant.core`
  - `assistant.transcripts.core`
  - `auth.access`
  - `auth.policy`
  - `auth.rbac`
  - `billing.core`
  - `billing.entitlements.core`
  - `billing.entitlements.store.mysql`
  - `billing.provider`
  - `billing.service`
  - `contracts.assistant`
  - `contracts.http`
  - `db-provider`
  - `observability.core`
  - `runtime.server`
  - `workspace.console.core`
  - `workspace.console.store.mysql`
  - `workspace.store.mysql`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## security-audit

- Purpose: Security audit capability with knex/mysql storage adapter.
- Included packages:
  - `@jskit-ai/security-audit-core`
  - `@jskit-ai/security-audit-knex-mysql`
- Required capabilities:
  - `db-provider`
  - `runtime.server`
  - `security.audit.core`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.

## social-base

- Purpose: Social contracts, storage, adapter, and client runtime.
- Included packages:
  - `@jskit-ai/social-client-runtime`
  - `@jskit-ai/social-contracts`
  - `@jskit-ai/social-core`
  - `@jskit-ai/social-fastify-adapter`
  - `@jskit-ai/social-knex-mysql`
- Required capabilities:
  - `contracts.http`
  - `contracts.social`
  - `db-provider`
  - `runtime.server`
  - `social.core`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.

## users-profile

- Purpose: User profile core, storage, and client elements.
- Included packages:
  - `@jskit-ai/members-admin-client-element`
  - `@jskit-ai/profile-client-element`
  - `@jskit-ai/user-profile-core`
  - `@jskit-ai/user-profile-knex-mysql`
- Required capabilities:
  - `db-provider`
  - `runtime.server`
  - `users.profile.core`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.

## web-shell

- Purpose: Core shell with browser/runtime surface packages.
- Included packages:
  - `@jskit-ai/action-runtime-core`
  - `@jskit-ai/health-fastify-adapter`
  - `@jskit-ai/http-client-runtime`
  - `@jskit-ai/http-contracts`
  - `@jskit-ai/module-framework-core`
  - `@jskit-ai/platform-server-runtime`
  - `@jskit-ai/runtime-env-core`
  - `@jskit-ai/server-runtime-core`
  - `@jskit-ai/surface-routing`
  - `@jskit-ai/web-runtime-core`
- Required capabilities:
  - `contracts.http`
  - `runtime.env`
  - `runtime.http-client`
  - `runtime.module-framework`
  - `runtime.server`
  - `runtime.surface-routing`
- Options:
  - None
- Conflict notes:
  - No known hard conflicts beyond capability requirements.

## workspace-admin-suite

- Purpose: Combined workspace service and console administration suite.
- Included packages:
  - `@jskit-ai/console-errors-fastify-adapter`
  - `@jskit-ai/console-fastify-adapter`
  - `@jskit-ai/settings-fastify-adapter`
  - `@jskit-ai/workspace-console-core`
  - `@jskit-ai/workspace-console-knex-mysql`
  - `@jskit-ai/workspace-console-service-core`
  - `@jskit-ai/workspace-fastify-adapter`
  - `@jskit-ai/workspace-knex-mysql`
  - `@jskit-ai/workspace-service-core`
- Required capabilities:
  - `auth.access`
  - `auth.rbac`
  - `auth.routes`
  - `contracts.http`
  - `db-provider`
  - `observability.core`
  - `runtime.server`
  - `workspace.console.core`
  - `workspace.console.store.mysql`
  - `workspace.store.mysql`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.
  - Requires auth capability providers such as `auth-base`.

## workspace-console

- Purpose: Workspace console routes, storage, and service packages.
- Included packages:
  - `@jskit-ai/console-errors-fastify-adapter`
  - `@jskit-ai/console-fastify-adapter`
  - `@jskit-ai/settings-fastify-adapter`
  - `@jskit-ai/workspace-console-core`
  - `@jskit-ai/workspace-console-knex-mysql`
  - `@jskit-ai/workspace-console-service-core`
- Required capabilities:
  - `auth.access`
  - `auth.rbac`
  - `auth.routes`
  - `contracts.http`
  - `db-provider`
  - `observability.core`
  - `runtime.server`
  - `workspace.console.core`
  - `workspace.console.store.mysql`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.
  - Requires auth capability providers such as `auth-base`.

## workspace-core

- Purpose: Workspace service core, storage, and API routes.
- Included packages:
  - `@jskit-ai/workspace-console-core`
  - `@jskit-ai/workspace-fastify-adapter`
  - `@jskit-ai/workspace-knex-mysql`
  - `@jskit-ai/workspace-service-core`
- Required capabilities:
  - `auth.access`
  - `auth.rbac`
  - `contracts.http`
  - `db-provider`
  - `runtime.server`
  - `workspace.console.core`
  - `workspace.store.mysql`
- Options:
  - None
- Conflict notes:
  - Requires db provider capability from `db` or another provider bundle.
  - Requires auth capability providers such as `auth-base`.

