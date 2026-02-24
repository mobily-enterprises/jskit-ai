# @jskit-ai/billing-knex-mysql

MySQL/Knex billing repository implementation for plans, subscriptions, entitlements, idempotency, checkout state, and webhook persistence.

## What this package is for

Use this package when your app needs a concrete database layer for billing.

This package owns SQL-facing data access for:

- billable entities (what you charge, like a workspace)
- plans and products
- subscriptions and customers
- purchases and payment methods
- checkout/idempotency state
- webhook storage and replay support
- worker/reconciliation queue state

It does not own HTTP routes or billing business policy. It is a repository layer.

## Key terms (plain language)

- `billable entity`: the thing that owns a bill (for example a workspace, or sometimes a user).
- `idempotency`: duplicate request safety so one operation is not applied twice.
- `checkout session`: temporary payment flow state at the provider.
- `upsert`: insert new row or update existing matching row.

## Public API

## `createBillingRepository(dbClient)` (also exported as `createRepository`)

Creates the billing repository object.

### Transaction helper

- `transaction(work)`
  - Runs multiple DB operations atomically.
  - Real example: create subscription + plan assignment + idempotency update together.

### Billable entities and context

- `findBillableEntityById(id)`
  - Fetch billable entity by primary ID.
  - Example: resolve current billing owner during request.
- `findBillableEntityByWorkspaceId(workspaceId)`
  - Find entity tied to workspace.
  - Example: workspace settings opens billing tab.
- `findBillableEntityByTypeRef({ entityType, entityRef })`
  - Lookup by typed external reference.
  - Example: map `user:42` to billable entity.
- `ensureBillableEntity(payload)`
  - Ensure entity exists (create if missing).
  - Example: first billing action for a new workspace.
- `ensureBillableEntityByScope(payload)`
  - Scope-aware ensure method.
  - Example: create user-scoped billable entity for solo plans.
- `findWorkspaceContextForBillableEntity(billableEntityId)`
  - Resolve workspace linkage for realtime/events.
  - Example: publish workspace billing-limit update event.

### Entitlement definitions and templates

- `listEntitlementDefinitions()`
  - List all entitlement definitions.
  - Example: admin UI for limit catalog.
- `findEntitlementDefinitionByCode(code)`
  - Fetch definition by code.
  - Example: resolve `projects.max` during consumption.
- `findEntitlementDefinitionById(id)`
  - Fetch definition by ID.
  - Example: internal relation resolution.
- `listPlanEntitlementTemplates(planId)`
  - List entitlement template rows for plan.
  - Example: know what limits Pro plan grants.
- `replacePlanEntitlementTemplates(planId, templates)`
  - Replace plan templates in one operation.
  - Example: update plan limits at release time.
- `listProductEntitlementTemplates(productId)`
  - List templates for one-off product grants.
  - Example: add-on package grants extra quota.
- `replaceProductEntitlementTemplates(productId, templates)`
  - Replace product templates.
  - Example: modify add-on benefit amounts.

### Entitlement grants, consumption, balances

- `insertEntitlementGrant(payload)`
  - Record grant event.
  - Example: subscription renewal grants new monthly quota.
- `insertEntitlementConsumption(payload)`
  - Record usage consumption event.
  - Example: user creates project and consumes capacity.
- `findEntitlementBalance(subjectId, definitionId)`
  - Read one balance row.
  - Example: check remaining API calls.
- `upsertEntitlementBalance(payload)`
  - Insert/update balance snapshot.
  - Example: recompute after grant + consumption.
- `listEntitlementBalancesForSubject(subjectId)`
  - List all balances for entity.
  - Example: show "current limits" panel.
- `listNextGrantBoundariesForSubjectDefinition(payload)`
  - Get upcoming grant boundary timestamps.
  - Example: find next monthly reset time.
- `sumEntitlementGrantAmount(filters)`
  - Aggregate granted amount.
  - Example: reporting total granted credits.
- `sumEntitlementConsumptionAmount(filters)`
  - Aggregate consumed amount.
  - Example: monthly usage report.
- `recomputeEntitlementBalance(payload)`
  - Recompute balance deterministically.
  - Example: repair drift after incident.
