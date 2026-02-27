THE_GREAT_TIDYING_UP.md

Execution-ready runbook for removing scope creep and restoring clear package boundaries.

This document replaces prior draft notes. It is definitive for implementation.

---

## 0) Mission

Fix four specific scope-creep failures, without introducing new packages:

1. `@jskit-ai/web-runtime-core` is acting as a domain API bucket.
2. `@jskit-ai/workspace-console-service-core` is a mixed-domain monolith.
3. `console.contributor` is overloaded with unrelated concerns.
4. `apps/jskit-value-app/server/runtime/services.js` contains too much domain logic.

Hard constraints:

- Sequential execution only.
- One commit per stage.
- No stage skipping.
- Do not stop between stages unless truly blocked by an ambiguity.
- No new packages.
- Preserve behavior and contracts unless explicitly noted.

---

## 1) Ownership Rule (Final)

### 1.1 Add to Existing Package vs Create New Package

Add functionality to an existing package when all are true:

- The behavior belongs to that package domain.
- The package contract (README + descriptor intent) still holds.
- Adding it does not create a new mixed "bucket."
- Reuse value is higher than app-local duplication.

Create a new package only when at least one is true:

- No existing package can own it without boundary violation.
- It needs separate lifecycle/versioning.
- It is optional-heavy and should not be forced onto all consumers.
- It would make an existing package monolithic.

### 1.2 New package list

- None.

Everything in this plan lands in existing packages.

---

## 2) Finding-to-Target Ownership Map (Function-Level)

## 2.1 Finding A: `web-runtime-core` API bucket

Current problem sources:

- `packages/web/web-runtime-core/src/shared/index.js`
- `packages/web/web-runtime-core/src/shared/apiClients/*`

Target:

- `web-runtime-core` keeps only runtime primitives (transport/composition/pagination hooks).
- Domain API factories move to domain owners.

### Method move matrix (exact)

#### A) `authApi.js` -> `@jskit-ai/access-core`

Move all methods unchanged:

- `session`
- `register`
- `login`
- `requestOtp`
- `verifyOtp`
- `oauthStartUrl`
- `oauthComplete`
- `requestPasswordReset`
- `completePasswordRecovery`
- `resetPassword`
- `logout`

Target file:

- `packages/auth/access-core/src/shared/client/authApi.js`

Exports:

- `@jskit-ai/access-core/client/authApi`

---

#### B) `workspaceApi.js` split

Workspace core methods -> `@jskit-ai/workspace-service-core`:

- `bootstrap`
- `list`
- `select`
- `listPendingInvites`
- `redeemInvite`
- `getSettings`
- `updateSettings`
- `listRoles`
- `listMembers`
- `updateMemberRole`
- `listInvites`
- `createInvite`
- `revokeInvite`

Target file:

- `packages/workspace/workspace-service-core/src/shared/client/workspaceApi.js`

Exports:

- `@jskit-ai/workspace-service-core/client/workspaceApi`

Workspace transcript methods -> `@jskit-ai/assistant-client-runtime`:

- `listAiTranscripts`
- `getAiTranscriptMessages`
- `exportAiTranscript`

Target file:

- `packages/ai-agent/assistant-client-runtime/src/shared/workspaceTranscriptsApi.js`

Exports:

- `@jskit-ai/assistant-client-runtime/workspaceTranscriptsApi`

---

#### C) `consoleApi.js` split

Console core methods -> `@jskit-ai/workspace-console-service-core`:

- `bootstrap`
- `listRoles`
- `getSettings`
- `updateSettings`
- `listMembers`
- `updateMemberRole`
- `listInvites`
- `createInvite`
- `revokeInvite`
- `listPendingInvites`
- `redeemInvite`

Target file:

- `packages/workspace/workspace-console-service-core/src/shared/client/consoleApi.js`

Exports:

- `@jskit-ai/workspace-console-service-core/client/consoleApi`

Console error methods -> `@jskit-ai/observability-core`:

- `listBrowserErrors`
- `getBrowserError`
- `listServerErrors`
- `getServerError`
- `simulateServerError`
- `reportBrowserError`

Target file:

- `packages/observability/observability-core/src/shared/client/consoleErrorsApi.js`

