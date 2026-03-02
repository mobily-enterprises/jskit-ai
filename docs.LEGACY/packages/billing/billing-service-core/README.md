# @jskit-ai/billing-service-core

Core billing domain services for checkout orchestration, idempotency, subscription projection, entitlement limits, and webhook processing.

## What this package is for

Use this package as the business-logic layer for billing.

It coordinates repository operations, provider adapters, and policy decisions for real billing flows:

- showing plans/products/purchases
- starting checkout safely
- handling plan changes
- computing and consuming feature limits
- processing provider webhooks
- publishing realtime limit-change events

Console billing ownership in this package:

- console billing admin services (`consoleBilling`, `billingSettings`, `billingCatalog`, `billingCatalogProviderPricing`)
- console billing client API (`client/consoleBillingApi`)
- console billing action contributor (`actions/consoleBilling`)

## Key terms (plain language)

- `domain service`: business logic that sits above raw DB calls.
- `idempotency`: duplicate-call safety (same request should not charge twice).
- `projection`: turning webhook events into your local DB state.
- `entitlement`: a limit/allowance a plan grants (for example max projects).
- `deterministic error`: request definitely invalid and should fail.
- `indeterminate outcome`: provider/network uncertainty where retry/recovery is needed.

## Root exports (`@jskit-ai/billing-service-core`)

## Service factory exports

### `createBillingPolicyService(deps)`

Resolves which billable entity the current request is allowed to access.

Returned methods:

- `resolveBillableEntityForReadRequest(requestContext)`
  - Resolves read-scoped billing context.
  - Real example: load billing summary for selected workspace.
- `resolveBillableEntityForWriteRequest(requestContext)`
  - Resolves write-scoped context with stronger permission checks.
  - Real example: only billing admins can request plan change.
- `listAccessibleWorkspacesForUser(user)`
  - Lists workspaces user can bill/read.
  - Real example: workspace selector for billing page.

### `createBillingPricingService(deps)`

Resolves provider prices used by checkout.

Returned methods:

- `resolvePlanCheckoutPrice({ plan, provider })`
  - Converts plan core price to normalized checkout price.
  - Real example: map internal Pro plan to Stripe price ID.
- `resolvePhase1SellablePrice({ planId, provider })`
  - Loads plan by ID and resolves checkout price.
  - Real example: admin-configured plan chosen by code/id.
- `resolveSubscriptionCheckoutPrices({ plan, provider })`
  - Builds full subscription checkout line-item price set.
  - Real example: monthly subscription with one base recurring item.
- `deploymentCurrency`
  - Resolved deployment currency value (property).

### `createBillingIdempotencyService(deps)`

Implements checkout/payment-link idempotency lifecycle.

Returned methods:

- `buildOperationKey(input)`
  - Creates deterministic operation key.
  - Real example: same user+entity+intent maps to same checkout operation.
- `buildProviderIdempotencyKey(operationKey)`
  - Builds provider-specific idempotency key.
  - Real example: pass key to Stripe so duplicate API calls dedupe.
- `claimOrReplay(input)`
  - Claims new idempotency row or replays existing result.
  - Real example: double-click checkout button returns one logical operation.
- `recoverPendingRequest(input)`
  - Attempts recovery for pending uncertain requests.
  - Real example: app crash after provider call but before local finalize.
- `expireStalePendingRequests(input)`
  - Expires old pending requests beyond replay window.
  - Real example: worker cleanup for stuck pending rows.
- `assertProviderRequestHashStable(input)`
  - Ensures replay request matches frozen provider payload hash.
  - Real example: reject unsafe retry with modified checkout params.
- `assertLeaseVersion(input)`
  - Lease-fencing guard for concurrent workers/processes.
- `assertProviderReplayWindowOpen(input)`
  - Ensures replay attempt is still within allowed time window.
- `assertReplayProvenanceCompatible(input)`
  - Verifies provider/sdk/schema provenance compatibility.
- `markSucceeded(input)`
  - Marks idempotency row success and stores response.
- `markFailed(input)`
  - Marks deterministic failure.
- `markExpired(input)`
  - Marks expired indeterminate request.

### `createBillingCheckoutSessionService(deps)`

Manages local checkout-session state machine.

Returned methods:

- `cleanupExpiredBlockingSessions(input)`
  - Cleans up stale blocking sessions.
  - Real example: unblock new checkout when old session expired.
- `getBlockingCheckoutSession(input)`
  - Returns current blocking session if any.
- `upsertBlockingCheckoutSession(input)`
  - Creates/updates blocking session row.
- `markCheckoutSessionCompletedPendingSubscription(input)`
  - Marks checkout complete but waiting for subscription projection.
- `markCheckoutSessionReconciled(input)`
  - Marks checkout fully reconciled.
- `markCheckoutSessionRecoveryVerificationPending(input)`
  - Holds uncertain session for recovery verification window.
- `markCheckoutSessionExpiredOrAbandoned(input)`
  - Moves session to terminal expired/abandoned states.