- `leaseDueEntitlementBalances(payload)`
  - Lease balances due for boundary recompute.
  - Example: worker picks balances for monthly rollover.

### Plans and products

- `listPlans(filters)`
  - List billing plans.
  - Example: pricing page plan cards.
- `findPlanByCode(code)`
  - Find plan by stable code.
  - Example: `pro_monthly` lookup.
- `findPlanById(id)`
  - Find plan by ID.
  - Example: subscription join reads plan metadata.
- `findPlanByCheckoutProviderPriceId({ provider, providerPriceId })`
  - Map provider price to internal plan.
  - Example: webhook invoice with Stripe price ID.
- `listProducts(filters)`
  - List one-off products.
  - Example: add-on catalog in billing page.
- `findProductByCode(code)`
  - Find product by code.
  - Example: purchase flow for `extra_credits_pack`.
- `findProductById(id)`
  - Find product by ID.
  - Example: admin edit product screen.
- `createProduct(payload)`
  - Insert product.
  - Example: launch new one-time support package.
- `updateProductById(id, patch)`
  - Update product.
  - Example: disable retired product.
- `createPlan(payload)`
  - Insert plan.
  - Example: create Enterprise tier.
- `updatePlanById(id, patch)`
  - Update plan fields.
  - Example: rename plan display label.

### Plan assignments and plan-change history

- `findPlanAssignmentById(id)`
  - Load one plan assignment.
  - Example: inspect scheduled change.
- `findCurrentPlanAssignmentForEntity(entityId)`
  - Read current assignment.
  - Example: determine active plan.
- `findUpcomingPlanAssignmentForEntity(entityId)`
  - Read pending future assignment.
  - Example: scheduled downgrade at period end.
- `listPlanAssignmentsForEntity(entityId)`
  - List assignments history.
  - Example: support audit timeline.
- `updatePlanAssignmentById(id, patch)`
  - Update assignment fields.
  - Example: mark assignment as applied.
- `clearCurrentPlanAssignmentsForEntity(entityId)`
  - Clear current flags.
  - Example: enforce one-current-assignment invariant.
- `cancelUpcomingPlanAssignmentForEntity(entityId)`
  - Cancel pending plan change.
  - Example: user cancels scheduled downgrade.
- `replaceUpcomingPlanAssignmentForEntity(entityId, payload)`
  - Replace pending assignment.
  - Example: user changes selected target plan.
- `listDueUpcomingPlanAssignments({ now, limit })`
  - List assignments that should activate now.
  - Example: worker processes due plan changes.
- `insertPlanAssignment(payload)`
  - Create assignment row.
  - Example: assign starter plan on signup.
- `insertPlanChangeHistory(payload)`
  - Record immutable plan-change event.
  - Example: audit who changed plan and why.
- `listPlanChangeHistoryForEntity(entityId)`
  - List change events.
  - Example: show billing timeline entries.

### Customers and subscriptions

- `findCustomerById(id)`
- `findCustomerByEntityProvider({ billableEntityId, provider })`
- `findCustomerByProviderCustomerId({ provider, providerCustomerId })`
- `upsertCustomer(payload)`
  - These methods maintain provider customer mapping.
  - Example: webhook resolves provider customer to internal entity.
- `findPlanAssignmentProviderDetailsByAssignmentId(assignmentId)`
- `upsertPlanAssignmentProviderDetails(payload)`
  - Store provider metadata tied to assignments.
  - Example: keep provider subscription IDs for assignment.
- `findPlanAssignmentByProviderSubscriptionId(payload)`
  - Map provider subscription to assignment.
  - Example: subscription webhook correlation.
- `findCurrentSubscriptionForEntity(entityId)`
  - Read active subscription.
  - Example: gate features by current status.
- `lockSubscriptionsForEntity(entityId, { forUpdate })`
  - Row-lock helper.
  - Example: prevent race while projecting webhook.
- `findSubscriptionByProviderSubscriptionId(payload)`
  - Lookup by provider subscription ID.
  - Example: process `customer.subscription.updated`.
- `listCurrentSubscriptions(filters)`
  - List current subscriptions.
  - Example: reconciliation sweep.