Exports:

- `@jskit-ai/observability-core/client/consoleErrorsApi`

Console transcript methods -> `@jskit-ai/assistant-client-runtime`:

- `listAiTranscripts`
- `getAiTranscriptMessages`
- `exportAiTranscripts`

Target file:

- `packages/ai-agent/assistant-client-runtime/src/shared/consoleTranscriptsApi.js`

Exports:

- `@jskit-ai/assistant-client-runtime/consoleTranscriptsApi`

Console billing-admin methods -> `@jskit-ai/billing-service-core`:

- `listBillingEvents`
- `listBillingPlans`
- `listBillingProducts`
- `getBillingSettings`
- `updateBillingSettings`
- `listBillingProviderPrices`
- `createBillingPlan`
- `createBillingProduct`
- `updateBillingPlan`
- `updateBillingProduct`
- `listEntitlementDefinitions`
- `getEntitlementDefinition`
- `createEntitlementDefinition`
- `updateEntitlementDefinition`
- `deleteEntitlementDefinition`
- `archiveBillingPlan`
- `unarchiveBillingPlan`
- `deleteBillingPlan`
- `archiveBillingProduct`
- `unarchiveBillingProduct`
- `deleteBillingProduct`
- `listPurchases`
- `refundPurchase`
- `voidPurchase`
- `createPurchaseCorrection`
- `listPlanAssignments`
- `createPlanAssignment`
- `updatePlanAssignment`
- `cancelPlanAssignment`
- `listSubscriptions`
- `changeSubscriptionPlan`
- `cancelSubscription`
- `cancelSubscriptionAtPeriodEnd`

Also move billing idempotency helpers used by these methods:

- `generateIdempotencyKey`
- `resolveIdempotencyKey`
- `buildOptionalIdempotencyHeaders`

Target files:

- `packages/billing/billing-service-core/src/shared/client/consoleBillingApi.js`
- `packages/billing/billing-service-core/src/shared/client/idempotencyHeaders.js`

Exports:

- `@jskit-ai/billing-service-core/client/consoleBillingApi`

---

#### D) `billingApi.js` -> `@jskit-ai/billing-service-core`

Move methods unchanged:

- `listPlans`
- `listProducts`
- `listPurchases`
- `getPlanState`
- `listPaymentMethods`
- `syncPaymentMethods`
- `setDefaultPaymentMethod`
- `detachPaymentMethod`
- `removePaymentMethod`
- `getLimitations`
- `getTimeline`
- `startCheckout`
- `requestPlanChange`
- `cancelPendingPlanChange`
- `createPortal`
- `createPaymentLink`

Target files:

- `packages/billing/billing-service-core/src/shared/client/workspaceBillingApi.js`
- `packages/billing/billing-service-core/src/shared/client/idempotencyHeaders.js` (shared helper)

Exports:

- `@jskit-ai/billing-service-core/client/workspaceBillingApi`

---

#### E) `settingsApi.js`, `alertsApi.js`, `historyApi.js` leave package bucket and become app-owned

Reason:

- settings shape is guaranteed to vary by app
- alerts/history backend ownership is app-owned in this repo state

Target files:

- `apps/jskit-value-app/src/modules/settings/api.js`
- `apps/jskit-value-app/src/modules/alerts/api.js`
- `apps/jskit-value-app/src/modules/history/api.js`

---

#### F) App composition update

`apps/jskit-value-app/src/framework/moduleRegistry.base.js` must compose `api.workspace` and `api.console` from domain pieces while preserving external API keys and method names currently consumed by UI.

No UI-facing API key rename is allowed:

- keep `api.auth`, `api.workspace`, `api.console`, `api.settings`, `api.alerts`, `api.history`, `api.billing`.

---

## 2.2 Finding B: `workspace-console-service-core` monolith

Current problem sources:

- `packages/workspace/workspace-console-service-core/src/shared/index.js`
- `.../services/console.service.js`
- `.../services/consoleBilling.service.js`
- `.../services/billingSettings.service.js`
- `.../services/billingCatalog.service.js`
- `.../services/billingCatalogProviderPricing.service.js`
- `.../services/errors.service.js`

