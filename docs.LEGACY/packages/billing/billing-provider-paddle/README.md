# @jskit-ai/billing-provider-paddle

Paddle provider integration for JSKit billing (SDK calls, adapter shape, webhook translation, error normalization).

## What this package is for

Use this package when Paddle is your billing provider.

It covers four concerns:

- provider API calls (`sdk` service)
- adapter contract used by billing core
- webhook event normalization to canonical billing events
- provider-specific error mapping to shared billing error categories

## Key terms (plain language)

- `provider adapter`: an object with required methods expected by billing core.
- `canonical event`: normalized event shape so core billing logic can be provider-agnostic.
- `error normalization`: converting provider-specific errors to shared categories.

## Public API

## `createPaddleSdkService(deps)`

Creates Paddle API integration service.

Returned methods:

- `createCheckoutSession(payload)`
  - Creates a Paddle checkout session/transaction for subscription purchase.
  - Real example: user clicks "Upgrade to Pro" and app needs hosted checkout URL.
- `createPaymentLink(payload)`
  - Creates a one-off payment link.
  - Real example: pay for add-on credits outside full checkout flow.
- `createPrice(payload)`
  - Creates price in Paddle catalog.
  - Real example: admin provisioning a new annual plan price.
- `createBillingPortalSession(payload)`
  - Creates link/session for customer billing portal.
  - Real example: user clicks "Manage subscription".
- `verifyWebhookEvent(payload)`
  - Verifies webhook signature and parses payload.
  - Real example: trust-check incoming `transaction.completed` callback.
- `retrieveCheckoutSession({ sessionId })`
  - Retrieves checkout/transaction details by provider ID.
  - Real example: reconcile pending local session with provider state.
- `retrieveSubscription({ subscriptionId })`
  - Retrieves subscription details.
  - Real example: periodic drift reconciliation.
- `retrieveInvoice({ invoiceId })`
  - Retrieves invoice/transaction details.
  - Real example: fetch invoice metadata after webhook.
- `expireCheckoutSession({ sessionId })`
  - Cancels/exp​ires an open checkout session.
  - Real example: cleanup orphaned checkout sessions.
- `cancelSubscription({ subscriptionId, cancelAtPeriodEnd })`
  - Cancels provider subscription.
  - Real example: immediate cancellation vs end-of-cycle cancellation.
- `updateSubscriptionPlan(...)`
  - Placeholder currently not implemented for Paddle plan updates.
  - Real example: service returns a controlled error if feature requested.
- `listCustomerPaymentMethods({ customerId, limit })`
  - Lists payment methods.
  - Real example: show saved card details in billing settings.
- `listCheckoutSessionsByOperationKey({ operationKey, limit })`
  - Finds checkout sessions correlated by operation key metadata.
  - Real example: idempotency recovery for duplicate requests.
- `getSdkProvenance()`
  - Returns provider/sdk provenance info.
  - Real example: include provider SDK version in audit/debug output.

## `createPaddleBillingProviderAdapterService({ paddleSdkService })`

Wraps the SDK service into the standard billing-provider adapter contract.

Practical use:

- billing core depends on adapter shape, not Paddle internals.
- this function guarantees required methods exist and forwards calls.

## `createPaddleWebhookTranslationService()`

Creates translator from Paddle event payloads to canonical event format.

Returned methods:

- `toCanonicalEvent(providerEvent)`
  - Maps Paddle event shape to shared billing event shape.
  - Real example: convert Paddle subscription update to canonical `customer.subscription.updated`.
- `supportsCanonicalEventType(eventType)`
  - Indicates whether core webhook pipeline should process event type.
  - Real example: ignore unknown or unsupported Paddle event types.

## `mapPaddleProviderError(error, options)`

Maps Paddle/API/network errors into shared billing-provider error categories.

Real example:

- Paddle timeout becomes `TRANSIENT_NETWORK` category so core can treat as "in progress/retryable" instead of deterministic failure.

## How apps use this package (and why)

Typical flow:

1. App creates `paddleSdkService` with secrets/config.
2. App creates `billingProviderAdapter` from that SDK.
3. App creates webhook translation service.
4. Billing core service/webhook service consumes adapter + translator.

Why apps use it:

- provider-specific complexity is isolated
- billing core remains mostly provider-agnostic