- `clearCurrentSubscriptionFlagsForEntity(entityId)`
  - Reset `isCurrent` flags.
  - Example: canonical subscription selection.
- `upsertSubscription(payload)`
  - Insert/update subscription row.
  - Example: webhook projection updates status and period end.

### Purchases, payment methods, activity

- `upsertBillingPurchase(payload)`
  - Insert/update confirmed purchase ledger entry.
  - Example: `invoice.paid` creates purchase record.
- `listBillingPurchasesForEntity(entityId)`
  - List purchases.
  - Example: billing history UI.
- `listPaymentMethodsForEntity(entityId)`
  - List saved payment methods.
  - Example: card management screen.
- `findPaymentMethodByProviderPaymentMethodId(payload)`
  - Find payment method mapping.
  - Example: sync step updates default card.
- `upsertPaymentMethod(payload)`
  - Insert/update method record.
  - Example: provider sync refresh.
- `deactivateMissingPaymentMethods(payload)`
  - Deactivate methods no longer at provider.
  - Example: remove deleted cards from local active list.
- `insertPaymentMethodSyncEvent(payload)`
  - Write sync event.
  - Example: audit sync runs.
- `listPaymentMethodSyncEventsForEntity(entityId)`
  - List sync events.
  - Example: support debugging payment-method drift.
- `listBillingActivityEvents(filters)`
  - List activity timeline records.
  - Example: admin timeline page.

### Idempotency and checkout sessions

- `findIdempotencyByEntityActionClientKey(payload)`
- `findIdempotencyById(id)`
- `findCheckoutIdempotencyByOperationKey(payload)`
- `findPendingCheckoutIdempotencyForEntity(entityId)`
- `listPendingIdempotencyRows(filters)`
- `deleteTerminalIdempotencyOlderThan(cutoff)`
- `insertIdempotency(payload)`
- `updateIdempotencyById(id, patch, options)`
  - Manage idempotency rows for safe retries and replay.
  - Real example: repeated checkout clicks return same result safely.
- `lockCheckoutSessionsForEntity(entityId, options)`
  - Lock checkout rows for race-safe updates.
  - Example: webhook + API race protection.
- `listCheckoutSessionsForEntity(entityId)`
- `findCheckoutSessionByProviderOperationKey(payload)`
- `findCheckoutSessionByProviderSessionId(payload)`
- `findCheckoutSessionByProviderSubscriptionId(payload)`
- `updateCheckoutSessionById(id, patch)`
- `upsertCheckoutSessionByOperationKey(payload)`
  - Persist and correlate checkout flow state.
  - Real example: move session from `open` to `completed_reconciled`.

### Webhooks and worker/reconciliation state

- `findWebhookEventByProviderEventId(payload)`
- `insertWebhookEvent(payload)`
- `updateWebhookEventById(id, patch)`
- `listFailedWebhookEvents(filters)`
- `scrubWebhookPayloadsPastRetention(payload)`
  - Store webhook processing state and payload-retention lifecycle.
  - Real example: replay failed webhook and clear old payloads after retention window.
- `enqueueOutboxJob(payload)`
- `leaseNextOutboxJob(payload)`
- `updateOutboxJobByLease(payload)`
  - Outbox queue primitives for worker jobs.
  - Real example: enqueue stale checkout expiration task.
- `upsertSubscriptionRemediation(payload)`
- `leaseNextRemediation(payload)`
- `updateRemediationByLease(payload)`
  - Remediation queue primitives.
  - Real example: enqueue duplicate-subscription cancellation.
- `acquireReconciliationRun(payload)`
- `updateReconciliationRunByLease(payload)`
- `listReconciliationCheckoutSessions(filters)`
  - Reconciliation run tracking and scope queries.
  - Real example: periodic subscription drift repair run.

## How apps use this package (and why)

Typical flow:

1. App boot creates repository with Knex client.
2. Billing service layer calls repository methods for all persistence.
3. Webhook pipeline and workers also use same repository.

Why apps use it:

- one coherent SQL layer for billing domain
- safer concurrency via transaction/lease/locking helpers
- easy testability by mocking repository API
