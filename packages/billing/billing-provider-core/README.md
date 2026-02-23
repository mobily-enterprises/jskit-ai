# `@jskit-ai/billing-provider-core`

Shared billing provider contracts, validators, error taxonomy, and provider registry helpers for SaaS apps.

If you are new to billing integrations, this is the most important idea:
This package is not the code that talks to Stripe or Paddle.  
This package defines the common rules and shapes your app uses around those providers.

---

## Table of Contents

1. [What This Package Is For](#1-what-this-package-is-for)
2. [What This Package Is Not For](#2-what-this-package-is-not-for)
3. [Beginner Glossary](#3-beginner-glossary)
4. [Install](#4-install)
5. [Quick Start](#5-quick-start)
6. [Full API Reference (Every Export)](#6-full-api-reference-every-export)
7. [How Apps Use This In Real Terms (And Why)](#7-how-apps-use-this-in-real-terms-and-why)
8. [Real End-to-End Example](#8-real-end-to-end-example)
9. [Common Mistakes](#9-common-mistakes)
10. [Troubleshooting](#10-troubleshooting)

---

## 1) What This Package Is For

Use this package when you want many apps to share the same provider integration boundaries:

1. What methods a provider adapter must implement.
2. What methods a webhook translator must implement.
3. How provider errors are normalized and categorized.
4. How provider implementations are registered and resolved by provider code.

Practical value:

1. Apps can switch provider implementation with less risk.
2. Business code can rely on stable method names and stable error shape.
3. CI catches missing adapter/translator methods at startup instead of during production requests.

---

## 2) What This Package Is Not For

This package intentionally does not include:

1. Product catalog or price list decisions.
2. Entitlement or subscription policy.
3. Checkout orchestration business rules.
4. Database or repository logic.
5. Stripe/Paddle SDK request code.

Reason:
Those concerns are app/domain-specific and should stay in each app.

---

## 3) Beginner Glossary

1. Provider adapter: an object with methods like `createCheckoutSession` and `cancelSubscription` that hides SDK details.
2. Webhook translator: an object that converts provider webhook payloads into your app’s canonical event shape.
3. Canonical event: a provider-neutral event name/shape your app uses internally (for example `invoice.paid`).
4. Registry: a helper that stores providers and resolves one by code like `"stripe"` or `"paddle"`.
5. Error taxonomy: a fixed set of categories (for example `transient_network`) used to drive retry/failure behavior.

---

## 4) Install

In app `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/billing-provider-core": "0.1.0"
  }
}
```

Then run from monorepo root:

```bash
npm install
```

---

## 5) Quick Start

```js
import {
  assertProviderAdapter,
  assertWebhookTranslator,
  createProviderRegistry
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

const stripeTranslator = assertWebhookTranslator({
  provider: "stripe",
  toCanonicalEvent(providerEvent) {
    return providerEvent;
  },
  supportsCanonicalEventType(eventType) {
    return eventType === "invoice.paid";
  }
});

const adapterRegistry = createProviderRegistry({
  providers: [stripeAdapter],
  defaultProvider: "stripe"
});

const translatorRegistry = createProviderRegistry({
  providers: [stripeTranslator],
  defaultProvider: "stripe"
});

const activeAdapter = adapterRegistry.resolveProvider("stripe");
const activeTranslator = translatorRegistry.resolveProvider();
```

---

## 6) Full API Reference (Every Export)

Imports:

```js
import {
  createProviderRegistry,
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  normalizeProviderCode,
  validateProviderAdapter,
  assertProviderAdapter,
  REQUIRED_WEBHOOK_TRANSLATOR_METHODS,
  REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES,
  normalizeWebhookProvider,
  shouldProcessCanonicalWebhookEvent,
  validateWebhookTranslator,
  assertWebhookTranslator,
  PROVIDER_ERROR_CATEGORIES,
  RETRYABLE_PROVIDER_ERROR_CATEGORIES,
  BillingProviderError,
  createBillingProviderError,
  isBillingProviderError,
  normalizeProviderErrorCategory
} from "@jskit-ai/billing-provider-core";
```

### `createProviderRegistry(options?)`

What it does:
Creates a registry service that can store and resolve provider-like objects by normalized provider code.

Why apps use it:
The app can register Stripe and Paddle once, then resolve the right one based on deployment or request context.

Important options:

1. `providers`: initial provider entries.
2. `defaultProvider`: fallback provider code when `resolveProvider()` is called with no argument.
3. `normalizeProvider`: normalization function (default trims/lowercases).
4. `validateProvider`: optional assertion function to enforce shape.
5. `providerRequiredMessage`, `unsupportedProviderMessage`, `duplicateProviderMessage`: custom error texts.

Real-life example:

```js
const registry = createProviderRegistry({
  providers: [stripeAdapter, paddleAdapter],
  defaultProvider: "stripe"
});

const adapter = registry.resolveProvider("paddle");
```

Returned registry methods:

#### `registerProvider(providerEntry)`

What it does:
Validates and registers a provider entry by code.

Real-life example:

```js
registry.registerProvider(newProviderAdapter);
```

#### `resolveProvider(provider?)`

What it does:
Returns a registered provider by code, or default provider if no code is passed.

Real-life example:

```js
const adapter = registry.resolveProvider(); // default provider
```

#### `hasProvider(provider)`

What it does:
Checks if a provider code is registered.

Real-life example:

```js
if (!registry.hasProvider(env.BILLING_PROVIDER)) {
  throw new Error("Unsupported provider in env.");
}
```

#### `listProviders()`

What it does:
Returns all registered provider codes.

Real-life example:

```js
console.info("Configured billing providers:", registry.listProviders());
```

#### `getDefaultProvider()`

What it does:
Returns the current default provider code.

Real-life example:

```js
const defaultProvider = registry.getDefaultProvider();
```

### `REQUIRED_PROVIDER_ADAPTER_METHODS`

What it does:
Defines the mandatory methods for any provider adapter.

Why it matters:
Billing orchestration code can rely on this stable method surface.

Real-life example:

```js
for (const methodName of REQUIRED_PROVIDER_ADAPTER_METHODS) {
  if (typeof stripeSdkService[methodName] !== "function") {
    throw new Error(`stripeSdkService.${methodName} is required.`);
  }
}
```

### `normalizeProviderCode(value)`

What it does:
Trims and lowercases a provider code.

Real-life example:

```js
normalizeProviderCode("  StrIPE "); // "stripe"
```

### `validateProviderAdapter(adapter)`

What it does:
Checks adapter shape and returns `{ valid, provider, missingFields, missingMethods }`.

Real-life example:

```js
const validation = validateProviderAdapter(candidateAdapter);
if (!validation.valid) {
  console.error("Adapter is incomplete:", validation.missingMethods);
}
```

### `assertProviderAdapter(adapter, options?)`

What it does:
Throws if adapter is invalid. Returns adapter if valid.

Real-life example:

```js
const adapter = assertProviderAdapter(candidateAdapter, {
  name: "stripeBillingProviderAdapter"
});
```

### `REQUIRED_WEBHOOK_TRANSLATOR_METHODS`

What it does:
Defines mandatory methods for webhook translators.

Required methods:

1. `toCanonicalEvent`
2. `supportsCanonicalEventType`

Real-life example:

```js
for (const methodName of REQUIRED_WEBHOOK_TRANSLATOR_METHODS) {
  if (typeof translator[methodName] !== "function") {
    throw new Error(`translator.${methodName} is required.`);
  }
}
```

### `REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES`

What it does:
Set of canonical event types accepted by shared webhook processing guardrails.

Real-life example:
Use this set to ensure translators output only supported canonical event types.

### `normalizeWebhookProvider(value)`

What it does:
Normalizes provider code for webhook translator lookup.

Real-life example:

```js
normalizeWebhookProvider(" Paddle "); // "paddle"
```

### `shouldProcessCanonicalWebhookEvent(eventType)`

What it does:
Returns `true` only for supported canonical event types.

Real-life example:

```js
if (!shouldProcessCanonicalWebhookEvent(canonicalEvent.type)) {
  return { ignored: true, reason: "unsupported_event" };
}
```

### `validateWebhookTranslator(translator)`

What it does:
Checks translator shape and returns `{ valid, provider, missingFields, missingMethods }`.

Real-life example:

```js
const validation = validateWebhookTranslator(stripeTranslator);
if (!validation.valid) {
  throw new Error("Translator contract is incomplete.");
}
```

### `assertWebhookTranslator(translator, options?)`

What it does:
Throws if translator is invalid. Returns translator if valid.

Real-life example:

```js
const translator = assertWebhookTranslator(candidateTranslator, {
  name: "stripeBillingWebhookTranslator"
});
```

### `PROVIDER_ERROR_CATEGORIES`

What it does:
Shared category enum for provider-layer errors.

Categories:

1. `invalid_request`
2. `rate_limited`
3. `transient_network`
4. `transient_provider`
5. `auth`
6. `permission`
7. `not_found`
8. `conflict`
9. `unknown`

Real-life example:
A Stripe mapping function can categorize a timeout as `transient_network` and a malformed payload as `invalid_request`.

### `RETRYABLE_PROVIDER_ERROR_CATEGORIES`

What it does:
Set of categories usually safe to retry.

Real-life example:
If category is in this set, your orchestration can mark operation as in-progress and queue remediation.

### `BillingProviderError`

What it does:
Canonical error class for normalized provider failures.

Main fields:

1. `provider`
2. `operation`
3. `category`
4. `retryable`
5. `httpStatus`
6. `providerCode`
7. `providerRequestId`
8. `details`

Real-life example:

```js
throw new BillingProviderError("Stripe request failed.", {
  provider: "stripe",
  operation: "checkout_create",
  category: PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK,
  httpStatus: 503
});
```

### `createBillingProviderError(payload)`

What it does:
Factory that creates a `BillingProviderError`.

Real-life example:

```js
const error = createBillingProviderError({
  provider: "paddle",
  operation: "subscription_retrieve",
  category: PROVIDER_ERROR_CATEGORIES.TRANSIENT_PROVIDER,
  message: "Provider is temporarily unavailable."
});
```

### `isBillingProviderError(error)`

What it does:
Type guard for normalized provider errors.

Real-life example:

```js
if (isBillingProviderError(error) && error.retryable) {
  // enqueue retry/remediation instead of failing immediately
}
```

### `normalizeProviderErrorCategory(value)`

What it does:
Normalizes category text and safely falls back to `unknown`.

Real-life example:

```js
normalizeProviderErrorCategory("TRANSIENT_NETWORK"); // "transient_network"
normalizeProviderErrorCategory("something_new"); // "unknown"
```

---

## 7) How Apps Use This In Real Terms (And Why)

In this repository, this package is used as the shared core while vendor details stay local:

1. App-local wrapper files in `apps/jskit-value-app/server/modules/billing/providers/shared/` import from this package.
2. Stripe and Paddle adapter implementations stay local in `apps/jskit-value-app/server/modules/billing/providers/stripe/` and `apps/jskit-value-app/server/modules/billing/providers/paddle/`.
3. Error mapping files call `createBillingProviderError(...)` so downstream policy gets a stable error shape.
4. Webhook flow uses `normalizeWebhookProvider(...)` and `shouldProcessCanonicalWebhookEvent(...)` before applying business projections.

Why this split:

1. Shared package remains provider-core and reusable across many apps.
2. App keeps domain policy, migration logic, and provider SDK behavior where it belongs.
3. Future apps can reuse the same contracts without inheriting this app’s billing rules.

---

## 8) Real End-to-End Example

This is a realistic flow:

1. App bootstraps provider adapters (Stripe/Paddle).
2. App validates them with `assertProviderAdapter`.
3. App registers them in `createProviderRegistry`.
4. A checkout request resolves active adapter and calls `createCheckoutSession`.
5. If provider SDK throws, adapter mapping creates `BillingProviderError`.
6. App policy checks `isBillingProviderError` and category/retryable flags to decide fail-fast vs retry path.
7. Webhook events are translated, filtered with `shouldProcessCanonicalWebhookEvent`, then passed to app projections.

---

## 9) Common Mistakes

1. Putting product catalog constants in this package.
2. Putting entitlement/policy mapping in this package.
3. Putting raw Stripe/Paddle SDK request logic in this package.
4. Throwing raw SDK errors instead of normalized provider errors.
5. Relying on provider code without normalization.

---

## 10) Troubleshooting

### Error: `Invalid billing provider adapter: missing ...`

Cause:
Adapter object does not implement all required methods.

Fix:
Use `REQUIRED_PROVIDER_ADAPTER_METHODS` and `assertProviderAdapter(...)` at bootstrap.

### Error: `Unsupported billing provider: ...`

Cause:
Registry does not contain requested provider code.

Fix:
Register the provider and check normalization (`normalizeProviderCode`).

### Webhook events are unexpectedly ignored

Cause:
Canonical event type is not supported by the shared event filter.

Fix:
Verify translator output and check with `shouldProcessCanonicalWebhookEvent(...)`.

### Retry behavior feels inconsistent

Cause:
Error mapping may not normalize to shared categories.

Fix:
Map provider SDK errors with `createBillingProviderError(...)` and consistent categories.