- `assertCheckoutSessionCorrelation(input)`
  - Verifies session correlation invariants (operation/entity/customer).

### `createBillingCheckoutOrchestratorService(deps)`

Runs end-to-end checkout orchestration with idempotency + provider calls.

Returned methods:

- `startCheckout(input)`
  - Main checkout entrypoint.
  - Real example: user upgrades plan from UI.
- `recoverCheckoutFromPending(input)`
  - Attempts provider-assisted recovery for pending checkout.
- `finalizeRecoveredCheckout(input)`
  - Applies final local state after recovery success.
- `buildFrozenCheckoutSessionParams(input)`
  - Builds canonical frozen provider request payload.
  - Real example: freeze exact request payload for replay safety.

### `createBillingRealtimePublishService(deps)`

Publishes billing limit-change realtime events.

Returned methods:

- `publishWorkspaceBillingLimitsUpdated(input)`
  - Publishes workspace-level limit update event.
  - Real example: frontend receives updated limits after purchase grant.

### `createBillingService(deps)`

Top-level billing service used by API adapters.

Returned methods:

- `ensureBillableEntity(input)`: ensure billable entity exists. Example: first billing action for workspace.
- `seedSignupPromoPlan(input)`: assign signup promo/default plan. Example: new workspace onboarding.
- `listPlans(input)`: list available plans. Example: pricing page.
- `listProducts(input)`: list one-off products. Example: add-on catalog.
- `listPurchases(input)`: list purchase history. Example: billing history tab.
- `getPlanState(input)`: get current plan/subscription state. Example: workspace billing summary.
- `requestPlanChange(input)`: request upgrade/downgrade. Example: schedule downgrade end-of-cycle.
- `cancelPendingPlanChange(input)`: cancel scheduled plan change.
- `processDuePlanChanges(input)`: apply due scheduled changes. Example: worker tick.
- `listPaymentMethods(input)`: list stored payment methods.
- `syncPaymentMethods(input)`: sync payment methods from provider.
- `getLimitations(input)`: get effective capability limits.
- `resolveEffectiveLimitations(input)`: resolve limit set for entity/context.
- `consumeEntitlement(input)`: consume entitlement amount for action.
- `executeWithEntitlementConsumption(input)`: run action with automatic pre-consumption.
- `grantEntitlementsForPurchase(input)`: grant limits from purchase.
- `grantEntitlementsForPlanState(input)`: grant/refresh limits from plan state.
- `refreshDueLimitationsForSubject(input)`: recompute due boundaries for subject.
- `listTimeline(input)`: list billing timeline events.
- `createPortalSession(input)`: create provider customer portal session.
- `createPaymentLink(input)`: create one-off payment link.
- `startCheckout(input)`: delegate to checkout orchestrator.

### `createBillingWebhookService(deps)`

Processes provider webhooks safely and idempotently.

Returned methods:

- `processProviderEvent({ provider, rawBody, signatureHeader })`
  - Verifies, canonicalizes, stores, routes, and projects webhook event.
  - Real example: process `invoice.paid` and grant purchase entitlements.
- `reprocessStoredEvent({ provider, eventPayload })`
  - Replays stored webhook payload.
  - Real example: manual replay of previously failed event.

### `createWebhookProjectionService(deps)`

Composes checkout + subscription projection handlers.

Returned methods:

- `handleCheckoutSessionCompleted(session, ctx)`
  - Projects completed checkout event.
- `handleCheckoutSessionExpired(session, ctx)`
  - Projects expired checkout event.
- `projectSubscription(subscription, ctx)`
  - Projects subscription create/update/cancel event.
- `projectInvoiceAndPayment(invoice, ctx)`
  - Projects invoice/payment events and purchase ledger side effects.

## Canonical JSON/hash utilities

- `toCanonicalJson(value)`
  - Stable JSON serialization (sorted object keys).
  - Real example: hashing provider request payload deterministically.
- `toSha256Hex(value)`
  - SHA-256 hex hash.
  - Real example: store request hash for replay verification.
- `safeParseJson(value, fallback)`
  - Safe JSON parse with fallback.
  - Real example: parse stored JSON text without throwing.

## Constants helper functions

These are exported from `constants`:

- `isBlockingCheckoutStatus(status)`
  - Checks whether checkout status blocks creating another checkout.
- `isCheckoutTerminalStatus(status)`
  - Checks whether checkout state is terminal.
- `canTransitionCheckoutStatus(from, to)`
  - Validates state transition.
- `statusFromFailureCode(failureCode)`
  - Maps failure code to idempotency/session status semantics.
- `resolveProviderRequestSchemaVersion(provider)`
  - Returns schema version used for frozen provider request payloads.
- `resolveProviderSdkName(provider)`
  - Returns canonical provider SDK name.

Practical example:

- checkout session service uses transition helpers to reject invalid status changes.

## Important constant objects

The package also exports non-function constants used by apps and tests:

- provider IDs: `BILLING_PROVIDER_STRIPE`, `BILLING_PROVIDER_PADDLE`, `BILLING_DEFAULT_PROVIDER`
- action and failure enums: `BILLING_ACTIONS`, `BILLING_FAILURE_CODES`
- status enums/sets: `BILLING_IDEMPOTENCY_STATUS`, `BILLING_SUBSCRIPTION_STATUS`, `BILLING_CHECKOUT_SESSION_STATUS`, `CHECKOUT_BLOCKING_STATUS_SET`, `CHECKOUT_TERMINAL_STATUS_SET`, `CHECKOUT_STATUS_TRANSITIONS`, `NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET`, `TERMINAL_SUBSCRIPTION_STATUS_SET`
- runtime and provenance constants: `BILLING_RUNTIME_DEFAULTS`, `BILLING_PROVIDER_REQUEST_SCHEMA_VERSION_BY_PROVIDER`, `BILLING_PROVIDER_SDK_NAME_BY_PROVIDER`, `LOCK_ORDER`

## Subpath exports and functions

The package exposes additional modules via subpaths.

### `./pathPolicy`

- `normalizeBillingPath(value, { fieldName })`: validate relative in-app billing path.
- `normalizeCheckoutPaths(payload)`: normalize `{ successPath, cancelPath }`.
- `normalizePortalPath(payload)`: normalize `{ returnPath }`.

Real example: reject unsafe redirect path and keep checkout return URLs app-relative.

### `./providerOutcomePolicy`

- `isProviderErrorNormalized(error)`
- `isDeterministicProviderRejection(error)`
- `isIndeterminateProviderOutcome(error)`
- `resolveProviderErrorOutcome(input)`
- `resolveProviderOperationFamily(operation)`

And constants:

- `PROVIDER_OUTCOME_ACTIONS`
- `PROVIDER_OPERATION_FAMILIES`

Real example: classify provider timeout as "in progress" instead of terminal failure.

### `./appCapabilityLimits`

- `resolveCapabilityLimitConfig(capability)`
  - Returns entitlement-consumption config for a capability.
  - Real example: `projects.create` maps to consuming `projects.max` by 1.
- `APP_CAPABILITY_LIMIT_CONFIG`
  - static mapping table.

### `./purchaseLedgerProjectionUtils`

- `buildPurchaseDedupeKey(input)`
  - Builds dedupe key from payment/invoice/event identifiers.
  - Real example: duplicate webhook delivery should not create duplicate purchase rows.
- `recordConfirmedPurchaseForInvoicePaid(input)`
  - Writes/updates confirmed purchase ledger row for paid invoice.
  - Real example: `invoice.paid` creates one canonical purchase record.

### `./webhookProjectionUtils`

- `parseUnixEpochSeconds(value)`
- `toSafeMetadata(metadata)`
- `toNullableString(value)`
- `toPositiveInteger(value)`
- `resolveInvoiceSubscriptionId(invoice)`
- `resolveInvoicePrimaryPriceId(invoice)`
- `resolveInvoicePrimaryLineDescription(invoice)`
- `normalizeProviderSubscriptionStatus(value)`
- `isSubscriptionStatusCurrent(status)`
- `sortDuplicateCandidatesForCanonicalSelection(candidates)`
- `isIncomingEventOlder(existingTs, incomingTs, opts)`
- `hasSameTimestampOrderingConflict(existingTs, incomingTs, opts)`
- `mapProviderCheckoutStatusToLocal(providerStatus)`
- `buildCheckoutCorrelationError(message)`
- `buildCheckoutResponseJson(input)`

And constant:

- `CHECKOUT_CORRELATION_ERROR_CODE`

Real example: webhook projection uses these helpers to resolve invoice subscription correlation and event ordering.

### `./webhookCheckoutProjectionService`

`createService(deps)` returns:

- `resolveBillableEntityIdFromCustomerId(...)`
- `lockEntityAggregate(...)`
- `maybeFinalizePendingCheckoutIdempotency(...)`
- `handleCheckoutSessionCompleted(...)`
- `handleCheckoutSessionExpired(...)`

Real example: project checkout events while preserving correlation and lease safety.

### `./webhookSubscriptionProjectionService`

`createService(deps)` returns:

- `projectSubscription(...)`
- `projectInvoiceAndPayment(...)`

Real example: project subscription status changes and paid invoices into local subscription/purchase state.

## How apps use this package (and why)

Typical real app flow:

1. API request hits billing adapter.
2. Adapter calls `createBillingService(...).startCheckout`.
3. Checkout orchestrator freezes request, calls provider, and stores idempotent outcome.
4. Provider webhook later arrives; webhook service verifies and routes event.
5. Projection services update subscriptions/purchases/checkout state.
6. Entitlement grants are recomputed and realtime events are published.

Why apps use it:

- robust billing correctness under retries, concurrency, and webhook re-delivery
- clear separation between domain policy and raw persistence/provider code
