import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { BILLING_FAILURE_CODES } from "../server/modules/billing/constants.js";
import { createService as createBillingPricingService } from "../server/modules/billing/pricing.service.js";

test("billing pricing service resolves hybrid checkout with base plus metered components", async () => {
  const basePrice = {
    id: 1,
    providerPriceId: "price_base",
    billingComponent: "base",
    usageType: "licensed",
    interval: "month",
    intervalCount: 1,
    currency: "USD",
    isActive: true
  };
  const meteredPrice = {
    id: 2,
    providerPriceId: "price_metered",
    billingComponent: "metered",
    usageType: "metered",
    interval: "month",
    intervalCount: 1,
    currency: "USD",
    isActive: true
  };

  const service = createBillingPricingService({
    billingRepository: {
      async findSellablePlanPricesForPlan() {
        return [basePrice];
      },
      async listPlanPricesForPlan() {
        return [
          basePrice,
          meteredPrice,
          {
            id: 3,
            providerPriceId: "price_addon",
            billingComponent: "add_on",
            usageType: "licensed",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            isActive: true
          }
        ];
      }
    },
    billingCurrency: "usd"
  });

  const resolved = await service.resolveSubscriptionCheckoutPrices({
    plan: {
      id: 10,
      pricingModel: "hybrid"
    },
    provider: "stripe"
  });

  assert.equal(resolved.basePrice.providerPriceId, "price_base");
  assert.deepEqual(
    resolved.lineItemPrices.map((row) => row.providerPriceId),
    ["price_base", "price_metered"]
  );
});

test("billing pricing service fails closed on hybrid metered interval mismatch", async () => {
  const service = createBillingPricingService({
    billingRepository: {
      async findSellablePlanPricesForPlan() {
        return [
          {
            id: 1,
            providerPriceId: "price_base",
            billingComponent: "base",
            usageType: "licensed",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            isActive: true
          }
        ];
      },
      async listPlanPricesForPlan() {
        return [
          {
            id: 1,
            providerPriceId: "price_base",
            billingComponent: "base",
            usageType: "licensed",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            isActive: true
          },
          {
            id: 2,
            providerPriceId: "price_metered_weekly",
            billingComponent: "metered",
            usageType: "metered",
            interval: "week",
            intervalCount: 1,
            currency: "USD",
            isActive: true
          }
        ];
      }
    },
    billingCurrency: "USD"
  });

  await assert.rejects(
    () =>
      service.resolveSubscriptionCheckoutPrices({
        plan: {
          id: 10,
          pricingModel: "hybrid"
        },
        provider: "stripe"
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID
  );
});
