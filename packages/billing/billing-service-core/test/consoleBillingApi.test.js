import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/shared/client/consoleBillingApi.js";

test("consoleBillingApi preserves console billing method contract", async () => {
  const calls = [];
  const api = createApi({
    request: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });

  assert.deepEqual(Object.keys(api), [
    "listBillingEvents",
    "listBillingPlans",
    "listBillingProducts",
    "getBillingSettings",
    "updateBillingSettings",
    "listBillingProviderPrices",
    "createBillingPlan",
    "createBillingProduct",
    "updateBillingPlan",
    "updateBillingProduct",
    "listEntitlementDefinitions",
    "getEntitlementDefinition",
    "createEntitlementDefinition",
    "updateEntitlementDefinition",
    "deleteEntitlementDefinition",
    "archiveBillingPlan",
    "unarchiveBillingPlan",
    "deleteBillingPlan",
    "archiveBillingProduct",
    "unarchiveBillingProduct",
    "deleteBillingProduct",
    "listPurchases",
    "refundPurchase",
    "voidPurchase",
    "createPurchaseCorrection",
    "listPlanAssignments",
    "createPlanAssignment",
    "updatePlanAssignment",
    "cancelPlanAssignment",
    "listSubscriptions",
    "changeSubscriptionPlan",
    "cancelSubscription",
    "cancelSubscriptionAtPeriodEnd"
  ]);

  await api.listBillingEvents({ page: 1, pageSize: 25, workspaceSlug: "acme" });
  await api.updateBillingPlan("plan/1", { name: "Pro" });
  await api.createEntitlementDefinition({ code: "feature.a" });
  await api.deleteEntitlementDefinition("ent/1", {}, { idempotencyKey: "idem-delete" });

  assert.equal(calls[0].url, "/api/v1/console/billing/events?page=1&pageSize=25&workspaceSlug=acme");
  assert.equal(calls[1].url, "/api/v1/console/billing/plans/plan%2F1");
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[2].url, "/api/v1/console/billing/entitlement-definitions");
  assert.deepEqual(calls[2].options.headers, {});
  assert.equal(calls[3].url, "/api/v1/console/billing/entitlement-definitions/ent%2F1");
  assert.equal(calls[3].options.headers["Idempotency-Key"], "idem-delete");
});
