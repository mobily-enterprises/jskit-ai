# Billing Provider Insulation Contract

Last updated: 2026-02-24

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

`packages/billing/billing-provider-core/src/contracts/providerAdapter.js`

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
- `updateSubscriptionPlan`
- `listCustomerPaymentMethods`
- `listCheckoutSessionsByOperationKey`
- `getSdkProvenance`

### Webhook translation contract

`packages/billing/billing-provider-core/src/contracts/webhookTranslator.js`

Required translator methods:

- `toCanonicalEvent`
- `supportsCanonicalEventType`

Canonical event filter is shared and provider-agnostic; provider modules only translate/normalize verified provider events into canonical shape.

### Provider super-module contract

`apps/jskit-value-app/server/modules/billing/lib/providers/index.js`

The super-module constructs and returns:

- provider SDK services (`stripeSdkService`, `paddleSdkService`)
- provider adapters (`stripeBillingProviderAdapter`, `paddleBillingProviderAdapter`)
- adapter registry (`billingProviderRegistryService`)
- resolved runtime adapter (`billingProviderAdapter`)
- webhook translators and translator registry (`billingWebhookTranslationRegistryService`)

## Phase 1: File Structure Move (No Behavior Change)

Provider-specific implementations live under:

- `packages/billing/billing-provider-stripe/src/*`
- `packages/billing/billing-provider-paddle/src/*`
- `packages/billing/billing-provider-core/src/*`
- App-local provider wiring wrappers: `apps/jskit-value-app/server/modules/billing/lib/providers/*`

## Phase 2: Runtime Adoption

Runtime assembly (`apps/jskit-value-app/server/runtime/services.js`) must construct provider wiring via the super-module only.

Core billing services consume:

- `billingProviderAdapter`
- `billingProviderRegistryService` (when provider resolution is required)
- `billingWebhookTranslationRegistryService` (for webhook translation)

Core modules should not instantiate Stripe/Paddle SDK services directly.

## Phase 3: Webhook Insulation

Webhook provider translation/mapping belongs in provider modules:

- `packages/billing/billing-provider-stripe/src/webhookTranslation.service.js`
- `packages/billing/billing-provider-paddle/src/webhookTranslation.service.js`

Core webhook processing (`packages/billing/billing-service-core/src/webhook.service.js`) is responsible for:

- provider signature verification dispatch
- canonical event filtering
- dedupe row lifecycle (`received` -> `processing` -> `processed`/`failed`)
- transactional projection dispatch

Core webhook processing must not contain provider-specific payload translation logic.

## Phase 4: Provider Error Outcome Policy

Provider-specific SDK/API error mapping belongs only in provider modules:

- `packages/billing/billing-provider-stripe/src/errorMapping.js`
- `packages/billing/billing-provider-paddle/src/errorMapping.js`

Core billing must consume only normalized provider errors and resolve behavior through:

- `packages/billing/billing-service-core/src/providerOutcomePolicy.js`

`providerOutcomePolicy` decides deterministic terminal failures vs in-progress outcomes and emits operation-family guardrail codes. Core billing modules must not parse provider SDK literals.

## Phase 5: Boundary Enforcement

Provider-literal leakage in core billing is blocked by guard tests:

- `apps/jskit-value-app/tests/billingProviderBoundaryGuard.test.js`

This test fails if provider SDK class/code literals appear in:

- `packages/billing/billing-service-core/src/service.js`
- `packages/billing/billing-service-core/src/checkoutOrchestrator.service.js`
- `packages/billing/billing-service-core/src/idempotency.service.js`
- `packages/billing/billing-service-core/src/providerOutcomePolicy.js`
