# @jskit-ai/billing-provider-stripe

Stripe provider integration for JSKit billing (SDK calls, adapter contract, webhook translation, error mapping).

## What this package is for

Use this package when Stripe is your billing provider.

It provides:

- Stripe SDK request wrappers
- a standardized provider adapter for billing core
- webhook translator
- error normalization to shared billing categories

## Key terms (plain language)

- `Stripe SDK`: official Stripe Node client.
- `provider adapter`: stable interface billing core calls regardless of provider.
- `idempotency key`: unique key so repeated requests do not create duplicate charges/sessions.

## Public API

## `createStripeSdkService(deps)`

Creates Stripe integration service.

Returned methods:

- `getClient()`
  - Returns initialized Stripe client.
  - Real example: internal helper when advanced Stripe operation is needed.
- `createCheckoutSession(payload)`
  - Creates Stripe checkout session.
  - Real example: start subscription checkout flow.
- `createPaymentLink(payload)`
  - Creates Stripe payment link.
  - Real example: send one-off payment URL.
- `createPrice(payload)`
  - Creates Stripe price object.
  - Real example: new metered add-on price.
- `listPrices(payload)`
  - Lists provider prices.
  - Real example: admin panel verifies price inventory.
- `retrievePrice(payload)`
  - Retrieves one provider price.
  - Real example: validate price ID before plan mapping.
- `createBillingPortalSession(payload)`
  - Creates customer portal URL.
  - Real example: "Manage plan" button.
- `verifyWebhookEvent(payload)`
  - Verifies webhook signature and returns event.
  - Real example: trust `invoice.paid` callback.
- `retrieveCheckoutSession(payload)`
  - Retrieves checkout session by ID.
  - Real example: reconcile pending checkout.
- `retrieveSubscription(payload)`
  - Retrieves subscription.
  - Real example: active-subscription reconciliation job.
- `retrieveInvoice(payload)`
  - Retrieves invoice.
  - Real example: fetch invoice details for event replay.
- `expireCheckoutSession(payload)`
  - Expires open checkout session.
  - Real example: cleanup abandoned sessions.
- `cancelSubscription(payload)`
  - Cancels subscription.
  - Real example: immediate cancellation request.
- `setSubscriptionCancelAtPeriodEnd(payload)`
  - Sets cancel-at-period-end flag.
  - Real example: downgrade effective next renewal.
- `updateSubscriptionPlan(payload)`
  - Changes subscription to another price/plan.
  - Real example: in-place upgrade from Basic to Pro.
- `listCustomerPaymentMethods(payload)`
  - Lists saved payment methods.
  - Real example: billing settings card list.
- `listCheckoutSessionsByOperationKey(payload)`
  - Finds sessions by operation metadata.
  - Real example: idempotency recovery lookup.
- `getSdkProvenance()`
  - Returns provider/sdk/version info.
  - Real example: include SDK provenance in audit logs.

## `createStripeBillingProviderAdapterService({ stripeSdkService })`

Creates provider adapter expected by billing core.

Real example: billing core calls `adapter.createCheckoutSession(...)` without Stripe-specific code.

## `createStripeWebhookTranslationService()`

Creates webhook translator object.

Returned methods:

- `toCanonicalEvent(providerEvent)`
  - Returns canonical event object (Stripe events are already close to canonical shape here).
  - Real example: webhook pipeline receives normalized event object.
- `supportsCanonicalEventType(eventType)`
  - Filters supported event types.
  - Real example: ignore event types not relevant for billing projection.

## `mapStripeProviderError(error, options)`

Maps Stripe errors/network errors to shared provider error categories.

Real example:

- card validation issue -> deterministic invalid request category
- transient Stripe outage -> transient provider category

## How apps use this package (and why)

Typical flow:

1. App configures Stripe secrets and creates SDK service.
2. App wraps SDK with adapter service.
3. Billing core and webhook services consume adapter + translator.

Why apps use it:

- shared Stripe behavior across apps
- consistent error semantics for idempotent billing workflows
