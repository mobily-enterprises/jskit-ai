# @jskit-ai/workspace-console-service-core

Service-layer primitives for console access, member management, invites, error explorer, and billing console flows.

## What this package is for

Use this package when building an internal/admin console backend that needs:

- access checks for console roles and permissions
- member and invite management flows
- browser/server error ingestion + explorer endpoints
- billing catalog/settings/event explorer operations

This package sits between repositories (data layer) and HTTP routes (transport layer).

## Key terms (plain language)

- `service layer`: business logic that coordinates repositories and validation.
- `permission`: named capability, for example reading server error logs.
- `catalog`: manageable list of billing plans/products.
- `idempotency`: repeating the same request does not create duplicate effects.

## Exports and import guidance

Use subpath imports for clarity, especially where names overlap.

- `@jskit-ai/workspace-console-service-core/services/console`
- `@jskit-ai/workspace-console-service-core/services/errors`
- `@jskit-ai/workspace-console-service-core/services/consoleAccess`
- `@jskit-ai/workspace-console-service-core/services/consoleMembers`
- `@jskit-ai/workspace-console-service-core/services/consoleInvites`
- `@jskit-ai/workspace-console-service-core/services/consoleBilling`
- `@jskit-ai/workspace-console-service-core/services/billingSettings`
- `@jskit-ai/workspace-console-service-core/services/billingCatalog`
- `@jskit-ai/workspace-console-service-core/services/billingCatalogProviderPricing`
- `@jskit-ai/workspace-console-service-core/mappers/consoleMappers`
- `@jskit-ai/workspace-console-service-core/policies/invitePolicy`

## Function reference

### `mappers/consoleMappers`

- `mapMembershipSummary(membership)`
  - Maps role/status for request context payloads.
  - Example: bootstrap endpoint sends concise membership info.
- `mapMember(member)`
  - Maps member row to API shape (`userId`, `email`, `roleId`, `isConsole`).
  - Example: members table in console UI.
- `mapInvite(invite)`
  - Maps invite row for list responses.
  - Example: pending invites page.
- `mapPendingInvite(invite)`
  - Same as `mapInvite` plus encoded `token`.
  - Example: signed-in user sees invite action link.

### `policies/invitePolicy`

- `DEFAULT_INVITE_TTL_HOURS`
  - Invite lifetime default (72h).
- `resolveInviteExpiresAt(now?)`
  - Computes invite expiration timestamp.
  - Example: invite created now expires in 3 days.

### `services/consoleAccess`

- `createConsoleAccessService(deps)` returns:
  - `ensureRootMutationAllowed(actorUser, targetUserId)`
    - prevents non-root user from modifying root identity.
  - `ensureInitialConsoleMember(userId)`
    - bootstraps first active console user when none exists.
  - `resolveRequestContext({ user })`
    - resolves membership, permissions, pending invites, access flag.
  - `requireConsoleAccess(user)`
    - throws forbidden if no active console membership.
  - `requirePermission(user, permission)`
    - throws forbidden if missing specific permission.

Practical example:

- every console endpoint starts by calling `requirePermission(...)`.

### `services/consoleMembers`

- `createConsoleMembersService(deps)` returns:
  - `listMembers(user)`
  - `updateMemberRole(user, payload)`

Practical example:

- super-user changes another operator from `moderator` to `devop`.

### `services/consoleInvites`

- `createConsoleInvitesService(deps)` returns:
  - `listPendingInvitesForUser(user)`
  - `listInvites(user)`
  - `createInvite(user, payload)`
  - `revokeInvite(user, inviteId)`
  - `respondToPendingInviteByToken({ user, inviteToken, decision })`

Practical example:

- invited user accepts invite token, membership is activated in one transaction.

### `services/errors`

Constants:

- `BROWSER_ERRORS_READ_PERMISSION`
- `SERVER_ERRORS_READ_PERMISSION`
- `SERVER_SIMULATION_KINDS`

Helper functions:

- `normalizePagination(input, options)`
  - shared pagination normalization.
  - Example: enforce max page size for error explorer.
- `normalizeErrorEntryId(value)`
  - validates positive integer IDs.
- `normalizeBrowserPayload(payload, user)`
  - normalizes browser error payload for storage.
- `normalizeServerPayload(payload)`
  - normalizes server error payload for storage.
- `normalizeSimulationKind(value)`
  - validates simulation kind.

Factory:

- `createService(deps)` returns:
  - `listBrowserErrors(user, pagination)`
  - `getBrowserError(user, errorId)`
  - `listServerErrors(user, pagination)`
  - `getServerError(user, errorId)`
  - `recordBrowserError({ payload, user })`
  - `recordServerError(payload)`
  - `simulateServerError({ user, payload })`

Practical example:

- ops user opens error explorer and pages through server exceptions.

### `services/billingSettings`

Constants:

- `PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW`
- `PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD`

Functions:

- `normalizePaidPlanChangePaymentMethodPolicy(value)`
  - validates policy value.
  - Example: reject typo like `required-immediately`.