Target ownership:

- Billing console services -> `@jskit-ai/billing-service-core`
- Console error service -> `@jskit-ai/observability-core`
- Workspace-console service keeps only:
  - console access
  - members
  - invites
  - bootstrap/roles
  - assistant settings facade

### Service move matrix

Move these files into billing package (same symbols):

- `consoleBilling.service.js`
- `billingSettings.service.js`
- `billingCatalog.service.js`
- `billingCatalogProviderPricing.service.js`

Move this file into observability package:

- `errors.service.js` (as `consoleErrors.service.js`)

Refactor `console.service.js` so it receives moved services via explicit DI dependencies rather than owning those internals.

Required effect:

- `workspace-console-service-core` `index.js` no longer exports billing/errors service surfaces in final stage.

---

## 2.3 Finding C: overloaded `console.contributor`

Current problem source:

- `packages/workspace/workspace-console-service-core/src/shared/actions/console.contributor.js`

Target split:

1. `workspace-console-service-core`: core console actions only.
2. `billing-service-core`: all `console.billing.*` actions, billing idempotency policy map, billing assistant tool schema config.
3. `assistant-transcripts-core`: all `console.ai.*` transcript actions.
4. `action-runtime-core`: generic realtime-command publish helper utilities.

### Exact logic extraction

Move billing-specific constants/helpers/actions:

- `CONSOLE_BILLING_ACTION_IDEMPOTENCY`
- `CONSOLE_BILLING_ASSISTANT_TOOL_CONFIG`
- `applyConsoleBillingAssistantToolConfig`
- all action definitions with ids starting `console.billing.`

Move transcript actions:

- `console.ai.transcripts.list`
- `console.ai.transcript.messages.get`
- `console.ai.transcripts.export`

Move generic realtime command helper logic (not console-specific):

- `resolveCommandId`
- `resolveSourceClientId`
- realtime publish decorator logic currently embedded in contributor

Target helper file:

- `packages/runtime/action-runtime-core/src/shared/realtimePublish.js`

App assembly update:

- `apps/jskit-value-app/server/framework/actionContributorFragments.js`
  - register core console contributor
  - register billing console contributor
  - register assistant transcript contributor
  - keep module filters deterministic

---

## 2.4 Finding D: app composition root is too smart

Current problem source:

- `apps/jskit-value-app/server/runtime/services.js`

Functions to extract:

- `createBillingDisabledServices`
- `createBillingSubsystem`
- `createSocialOutboxWorkerRuntimeService`
- `hasNonEmptyEnvValue`
- `toMs`
- `resolveAuthProviderId`
- `resolveSupabaseAuthUrl`
- `resolveAuthJwtAudience`
- `throwEnabledSubsystemStartupPreflightError`

Target ownership:

- Billing runtime composition helpers -> `@jskit-ai/billing-worker-core`
- Social outbox worker runtime helper -> `@jskit-ai/social-core`
- Startup preflight + auth env resolver helpers -> `@jskit-ai/runtime-env-core`

Result requirement:

- `server/runtime/services.js` becomes declarative wiring only.
- It may still compose service IDs and call factories, but not hold domain policy implementations.

---

## 3) Target Export Contract Changes (Package-level)

Required new export subpaths:

- `@jskit-ai/access-core/client/authApi`
- `@jskit-ai/workspace-service-core/client/workspaceApi`
- `@jskit-ai/workspace-console-service-core/client/consoleApi`
- `@jskit-ai/billing-service-core/client/workspaceBillingApi`
- `@jskit-ai/billing-service-core/client/consoleBillingApi`
- `@jskit-ai/observability-core/client/consoleErrorsApi`
- `@jskit-ai/assistant-client-runtime/workspaceTranscriptsApi`
- `@jskit-ai/assistant-client-runtime/consoleTranscriptsApi`
- `@jskit-ai/assistant-transcripts-core/actions/consoleTranscripts`
- `@jskit-ai/billing-service-core/actions/consoleBilling`
- `@jskit-ai/workspace-console-service-core/actions/consoleCore`
- `@jskit-ai/action-runtime-core/realtimePublish`
- `@jskit-ai/social-core/outboxWorkerRuntimeService`
- `@jskit-ai/runtime-env-core/startupPreflight`
- `@jskit-ai/billing-worker-core/runtimeSubsystemFactory`

