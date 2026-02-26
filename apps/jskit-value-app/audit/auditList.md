# Audit List (Path-Explicit)

Use each item as a single-session module audit with:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/instructions-auditing.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/instructions-fixing.md`

For every item:
1. Audit pass creates/updates the listed report file and appends current `Broken things`.
2. Fixing pass moves resolved items to `Fixed things` or `Won't fix things`.
3. Future audit passes append newly found issues without deleting historical fixed/won't-fix entries.
4. Every audit pass must also review related `tests/**` and run targeted validation commands when feasible.
5. Each fixed issue requires exactly one commit (`one commit per issue`).

Do not pre-create report files. They are created by each audit execution.
Issue ID format for all reports: `NN-ISSUE-###` (domain number + per-domain issue number).

## 01) Server skeleton and runtime composition
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/01-server-skeleton-runtime-composition.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/02.bootstrap.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/03.request.md`

## 02) API manifest and registration
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/02-api-manifest-registration.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/api`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/registerApiRoutes.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/apiPaths.js`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/01.endpoint-a-to-z.md`

## 03) Auth provider and session pipeline
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/03-auth-provider-session-pipeline.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/auth`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/auth.plugin.js`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/05.permissions.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/06.auth-session.md`

## 04) Workspace and surface policy core
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/04-workspace-surface-policy-core.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/workspace`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/surfaceRegistry.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/surfacePaths.js`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/workspace-and-surfaces.md`

## 05) Console access and permission model
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/05-console-access-permission-model.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/console`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/15.console-access.md`

## 06) Action runtime composition
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/06-action-runtime-composition.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/action-runtime-and-contributors.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/04.action-runtime.md`

## 07) Action catalog governance drift
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/07-action-catalog-governance-drift.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/actionIds.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributorManifest.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/action-catalog-governance.md`
- `/home/merc/Development/current/jskit-ai/actions_map.md`

## 08) Projects domain
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/08-projects-domain.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/projects`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/projects`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/01.endpoint-a-to-z.md`

## 09) Deg2rad + history domain
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/09-deg2rad-history-domain.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/deg2rad`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/history`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/components/deg2rad-calculator-form`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/components/deg2rad-history-list`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/deg2rad-calculator`

## 10) Settings/profile/security domain
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/10-settings-profile-security-domain.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/settings`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/settings`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/14.error-handling.md`

## 11) Alerts domain
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/11-alerts-domain.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/alerts`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/alerts`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/alerts.contributor.js`

## 12) AI assistant runtime and tools
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/12-ai-assistant-runtime-tools.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/ai`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/modules/assistant/runtime.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/assistant`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/10.assistant-tools.md`

## 13) Chat command/message flow
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/13-chat-command-message-flow.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/chat`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/chat`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/08.chat-message.md`

## 14) Chat uploads/attachments safety
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/14-chat-uploads-attachments-safety.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/chat/repositories/attachments.repository.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/chat/services/chat.service.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/chat/routes.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/chat/controller.js`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/09.uploads.md`

## 15) Billing workspace self-service contracts
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/15-billing-workspace-self-service-contracts.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/billing`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-fastify-adapter/src`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-service-core/src`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/billing/contracts.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/billing/integration.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/11.billing-checkout-webhooks.md`

## 16) Billing console admin operations
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/16-billing-console-admin-operations.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingEntitlementsView.vue`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingEventsView.vue`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingPlanAssignmentsView.vue`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingPlansView.vue`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingProductsView.vue`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingPurchasesView.vue`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/console/ConsoleBillingSubscriptionsView.vue`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router/routes/consoleCoreRoutes.js`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-fastify-adapter/src`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-service-core/src`

## 17) Billing provider insulation and webhooks
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/17-billing-provider-insulation-webhooks.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/billingWebhookRawBody.plugin.js`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-provider-core`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-provider-stripe`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-provider-paddle`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-fastify-adapter/src`
- `/home/merc/Development/current/jskit-ai/packages/billing/billing-service-core/src`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/billing/provider-insulation.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/11.billing-checkout-webhooks.md`

## 18) Realtime server and subscription policy
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/18-realtime-server-subscription-policy.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/realtime`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/realtime/subscribeContext.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/topicRegistry.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/eventTypes.js`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/07.realtime.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/realtime/contracts.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/realtime/coverage-matrix.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/realtime/operations.md`

## 19) Social federation architecture
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/19-social-federation-architecture.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/social`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/config/social.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/fastify/activityPubRawBody.plugin.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views/social`
- `/home/merc/Development/current/jskit-ai/packages/social/social-core`
- `/home/merc/Development/current/jskit-ai/packages/social/social-fastify-adapter`
- `/home/merc/Development/current/jskit-ai/packages/social/social-knex-mysql`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/social-federation.md`

## 20) Communications module and provider seams
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/20-communications-module-provider-seams.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules/communications`
- `/home/merc/Development/current/jskit-ai/packages/communications/communications-core`
- `/home/merc/Development/current/jskit-ai/packages/communications/communications-fastify-adapter`
- `/home/merc/Development/current/jskit-ai/packages/communications/communications-provider-core`
- `/home/merc/Development/current/jskit-ai/packages/communications/email-core`
- `/home/merc/Development/current/jskit-ai/packages/communications/sms-core`

## 21) Observability and audit pipelines
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/21-observability-audit-pipelines.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/platform/observability`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/auditAdapters.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/observabilityAdapters.js`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/services.js`
- `/home/merc/Development/current/jskit-ai/packages/observability/observability-core`
- `/home/merc/Development/current/jskit-ai/packages/security/security-audit-core`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/operations/observability.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/13.audit-observability.md`

## 22) Worker and retention runtime
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/22-worker-retention-runtime.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/workers`
- `/home/merc/Development/current/jskit-ai/packages/operations/retention-core`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/operations/retention-worker.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/flows/16.worker-retention.md`

## 23) Client bootstrap and multi-surface routing
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/23-client-bootstrap-multi-surface-routing.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/bootstrap`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/router`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/shells`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/workspace-and-surfaces.md`

## 24) Client state stores and runtime integration
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/24-client-state-runtime-integration.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/app/state`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/platform/http/api`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/platform/realtime`

## 25) Client boundaries and package usage
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/25-client-boundaries-package-usage.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/views`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/modules`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/architecture/client-boundaries.md`
- `/home/merc/Development/current/jskit-ai/packages`

Required check:
- Validate `@jskit-ai/*` import usage from app code against client-boundary rules.

## 26) Shared contracts and policy registries
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/26-shared-contracts-policy-registries.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/modules`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/realtime`

## 27) Config and environment safety
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/27-config-environment-safety.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/config`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/.env.example`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server.js`

## 28) Data model, migrations, and tenancy safety
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/28-data-model-migrations-tenancy-safety.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/migrations`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/migration-baseline-steps`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/db`

Required docs:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/database/schema-areas.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/database/billing-live-schema.md`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/database/migrations-and-seeds.md`

## 29) Test quality and risk coverage gaps
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/29-test-quality-risk-coverage-gaps.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/tests`
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/playbooks/03.testing-minimums.md`

Required check:
- Identify missing high-risk tests by domain and contract area.

## 30) Synthesis: merged risk ranking and 14-day remediation plan
Report file:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports/30-synthesis-merged-risk-plan.report.md`

Required scope:
- `/home/merc/Development/current/jskit-ai/apps/jskit-value-app/audit/reports`

Required task:
1. Merge findings from reports `01` through `29`.
2. Deduplicate by root cause.
3. Rank by risk x exploitability x blast radius.
4. Produce a 14-day remediation plan with execution order.