- `resolveBillingSettingsFromConsoleSettings(consoleSettings)`
  - reads billing settings from `features.billing`.
- `mapBillingSettingsResponse(consoleSettings)`
  - wraps normalized settings for API response.
- `createBillingSettingsService(deps)` returns:
  - `getBillingSettings(user)`
  - `updateBillingSettings(user, payload)`

Practical example:

- finance admin configures whether paid plan changes require payment method immediately.

### `services/billingCatalog`

Constants:

- `DEFAULT_BILLING_PROVIDER`

Functions:

- `resolveBillingProvider(value)`
  - resolves supported billing provider id.
- `normalizeBillingCatalogPlanCreatePayload(payload, options)`
- `normalizeBillingCatalogPlanUpdatePayload(payload, options)`
- `normalizeBillingCatalogProductCreatePayload(payload, options)`
- `normalizeBillingCatalogProductUpdatePayload(payload, options)`
  - validate and normalize catalog mutation payloads.
  - Example: convert raw admin form payload into strict plan/product patch.
- `mapPlanEntitlementsToTemplates(...)`
- `mapProductEntitlementsToTemplates(...)`
  - convert API entitlement values into repository template rows.
- `mapPlanTemplatesToConsoleEntitlements(...)`
- `mapProductTemplatesToConsoleEntitlements(...)`
  - convert persisted templates back into API-friendly entitlement objects.
- `mapBillingPlanDuplicateError(error)`
- `mapBillingProductDuplicateError(error)`
  - map DB duplicate errors to user-facing validation conflicts.
- `ensureBillingCatalogRepository(repo)`
- `ensureBillingProductCatalogRepository(repo)`
  - enforce required repository capabilities before running operations.
- `buildConsoleBillingPlanCatalog({ billingRepository, activeBillingProvider })`
- `buildConsoleBillingProductCatalog({ billingRepository, activeBillingProvider })`
  - build full catalog responses for console screens.

Practical example:

- admin opens catalog screen and sees normalized plan + product records with entitlements.

### `services/billingCatalogProviderPricing`

- `resolveStripeCatalogPriceSnapshot(...)`
- `resolveStripeCatalogProductPriceSnapshot(...)`
  - build Stripe-specific price snapshots for read/display.
- `resolveCatalogCorePriceForCreate(...)`
- `resolveCatalogCorePriceForUpdate(...)`
- `resolveCatalogProductPriceForCreate(...)`
- `resolveCatalogProductPriceForUpdate(...)`
  - normalize provider price inputs before repository writes.

Practical example:

- when creating a plan from Stripe price id, resolve exact recurring price fields before persisting.

### `services/consoleBilling`

- `createConsoleBillingService(deps)` returns:
  - `getBillingSettings(user)`
  - `updateBillingSettings(user, payload)`
  - `listBillingEvents(user, query)`
  - `listBillingPlans(user)`
  - `listBillingProducts(user)`
  - `createBillingPlan(user, payload)`
  - `createBillingProduct(user, payload)`
  - `listBillingProviderPrices(user, query)`
  - `updateBillingPlan(user, params, payload)`
  - `updateBillingProduct(user, params, payload)`

Practical example:

- billing admin creates a new paid plan with entitlement templates and provider price binding.

### `services/console` (facade)

- `createService(deps)`

Builds one combined console service that wires access, members, invites, assistant settings, and billing.

Returned high-level methods include:

- `ensureInitialConsoleMember`
- `resolveRequestContext`
- `buildBootstrapPayload`
- member actions (`listMembers`, `updateMemberRole`)
- invite actions (`listInvites`, `createInvite`, `revokeInvite`, `respondToPendingInviteByToken`)
- assistant settings (`getAssistantSettings`, `updateAssistantSettings`)
- billing actions (`getBillingSettings`, `updateBillingSettings`, `listBillingEvents`, etc.)

Practical example:

- route handlers import one facade and call methods directly for console API endpoints.

## Practical usage example

```js
import { createService as createConsoleService } from
  "@jskit-ai/workspace-console-service-core/services/console";

const consoleService = createConsoleService({
  consoleMembershipsRepository,
  consoleInvitesRepository,
  consoleRootRepository,
  consoleSettingsRepository,
  userProfilesRepository,
  billingRepository,
  billingProviderAdapter,
  billingEnabled: true,
  billingProvider: "stripe"
});

const bootstrap = await consoleService.buildBootstrapPayload({ user: req.user });
```

## How `jskit-value-app` uses it and why

Real usage:

- `apps/jskit-value-app/server/runtime/services.js`
- `apps/jskit-value-app/tests/consoleErrorsService.test.js`
- `apps/jskit-value-app/tests/consoleServiceBillingEvents.test.js`
- `apps/jskit-value-app/tests/consoleRootSecurity.test.js`

Why:

- separates business logic from transport and DB details
- keeps permission checks and validation consistent for all console endpoints
- shares billing normalization helpers across create/update/list flows

## Non-goals

- no direct SQL (repositories are injected)
- no Fastify route registration
- no UI rendering logic