Required removals in final stage:

- all `@jskit-ai/web-runtime-core/apiClients*` exports
- moved billing/errors exports from `@jskit-ai/workspace-console-service-core`

---

## 4) Stage Plan (Sequential, Commit per Stage)

Stage order is mandatory.

Each stage must end with:

1. targeted tests
2. clean commit
3. short stage note in commit message body with verification commands run

---

### Stage 0 - Baseline snapshot and safety net

Goal:

- Freeze baseline behavior before moving ownership.

Work:

- Create one markdown snapshot in repo root:
  - `THE_GREAT_TIDYING_UP_BASELINE.md`
  - include outputs of:
    - `rg -n "web-runtime-core/apiClients" apps packages`
    - `rg -n "console.billing.|console.ai." packages/workspace/workspace-console-service-core/src/shared/actions/console.contributor.js`
    - `rg -n "function createBillingSubsystem|function createSocialOutboxWorkerRuntimeService|throwEnabledSubsystemStartupPreflightError" apps/jskit-value-app/server/runtime/services.js`
- Run baseline focused tests:
  - `npm run -w apps/jskit-value-app test -- tests/moduleContracts.test.js tests/realtimeActionContributorPublish.test.js tests/consoleErrorsService.test.js tests/consoleServiceBillingEvents.test.js tests/socialOutboxWorkerRuntime.test.js`
  - `npm run -w apps/jskit-value-app test:client -- tests/client/frameworkComposition.vitest.js tests/client/api.vitest.js`

Commit:

- `chore(tidying): stage 0 baseline snapshot and verification`

---

### Stage 1 - Add domain-owned client API factories

Goal:

- Introduce new domain API factory files without changing app wiring yet.

Work:

- Add new client API files:
  - `packages/auth/access-core/src/shared/client/authApi.js`
  - `packages/workspace/workspace-service-core/src/shared/client/workspaceApi.js`
  - `packages/workspace/workspace-console-service-core/src/shared/client/consoleApi.js`
  - `packages/billing/billing-service-core/src/shared/client/workspaceBillingApi.js`
  - `packages/billing/billing-service-core/src/shared/client/consoleBillingApi.js`
  - `packages/billing/billing-service-core/src/shared/client/idempotencyHeaders.js`
  - `packages/observability/observability-core/src/shared/client/consoleErrorsApi.js`
  - `packages/ai-agent/assistant-client-runtime/src/shared/workspaceTranscriptsApi.js`
  - `packages/ai-agent/assistant-client-runtime/src/shared/consoleTranscriptsApi.js`
- Update package export maps and `src/shared/index.js` where appropriate.
- Add tests for each new API file under each package test folder.

Validation:

- `npm run -w packages/auth/access-core test`
- `npm run -w packages/workspace/workspace-service-core test`
- `npm run -w packages/workspace/workspace-console-service-core test`
- `npm run -w packages/billing/billing-service-core test`
- `npm run -w packages/observability/observability-core test`
- `npm run -w packages/ai-agent/assistant-client-runtime test`

Commit:

- `feat(tidying): stage 1 add domain-owned client API factories`

---

### Stage 2 - Rewire app client registry to new owners

Goal:

- Switch `jskit-value-app` to new API ownership.

Work:

- Add app-owned APIs:
  - `apps/jskit-value-app/src/modules/settings/api.js`
  - `apps/jskit-value-app/src/modules/alerts/api.js`
  - `apps/jskit-value-app/src/modules/history/api.js`
- Update `apps/jskit-value-app/src/framework/moduleRegistry.base.js`:
  - remove import from `@jskit-ai/web-runtime-core/apiClients`
  - import new domain API factories
  - compose merged API objects for `workspace` and `console` keys
  - keep API keys and method names stable for callers
- Update any app imports that reference removed paths.

Validation:

- `npm run -w apps/jskit-value-app test -- tests/moduleContracts.test.js`
- `npm run -w apps/jskit-value-app test:client -- tests/client/frameworkComposition.vitest.js tests/client/api.vitest.js`

