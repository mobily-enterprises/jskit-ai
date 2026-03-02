import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/client/workspaceBillingApi.js";

test("workspaceBillingApi preserves workspace billing method contract", async () => {
  const calls = [];
  const api = createApi({
    request: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });

  assert.deepEqual(Object.keys(api), [
    "listPlans",
    "listProducts",
    "listPurchases",
    "getPlanState",
    "listPaymentMethods",
    "syncPaymentMethods",
    "setDefaultPaymentMethod",
    "detachPaymentMethod",
    "removePaymentMethod",
    "getLimitations",
    "getTimeline",
    "startCheckout",
    "requestPlanChange",
    "cancelPendingPlanChange",
    "createPortal",
    "createPaymentLink"
  ]);

  await api.getTimeline({ page: 2, pageSize: 10, source: "checkout" });
  await api.setDefaultPaymentMethod("pm/123", { reason: "user" }, { idempotencyKey: "idem-fixed" });
  await api.createPaymentLink({ planId: "pro" });

  assert.equal(calls[0].url, "/api/v1/billing/timeline?page=2&pageSize=10&source=checkout");
  assert.equal(calls[1].url, "/api/v1/billing/payment-methods/pm%2F123/default");
  assert.equal(calls[1].options.headers["Idempotency-Key"], "idem-fixed");
  assert.equal(calls[2].url, "/api/v1/billing/payment-links");
  assert.match(calls[2].options.headers["Idempotency-Key"], /^idem_/);
});
