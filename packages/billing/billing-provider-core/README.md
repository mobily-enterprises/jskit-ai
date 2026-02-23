# `@jskit-ai/billing-provider-core`

Shared billing provider contracts and registry helpers for SaaS apps.

If you are new to this topic, read this first:
This package is not a payment gateway SDK. It is the shared "shape and rules" layer that all billing providers must follow.

---

## 1) What This Package Is For

Use this package to standardize how apps integrate billing providers (Stripe, Paddle, future providers) without sharing app-specific billing policy.

What it gives you:

1. A provider adapter contract (what methods a provider adapter must implement).
2. A webhook translator contract (how provider webhook payloads become canonical events).
3. A stable provider error type and category taxonomy.
4. A provider registry helper for selecting provider implementations by provider code.

Real-life value:

1. You can swap provider implementations without rewriting orchestration code.
2. Error handling logic can use one shared category model.
3. Webhook ingestion can rely on one canonical event filter interface.

---

## 2) What This Package Does Not Do

This package intentionally does not include:

1. Product catalog configuration.
2. Pricing and entitlement policy.
3. Checkout orchestration business decisions.
4. Database storage logic.
5. Vendor SDK implementations (Stripe/Paddle HTTP calls).

Why:
Those are app/domain concerns, not shared provider-core concerns.

---

## 3) Install

In app `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/billing-provider-core": "0.1.0"
  }
}
```

Then install from monorepo root:

```bash
npm install
```

---

## 4) Quick Start

```js
import {
  assertProviderAdapter,
  createProviderRegistry,
  createBillingProviderError
} from "@jskit-ai/billing-provider-core";

const stripeAdapter = assertProviderAdapter({
  provider: "stripe",
  async createCheckoutSession() {},
  async createPaymentLink() {},
  async createPrice() {},
  async createBillingPortalSession() {},
  async verifyWebhookEvent() {},
  async retrieveCheckoutSession() {},
  async retrieveSubscription() {},
  async retrieveInvoice() {},
  async expireCheckoutSession() {},
  async cancelSubscription() {},
  async updateSubscriptionPlan() {},
  async listCustomerPaymentMethods() {},
  async listCheckoutSessionsByOperationKey() {},
  async getSdkProvenance() {}
});

const registry = createProviderRegistry({
  providers: [stripeAdapter],
  defaultProvider: "stripe"
});

const providerAdapter = registry.resolveProvider(); // stripe adapter

const error = createBillingProviderError({
  provider: "stripe",
  operation: "checkout_create",
  category: "transient_network",
  message: "Connection timed out."
});
```

---

## 5) Full API Reference

Imports:

```js
import {
  createProviderRegistry,
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  validateProviderAdapter,
  assertProviderAdapter,
  normalizeProviderCode,
  REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES,
  REQUIRED_WEBHOOK_TRANSLATOR_METHODS,
  validateWebhookTranslator,
  assertWebhookTranslator,
  normalizeWebhookProvider,
  shouldProcessCanonicalWebhookEvent,
  PROVIDER_ERROR_CATEGORIES,
  RETRYABLE_PROVIDER_ERROR_CATEGORIES,
  BillingProviderError,
  createBillingProviderError,
  isBillingProviderError,
  normalizeProviderErrorCategory
} from "@jskit-ai/billing-provider-core";
```

### `createProviderRegistry(options?)`

Creates a provider registry service.

What it does:

1. Registers providers by normalized provider code.
2. Resolves providers by code or default provider.
3. Rejects duplicates and unsupported providers with explicit errors.

Methods returned:

1. `registerProvider(providerEntry)`
2. `resolveProvider(provider?)`
3. `hasProvider(provider)`
4. `listProviders()`
5. `getDefaultProvider()`

Practical example:

```js
const registry = createProviderRegistry({
  providers: [stripeAdapter, paddleAdapter],
  defaultProvider: "stripe"
});

const adapter = registry.resolveProvider("paddle");
```

Real-world usage:
An app can keep both Stripe and Paddle adapters registered and route per deployment config.

### `REQUIRED_PROVIDER_ADAPTER_METHODS`

Array of required provider adapter method names.

What it does:
Defines the required adapter surface so app code can rely on stable provider capabilities.

Practical example:

```js
for (const methodName of REQUIRED_PROVIDER_ADAPTER_METHODS) {
  if (typeof stripeSdkService[methodName] !== "function") {
    throw new Error(`stripeSdkService.${methodName} is required.`);
  }
}
```

### `normalizeProviderCode(value)`

Returns lowercase trimmed provider code.

Practical example:

```js
normalizeProviderCode("  StrIPE "); // "stripe"
```

Why:
Provider lookups should not fail due to casing/whitespace drift.

### `validateProviderAdapter(adapter)`

Returns shape validation result:

1. `valid`
2. `provider`
3. `missingFields`
4. `missingMethods`

Practical example:

```js
const validation = validateProviderAdapter(candidateAdapter);
if (!validation.valid) {
  console.error(validation.missingMethods);
}
```

### `assertProviderAdapter(adapter, options?)`

Throws if adapter contract is invalid. Returns adapter if valid.

Practical example:

```js
const adapter = assertProviderAdapter(candidateAdapter, {
  name: "stripeBillingProviderAdapter"
});
```

