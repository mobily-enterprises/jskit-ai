import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const CORE_BILLING_FILES = Object.freeze([
  "server/modules/billing/service.js",
  "server/modules/billing/checkoutOrchestrator.service.js",
  "server/modules/billing/idempotency.service.js",
  "server/modules/billing/providerOutcomePolicy.js"
]);

const BANNED_PROVIDER_ERROR_LITERALS = Object.freeze([
  "stripeapiconnectionerror",
  "stripeapierror",
  "stripeinvalidrequesterror",
  "stripeapirate",
  "StripeAPIConnectionError",
  "StripeAPIError",
  "StripeInvalidRequestError",
  "PaddleAPIError",
  "PaddleNetworkError"
]);

test("core billing modules do not embed provider-specific sdk error literals", () => {
  for (const relativePath of CORE_BILLING_FILES) {
    const absolutePath = path.resolve(relativePath);
    const source = readFileSync(absolutePath, "utf8");
    const lowerSource = source.toLowerCase();

    for (const literal of BANNED_PROVIDER_ERROR_LITERALS) {
      const normalizedLiteral = String(literal).toLowerCase();
      assert.equal(
        lowerSource.includes(normalizedLiteral),
        false,
        `provider-specific literal "${literal}" must not appear in ${relativePath}`
      );
    }
  }
});

test("webhook core depends on injected translation registry instead of provider translators", () => {
  const relativePath = "server/modules/billing/webhook.service.js";
  const absolutePath = path.resolve(relativePath);
  const source = readFileSync(absolutePath, "utf8");

  assert.equal(
    source.includes("./providers/stripe/webhookTranslation.service.js"),
    false,
    "webhook core must not import stripe translator directly"
  );
  assert.equal(
    source.includes("./providers/paddle/webhookTranslation.service.js"),
    false,
    "webhook core must not import paddle translator directly"
  );
  assert.equal(
    source.includes("createBillingWebhookTranslationRegistryService"),
    false,
    "webhook core must not construct translation registry fallback"
  );
});