Commit:

- `refactor(tidying): stage 2 app registry uses domain-owned APIs`

---

### Stage 3 - Contract tests and references update

Goal:

- Align tests/contracts with new import locations.

Work:

- Update `apps/jskit-value-app/tests/moduleContracts.test.js` client API module list to new import paths.
- Update any docs/comments that still point to `web-runtime-core/apiClients`.

Validation:

- `npm run -w apps/jskit-value-app test -- tests/moduleContracts.test.js tests/framework/serverFrameworkRuntimeParity.test.js`

Commit:

- `test(tidying): stage 3 update client API contract paths`

---

### Stage 4 - Remove `web-runtime-core` API bucket

Goal:

- Enforce runtime-only contract for `web-runtime-core`.

Work:

- Remove:
  - `packages/web/web-runtime-core/src/shared/apiClients/*`
- Remove exports:
  - `packages/web/web-runtime-core/src/shared/index.js`
  - `packages/web/web-runtime-core/package.json` (`./apiClients*`)
- Update README to remove API-wrapper references and assert runtime-only ownership.
- Add guardrail test:
  - fails if `packages/web/web-runtime-core/src/shared/apiClients` exists
  - fails if any import of `@jskit-ai/web-runtime-core/apiClients` exists outside migration docs

Validation:

- `npm run -w packages/web/web-runtime-core test`
- `npm run -w apps/jskit-value-app test -- tests/moduleContracts.test.js`
- `npm run lint:architecture:client`

Commit:

- `refactor(tidying): stage 4 remove web-runtime-core api bucket`

---

### Stage 5 - Move console errors service to observability-core

Goal:

- Move console errors domain to observability package.

Work:

- Move service implementation:
  - from `packages/workspace/workspace-console-service-core/src/shared/services/errors.service.js`
  - to `packages/observability/observability-core/src/shared/consoleErrors.service.js`
- Export in observability package:
  - `@jskit-ai/observability-core/services/consoleErrors`
- Update app imports:
  - `apps/jskit-value-app/server/runtime/services.js`
  - `apps/jskit-value-app/tests/consoleErrorsService.test.js`
- Temporary compatibility shim in workspace package (until Stage 12):
  - old path re-exports observability implementation.

Validation:

- `npm run -w packages/observability/observability-core test`
- `npm run -w apps/jskit-value-app test -- tests/consoleErrorsService.test.js tests/realtimeActionContributorPublish.test.js`

Commit:

- `refactor(tidying): stage 5 move console errors service to observability-core`

---

### Stage 6 - Move console billing service family to billing-service-core

Goal:

- Move console billing admin domain out of workspace-console-service-core.

Work:

- Move files:
  - `consoleBilling.service.js`
  - `billingSettings.service.js`
  - `billingCatalog.service.js`
  - `billingCatalogProviderPricing.service.js`
  from workspace-console-service-core to billing-service-core.
- Export new billing subpaths:
  - `@jskit-ai/billing-service-core/services/consoleBilling`
  - `@jskit-ai/billing-service-core/services/billingSettings`
  - `@jskit-ai/billing-service-core/services/billingCatalog`
  - `@jskit-ai/billing-service-core/services/billingCatalogProviderPricing`
- Temporary compatibility shims at old workspace paths (remove Stage 12).
- Update dependency maps (`package.json` and descriptors) for both packages.

Validation:

- `npm run -w packages/billing/billing-service-core test`
- `npm run -w packages/workspace/workspace-console-service-core test`
- `npm run -w apps/jskit-value-app test -- tests/consoleServiceBillingEvents.test.js tests/consoleBillingPurchaseRoutes.test.js tests/consoleBillingEntitlementRoutes.test.js tests/consoleBillingAssignmentSubscriptionRoutes.test.js`

Commit:

- `refactor(tidying): stage 6 move console billing services to billing-service-core`

---

### Stage 7 - Slim workspace console service to core-only responsibilities

Goal:

- `createConsoleService` becomes core console service + DI composition.

Work:

- Refactor `packages/workspace/workspace-console-service-core/src/shared/services/console.service.js`:
  - remove direct billing/error service construction
  - accept injected dependencies for moved domains
  - keep assistant settings + core console methods
