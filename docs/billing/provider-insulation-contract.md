# Billing Provider Insulation Contract

Last updated: 2026-02-21

This document freezes the provider-insulation contract for billing.

## Invariants (Must Not Change)

- Existing API endpoints and response envelopes.
- Checkout/portal/payment-link idempotency semantics.
- Lock ordering and entity-scoped transactional behavior.
- Webhook dedupe and processing guarantees.
- Existing provider runtime behavior for Stripe and Paddle.

## Phase 0: Interface Freeze

Core billing must depend only on provider-agnostic contracts.

### Provider adapter contract

`server/modules/billing/providers/shared/providerAdapter.contract.js`

Required adapter methods:

- `createCheckoutSession`
- `createPaymentLink`
- `createPrice`
- `createBillingPortalSession`
- `verifyWebhookEvent`
- `retrieveCheckoutSession`
- `retrieveSubscription`
- `retrieveInvoice`
- `expireCheckoutSession`
- `cancelSubscription`
- `listCustomerPaymentMethods`
- `listCheckoutSessionsByOperationKey`
- `getSdkProvenance`

### Webhook translation contract

`server/modules/billing/providers/shared/webhookTranslation.contract.js`

Required translator methods:

- `toCanonicalEvent`
- `supportsCanonicalEventType`

Canonical event filter is shared and provider-agnostic; provider modules only translate/normalize verified provider events into canonical shape.

### Provider super-module contract

`server/modules/billing/providers/index.js`

The super-module constructs and returns:

- provider SDK services (`stripeSdkService`, `paddleSdkService`)
- provider adapters (`stripeBillingProviderAdapter`, `paddleBillingProviderAdapter`)
- adapter registry (`billingProviderRegistryService`)
- resolved runtime adapter (`billingProviderAdapter`)
- webhook translators and translator registry (`billingWebhookTranslationRegistryService`)

## Phase 1: File Structure Move (No Behavior Change)

Provider-specific implementations live under:

- `server/modules/billing/providers/stripe/*`
- `server/modules/billing/providers/paddle/*`
- `server/modules/billing/providers/shared/*`

No compatibility shims remain under `server/modules/billing/*.js`; runtime and tests import provider modules directly.

## Phase 2: Runtime Adoption

Runtime assembly (`server/runtime/services.js`) must construct provider wiring via the super-module only.

Core billing services consume:

- `billingProviderAdapter`
- `billingProviderRegistryService` (when provider resolution is required)
- `billingWebhookTranslationRegistryService` (for webhook translation)

Core modules should not instantiate Stripe/Paddle SDK services directly.

## Phase 3: Webhook Insulation

Webhook provider translation/mapping belongs in provider modules:

- `server/modules/billing/providers/stripe/webhookTranslation.service.js`
- `server/modules/billing/providers/paddle/webhookTranslation.service.js`

Core webhook processing (`server/modules/billing/webhook.service.js`) is responsible for:

- provider signature verification dispatch
- canonical event filtering
- dedupe row lifecycle (`received` -> `processing` -> `processed`/`failed`)
- transactional projection dispatch

Core webhook processing must not contain provider-specific payload translation logic.
