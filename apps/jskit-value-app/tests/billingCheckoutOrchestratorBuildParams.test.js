import assert from "node:assert/strict";
import test from "node:test";

import { createService as createCheckoutOrchestratorService } from "../server/modules/billing/checkoutOrchestrator.service.js";

function createOrchestrator() {
  return createCheckoutOrchestratorService({
    billingRepository: {
      async transaction(work) {
        return work({});
      }
    },
    billingPolicyService: {
      async resolveBillableEntityForWriteRequest() {
        return {
          billableEntity: {
            id: 1
          }
        };
      }
    },
    billingPricingService: {
      async resolvePhase1SellablePrice() {
        return null;
      }
    },
    billingIdempotencyService: {
      async claimOrReplay() {
        return null;
      }
    },
    billingCheckoutSessionService: {
      async getBlockingCheckoutSession() {
        return null;
      }
    },
    billingProviderAdapter: {
      async createCheckoutSession() {
        return null;
      }
    },
    appPublicUrl: "https://app.example.test"
  });
}

test("checkout orchestrator frozen checkout params omit customer_creation in subscription mode", async () => {
  const service = createOrchestrator();
  const now = new Date("2026-02-20T08:00:00.000Z");

  const params = await service.buildFrozenCheckoutSessionParams({
    operationKey: "op_1",
    billableEntityId: 99,
    idempotencyRowId: 501,
    plan: {
      code: "pro_monthly"
    },
    price: {
      providerPriceId: "price_123"
    },
    customer: null,
    payload: {
      successPath: "/billing/success",
      cancelPath: "/billing/cancel"
    },
    now
  });

  assert.equal(params.mode, "subscription");
  assert.equal(Object.hasOwn(params, "customer_creation"), false);
  assert.equal(params.customer, undefined);
});

test("checkout orchestrator frozen checkout params include one core plan price", async () => {
  const service = createOrchestrator();
  const now = new Date("2026-02-20T09:00:00.000Z");

  const params = await service.buildFrozenCheckoutSessionParams({
    operationKey: "op_2",
    billableEntityId: 100,
    idempotencyRowId: 502,
    plan: {
      code: "pro_monthly"
    },
    price: {
      providerPriceId: "price_base_123"
    },
    customer: {
      providerCustomerId: "cus_123"
    },
    payload: {
      planCode: "pro_monthly",
      successPath: "/billing/success",
      cancelPath: "/billing/cancel"
    },
    now
  });

  assert.equal(params.mode, "subscription");
  assert.equal(params.line_items.length, 1);
  assert.deepEqual(params.line_items[0], {
    price: "price_base_123",
    quantity: 1
  });
});

test("checkout orchestrator frozen checkout params support one_off payment mode", async () => {
  const service = createOrchestrator();
  const now = new Date("2026-02-20T10:00:00.000Z");

  const params = await service.buildFrozenCheckoutSessionParams({
    operationKey: "op_one_off_1",
    billableEntityId: 101,
    idempotencyRowId: 503,
    plan: null,
    price: null,
    customer: null,
    payload: {
      checkoutType: "one_off",
      oneOff: {
        name: "Priority setup package",
        amountMinor: 2500,
        quantity: 2,
        currency: "usd"
      },
      successPath: "/billing/success",
      cancelPath: "/billing/cancel"
    },
    now
  });

  assert.equal(params.mode, "payment");
  assert.equal(params.line_items.length, 1);
  assert.equal(params.line_items[0].quantity, 2);
  assert.equal(params.line_items[0].price_data.currency, "usd");
  assert.equal(params.line_items[0].price_data.product_data.name, "Priority setup package");
  assert.equal(params.line_items[0].price_data.unit_amount, 2500);
  assert.equal(params.metadata.checkout_flow, "one_off");
  assert.equal(params.metadata.checkout_type, "one_off");
  assert.equal(params.invoice_creation.enabled, true);
  assert.equal(params.customer_creation, "always");
});

test("checkout orchestrator one_off params enforce deployment currency", async () => {
  const service = createOrchestrator();

  await assert.rejects(
    () =>
      service.buildFrozenCheckoutSessionParams({
        operationKey: "op_one_off_currency",
        billableEntityId: 102,
        idempotencyRowId: 504,
        plan: null,
        price: null,
        customer: null,
        payload: {
          checkoutType: "one_off",
          oneOff: {
            name: "Premium support",
            amountMinor: 5000,
            currency: "EUR"
          },
          successPath: "/billing/success",
          cancelPath: "/billing/cancel"
        },
        now: new Date("2026-02-20T10:30:00.000Z")
      }),
    (error) => String(error?.details?.fieldErrors?.["oneOff.currency"] || "").includes("deployment billing currency")
  );
});