- Update app runtime wiring in `apps/jskit-value-app/server/runtime/services.js`:
  - build `consoleBillingService` from billing package
  - pass it into `createConsoleService`
- Keep response/action contracts unchanged.

Validation:

- `npm run -w apps/jskit-value-app test -- tests/consoleServiceBillingEvents.test.js tests/consoleRootSecurity.test.js tests/consoleInvitesAlerts.test.js`

Commit:

- `refactor(tidying): stage 7 make workspace console service core-only`

---

### Stage 8 - Split `console.contributor` by domain + runtime helper extraction

Goal:

- Remove mixed policy/config/action logic from one contributor file.

Work:

- Add shared helper:
  - `packages/runtime/action-runtime-core/src/shared/realtimePublish.js`
  - export as `@jskit-ai/action-runtime-core/realtimePublish`
- Add billing console contributor:
  - `packages/billing/billing-service-core/src/shared/actions/consoleBilling.contributor.js`
- Add assistant transcript console contributor:
  - `packages/ai-agent/assistant-transcripts-core/src/shared/actions/consoleTranscripts.contributor.js`
- Reduce workspace contributor to core:
  - `packages/workspace/workspace-console-service-core/src/shared/actions/consoleCore.contributor.js`
- Keep existing `createConsoleActionContributor` as core-only alias in workspace package.
- Update app contributor assembly:
  - `apps/jskit-value-app/server/framework/actionContributorFragments.js`
  - register new billing and transcript contributors explicitly.

Validation:

- `npm run -w packages/runtime/action-runtime-core test`
- `npm run -w apps/jskit-value-app test -- tests/realtimeActionContributorPublish.test.js tests/actionRegistry.test.js tests/framework/serverFrameworkActionsAndRealtime.test.js`

Commit:

- `refactor(tidying): stage 8 split console contributor by domain`

---

### Stage 9 - Move startup preflight and auth env resolvers to runtime-env-core

Goal:

- Remove startup policy logic from app composition root.

Work:

- Add `packages/runtime/runtime-env-core/src/shared/startupPreflight.js` with:
  - `hasNonEmptyEnvValue`
  - `resolveAuthProviderId`
  - `resolveSupabaseAuthUrl`
  - `resolveAuthJwtAudience`
  - `assertEnabledSubsystemStartupPreflight`
- Export new subpath in runtime-env-core.
- Update app runtime service wiring to consume these helpers.

Validation:

- `npm run -w packages/runtime/runtime-env-core test`
- `npm run -w apps/jskit-value-app test -- tests/authService.test.js tests/billingRuntimeBootstrap.test.js tests/framework/serverFrameworkRuntimeParity.test.js`

Commit:

- `refactor(tidying): stage 9 move startup preflight helpers to runtime-env-core`

---

### Stage 10 - Move social outbox worker runtime helper to social-core

Goal:

- Remove social worker implementation logic from app runtime composition file.

Work:

- Add `packages/social/social-core/src/shared/outboxWorkerRuntime.service.js`
  - move `createSocialOutboxWorkerRuntimeService`
  - include `toMs` helper internal to package file
- Export:
  - `@jskit-ai/social-core/outboxWorkerRuntimeService`
- Update app services wiring to call package helper.
- Update test imports:
  - `apps/jskit-value-app/tests/socialOutboxWorkerRuntime.test.js` should import from package helper (not app `__testables`).

Validation:

- `npm run -w packages/social/social-core test`
- `npm run -w apps/jskit-value-app test -- tests/socialOutboxWorkerRuntime.test.js tests/workerRuntime.test.js`

Commit:

- `refactor(tidying): stage 10 move social outbox worker runtime helper to social-core`

---

### Stage 11 - Move billing subsystem factory out of app runtime

Goal:

- Remove `createBillingDisabledServices` and `createBillingSubsystem` implementation from app file.

Work:

- Add `packages/billing/billing-worker-core/src/shared/runtimeSubsystem.factory.js`:
  - `createBillingDisabledServices`
  - `createBillingSubsystem`
  - `BILLING_SUBSYSTEM_EXPORT_IDS`