Why:
Fail fast during bootstrap instead of failing during checkout runtime.

### `REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES`

Set of canonical webhook event types the app supports.

Practical example:

1. `checkout.session.completed`
2. `customer.subscription.updated`
3. `invoice.paid`

Why:
This prevents provider-specific event names from leaking into domain logic.

### `REQUIRED_WEBHOOK_TRANSLATOR_METHODS`

Array of required webhook translator methods:

1. `toCanonicalEvent`
2. `supportsCanonicalEventType`

### `normalizeWebhookProvider(value)`

Normalizes webhook provider code (trim + lowercase).

### `shouldProcessCanonicalWebhookEvent(eventType)`

Returns `true` if the canonical event type is supported.

Practical example:

```js
if (!shouldProcessCanonicalWebhookEvent(event.type)) {
  return { ignored: true };
}
```

### `validateWebhookTranslator(translator)`

Returns validation object for webhook translator shape (same structure as adapter validation).

### `assertWebhookTranslator(translator, options?)`

Throws when translator shape is invalid.

Practical example:

```js
const translator = assertWebhookTranslator(candidateTranslator, {
  name: "stripeBillingWebhookTranslator"
});
```

### `PROVIDER_ERROR_CATEGORIES`

Shared provider error category enum:

1. `invalid_request`
2. `rate_limited`
3. `transient_network`
4. `transient_provider`
5. `auth`
6. `permission`
7. `not_found`
8. `conflict`
9. `unknown`

Why:
App logic can classify provider errors consistently across Stripe/Paddle mappings.

### `RETRYABLE_PROVIDER_ERROR_CATEGORIES`

Set of categories typically safe to retry:

1. `rate_limited`
2. `transient_network`
3. `transient_provider`

### `BillingProviderError`

Canonical error class for provider-layer failures.

Important fields:

1. `provider`
2. `operation`
3. `category`
4. `retryable`
5. `httpStatus`
6. `providerCode`
7. `providerRequestId`
8. `details`

Practical example:

```js
throw new BillingProviderError("Stripe request failed.", {
  provider: "stripe",
  operation: "checkout_create",
  category: PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK,
  httpStatus: 503
});
```

### `createBillingProviderError(payload)`

Factory helper for `BillingProviderError`.

Practical example:

```js
const error = createBillingProviderError({
  provider: "paddle",
  operation: "subscription_retrieve",
  category: PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK,
  message: "Network timeout."
});
```

### `isBillingProviderError(error)`

Type guard for canonical provider errors.

Practical example:

```js
if (isBillingProviderError(error)) {
  if (error.retryable) {
    // mark operation in-progress and retry later
  }
}
```

### `normalizeProviderErrorCategory(value)`

Normalizes/validates category and falls back to `unknown`.

Practical example:

```js
normalizeProviderErrorCategory("TRANSIENT_NETWORK"); // "transient_network"
normalizeProviderErrorCategory("unexpected_category"); // "unknown"
```

---

## 6) How Apps Use This In Real Terms (And Why)

In this repo, app-level files under:
`apps/jskit-value-app/server/modules/billing/providers/shared/`
are thin wrappers over this package.

What this means in practice:

1. App runtime keeps familiar local import paths.
2. Generic provider contracts and registry behavior come from one shared package.
3. Vendor-specific code remains app-local (`stripe/*`, `paddle/*`).

Why this split is important:

1. Shared package stays provider-core only.
2. App keeps domain policy and SDK-specific behaviors.
3. Future apps can reuse the same contract layer immediately.

---

## 7) Compatibility Exports

To ease migration, this package also exports billing-prefixed aliases used by existing app code:

1. `REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS`
2. `normalizeBillingProviderCode`
3. `validateBillingProviderAdapter`
4. `assertBillingProviderAdapter`
5. `REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES`
6. `REQUIRED_BILLING_WEBHOOK_TRANSLATOR_METHODS`
7. `normalizeBillingWebhookProvider`
8. `shouldProcessCanonicalBillingWebhookEvent`
9. `validateBillingWebhookTranslator`
10. `assertBillingWebhookTranslator`
11. `BILLING_PROVIDER_ERROR_CATEGORIES`

These aliases keep app migration low-risk while still moving generic logic to shared package ownership.

---

## 8) Common Mistakes

1. Putting pricing catalog constants in this package.
2. Putting entitlement mapping logic in this package.
3. Mixing provider SDK transport code into shared contract layer.
4. Throwing raw provider SDK errors instead of normalized `BillingProviderError`.
5. Hardcoding app-specific provider routing policy in shared registry defaults.

---

## 9) Troubleshooting

### "Invalid billing provider adapter: missing ..."

Cause:
Adapter is missing one required method.

Fix:
Implement every method in `REQUIRED_PROVIDER_ADAPTER_METHODS`.

### "Unsupported billing provider: ..."

Cause:
Registry has no entry for that provider code.

Fix:
Register the adapter and verify provider code normalization.

### Webhook event is ignored unexpectedly

Cause:
Canonical event type is not in supported set.

Fix:
Check translator output and `shouldProcessCanonicalWebhookEvent(...)`.

### Retry behavior is inconsistent

Cause:
Provider mapping may not classify errors into shared categories.

Fix:
Ensure mappings use `createBillingProviderError(...)` with correct `category`.
