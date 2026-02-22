import test from "node:test";
import assert from "node:assert/strict";

import { buildRoutes } from "../server/modules/billing/routes.js";

function buildRouteMap() {
  const routes = buildRoutes(
    {
      billing: {
        listPlans() {},
        listProducts() {},
        listPurchases() {},
        getPlanState() {},
        listPaymentMethods() {},
        syncPaymentMethods() {},
        getLimitations() {},
        getTimeline() {},
        startCheckout() {},
        requestPlanChange() {},
        cancelPendingPlanChange() {},
        createPortalSession() {},
        createPaymentLink() {},
        processStripeWebhook() {}
      }
    },
    {
      missingHandler() {}
    }
  );

  return new Map(routes.map((route) => [`${route.method} ${route.path}`, route]));
}

test("billing API routes are selector-compatible with optional workspace policy", () => {
  const routeMap = buildRouteMap();
  const selectorCompatibleRoutes = [
    "GET /api/billing/plans",
    "GET /api/billing/products",
    "GET /api/billing/purchases",
    "GET /api/billing/plan-state",
    "GET /api/billing/payment-methods",
    "POST /api/billing/payment-methods/sync",
    "GET /api/billing/limitations",
    "GET /api/billing/timeline",
    "POST /api/billing/checkout",
    "POST /api/billing/plan-change",
    "POST /api/billing/plan-change/cancel",
    "POST /api/billing/portal",
    "POST /api/billing/payment-links"
  ];

  for (const key of selectorCompatibleRoutes) {
    const route = routeMap.get(key);
    assert.ok(route, `expected route ${key} to exist`);
    assert.equal(route.auth, "required");
    assert.equal(route.workspacePolicy, "optional");
  }
});

test("billing write routes do not depend on prehandler workspace permission checks", () => {
  const routeMap = buildRouteMap();
  const writeRoutes = [
    "POST /api/billing/payment-methods/sync",
    "POST /api/billing/checkout",
    "POST /api/billing/plan-change",
    "POST /api/billing/plan-change/cancel",
    "POST /api/billing/portal",
    "POST /api/billing/payment-links"
  ];

  for (const key of writeRoutes) {
    const route = routeMap.get(key);
    assert.ok(route, `expected route ${key} to exist`);
    assert.equal(route.permission, undefined);
  }
});

test("stripe webhook route remains public and workspace-agnostic", () => {
  const routeMap = buildRouteMap();
  const route = routeMap.get("POST /api/billing/webhooks/stripe");

  assert.ok(route);
  assert.equal(route.auth, "public");
  assert.equal(route.workspacePolicy, "none");
});