- Implementation composes:
  - billing core services from `@jskit-ai/billing-service-core`
  - billing worker services from local worker-core services
  - same output object shape as current app implementation
- Export new subpath:
  - `@jskit-ai/billing-worker-core/runtimeSubsystemFactory`
- Update app runtime:
  - remove local implementations
  - import new factory/constants from billing-worker-core
  - keep service definition IDs unchanged

Validation:

- `npm run -w packages/billing/billing-worker-core test`
- `npm run -w apps/jskit-value-app test -- tests/billingRuntimeBootstrap.test.js tests/billingService.test.js tests/billingOutboxWorkerService.test.js tests/billingRemediationWorkerService.test.js tests/billingReconciliationService.test.js tests/billingWebhookService.test.js`

Commit:

- `refactor(tidying): stage 11 move billing subsystem factory to billing-worker-core`

---

### Stage 12 - Remove compatibility shims, tighten guardrails, full verification

Goal:

- Finish migration and lock against regression.

Work:

- Remove temporary compatibility re-exports introduced in stages 5/6.
- Remove moved exports from workspace-console-service-core package map and index.
- Update package READMEs and descriptors:
  - web-runtime-core runtime-only
  - workspace-console-service-core core-only
  - billing-service-core includes console billing ownership
  - observability-core includes console errors ownership
- Add/extend architecture guard tests:
  - no `web-runtime-core/apiClients` exports/imports
  - no billing/errors services under workspace-console-service-core
  - no `console.billing.` action IDs inside workspace console core contributor
  - no moved helper function definitions in app `server/runtime/services.js`

Full verification commands:

- `npm run framework:stage1-checks`
- `npm run lint:architecture:client`
- `npm run test:architecture:client`
- `npm run test:architecture:shared-ui`
- `npm run -w apps/jskit-value-app lint`
- `npm run -w apps/jskit-value-app test`
- `npm run -w apps/jskit-value-app test:client`
- `npm run -w apps/jskit-value-app docs:api-contracts:check`

Commit:

- `chore(tidying): stage 12 finalize boundaries and remove compatibility layers`

---

## 5) Detailed File Operation Catalog (Definitive)

Use this as the canonical add/move/delete list.

### Add (new files)

- `packages/auth/access-core/src/shared/client/authApi.js`
- `packages/workspace/workspace-service-core/src/shared/client/workspaceApi.js`
- `packages/workspace/workspace-console-service-core/src/shared/client/consoleApi.js`
- `packages/billing/billing-service-core/src/shared/client/workspaceBillingApi.js`
- `packages/billing/billing-service-core/src/shared/client/consoleBillingApi.js`
- `packages/billing/billing-service-core/src/shared/client/idempotencyHeaders.js`
- `packages/observability/observability-core/src/shared/client/consoleErrorsApi.js`
- `packages/ai-agent/assistant-client-runtime/src/shared/workspaceTranscriptsApi.js`
- `packages/ai-agent/assistant-client-runtime/src/shared/consoleTranscriptsApi.js`
- `packages/ai-agent/assistant-transcripts-core/src/shared/actions/consoleTranscripts.contributor.js`
- `packages/billing/billing-service-core/src/shared/actions/consoleBilling.contributor.js`
- `packages/workspace/workspace-console-service-core/src/shared/actions/consoleCore.contributor.js`
- `packages/runtime/action-runtime-core/src/shared/realtimePublish.js`
- `packages/runtime/runtime-env-core/src/shared/startupPreflight.js`
- `packages/social/social-core/src/shared/outboxWorkerRuntime.service.js`
- `packages/billing/billing-worker-core/src/shared/runtimeSubsystem.factory.js`
- `apps/jskit-value-app/src/modules/settings/api.js`
- `apps/jskit-value-app/src/modules/alerts/api.js`
- `apps/jskit-value-app/src/modules/history/api.js`

### Move

- `packages/workspace/workspace-console-service-core/src/shared/services/errors.service.js`
  -> `packages/observability/observability-core/src/shared/consoleErrors.service.js`

- `packages/workspace/workspace-console-service-core/src/shared/services/consoleBilling.service.js`
  -> `packages/billing/billing-service-core/src/shared/consoleBilling.service.js`

