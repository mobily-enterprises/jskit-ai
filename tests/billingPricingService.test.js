import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { BILLING_FAILURE_CODES } from "../server/modules/billing/constants.js";
import { createService as createBillingPricingService } from "../server/modules/billing/pricing.service.js";

function createService() {
  return createBillingPricingService({
    billingRepository: {
      async findPlanById() {
        return null;
      }
    },
    billingCurrency: "USD"
  });
}

test("billing pricing service resolves one checkout price from plan core mapping", async () => {
  const service = createService();

  const resolved = await service.resolveSubscriptionCheckoutPrices({
    plan: {
      id: 10,
      corePrice: {
        provider: "stripe",
        providerPriceId: "price_pro_monthly",
        providerProductId: "prod_pro",
        interval: "month",
        intervalCount: 1,
        currency: "USD",
        unitAmountMinor: 4900
      }
    },
    provider: "stripe"
  });

  assert.equal(resolved.basePrice.providerPriceId, "price_pro_monthly");
  assert.deepEqual(resolved.lineItemPrices.map((row) => row.providerPriceId), ["price_pro_monthly"]);
});

test("billing pricing service resolves phase1 sellable price from stored plan core mapping", async () => {
  const service = createBillingPricingService({
    billingRepository: {
      async findPlanById(planId) {
        assert.equal(planId, 10);
        return {
          id: 10,
          corePrice: {
            provider: "stripe",
            providerPriceId: "price_pro_monthly",
            providerProductId: "prod_pro",
            interval: "month",
            intervalCount: 1,
            currency: "USD",
            unitAmountMinor: 4900
          }
        };
      }
    },
    billingCurrency: "USD"
  });

  const resolved = await service.resolvePhase1SellablePrice({
    planId: 10,
    provider: "stripe"
  });

  assert.equal(resolved.providerPriceId, "price_pro_monthly");
});

test("billing pricing service fails closed on invalid core checkout mapping", async () => {
  const service = createService();

  await assert.rejects(
    () =>
      service.resolveSubscriptionCheckoutPrices({
        plan: {
          id: 10,
          corePrice: {
            provider: "stripe",
            providerPriceId: "price_pro_weekly",
            interval: "week",
            intervalCount: 1,
            currency: "USD",
            unitAmountMinor: 4900
          }
        },
        provider: "stripe"
      }),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 409 &&
      String(error.code || "") === BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID
  );
});