- `packages/workspace/workspace-console-service-core/src/shared/services/billingSettings.service.js`
  -> `packages/billing/billing-service-core/src/shared/billingSettings.service.js`

- `packages/workspace/workspace-console-service-core/src/shared/services/billingCatalog.service.js`
  -> `packages/billing/billing-service-core/src/shared/billingCatalog.service.js`

- `packages/workspace/workspace-console-service-core/src/shared/services/billingCatalogProviderPricing.service.js`
  -> `packages/billing/billing-service-core/src/shared/billingCatalogProviderPricing.service.js`

### Delete

- `packages/web/web-runtime-core/src/shared/apiClients/` (entire folder)
- compatibility shims added in stages 5/6 (stage 12)

---

## 6) Regression Guardrails to Add

Add explicit guard tests so this cannot regress quietly.

Required assertions:

1. No API bucket resurrection:
   - `packages/web/web-runtime-core/package.json` must not export `./apiClients` or children.
   - `packages/web/web-runtime-core/src/shared/apiClients` must not exist.
2. Workspace console package scope:
   - must not export `services/errors`
   - must not export billing service family
3. Contributor scope:
   - workspace console core contributor must not contain `console.billing.`
   - workspace console core contributor must not contain `console.ai.transcripts.`
4. App composition-root thinness:
   - `apps/jskit-value-app/server/runtime/services.js` must not define:
     - `createBillingDisabledServices`
     - `createBillingSubsystem`
     - `createSocialOutboxWorkerRuntimeService`
     - `throwEnabledSubsystemStartupPreflightError`

Guardrails can be placed in:

- `tests/architecture/client-architecture.guardrails.test.mjs` (cross-repo imports/exports)
- `apps/jskit-value-app/tests/guardrailsOwnership.test.js` (app ownership boundaries)

---

## 7) Compatibility and Deletion Policy During Migration

Stages 5 and 6 introduce temporary compatibility shims only to keep incremental commits green.

Rules:

- Shim lifetime is bounded to this runbook.
- All shims are removed in Stage 12.
- Any shim must include a short TODO comment with `REMOVE_STAGE_12`.

No indefinite compatibility surface is allowed.

---

## 8) Risks and Mitigations

### Risk 1: UI breakage due API method mismatch

Mitigation:

- Keep method names identical inside each API key namespace.
- Add API factory unit tests for exact method names.
- Run `tests/client/api.vitest.js` and `tests/client/frameworkComposition.vitest.js` each relevant stage.

### Risk 2: Action ID drift from contributor split

Mitigation:

- Preserve all existing action IDs and versions.
- Add assert test that previous ID set equals post-split ID set.
- Run `tests/actionRegistry.test.js` and `tests/realtimeActionContributorPublish.test.js`.

### Risk 3: Billing behavior regression from service move

Mitigation:

- Move files first with minimal edits.
- Keep behavior tests on each billing stage.
- Delay cleanup/refactor of moved files until tests pass.

### Risk 4: Hidden package dependency drift

Mitigation:

- Update each `package.json` and `package.descriptor.mjs` in same stage as ownership change.
- Run `npm run framework:stage1-checks` at Stage 12.

---

## 9) Final Done Definition

This effort is done only when all are true:

1. `@jskit-ai/web-runtime-core` has zero domain API factory exports/files.
2. `@jskit-ai/workspace-console-service-core` exports only core console services/actions.
3. Billing console services live in `@jskit-ai/billing-service-core`.
4. Console errors service lives in `@jskit-ai/observability-core`.
5. Transcript console contributor lives in assistant domain package.
6. App `server/runtime/services.js` is wiring-only (no large domain helper bodies).
7. All Stage 12 verification commands pass.
8. No temporary compatibility shim remains.

---

## 10) Fresh Session Execution Prompt (copy/paste)

Execute `THE_GREAT_TIDYING_UP.md` exactly, sequentially, stage-by-stage.

- Start from Stage 0.
- Commit after every stage.
- Do not prompt between stages unless truly blocked by an ambiguity.
- Use `apply_patch` for file patches.
- Preserve behavior/contracts while moving ownership.
- Run each stage validation commands before committing.
