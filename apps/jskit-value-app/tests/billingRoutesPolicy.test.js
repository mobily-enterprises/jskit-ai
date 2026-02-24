import test from "node:test";
import assert from "node:assert/strict";

import { buildRoutes } from "@jskit-ai/billing-fastify-adapter/routes";
import { toVersionedApiPath } from "../shared/apiPaths.js";

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

  const versionedRoutes = routes.map((route) => ({
    ...route,
    path: toVersionedApiPath(route.path)
  }));

  return new Map(versionedRoutes.map((route) => [`${route.method} ${route.path}`, route]));
}

test("billing API routes are selector-compatible with optional workspace policy", () => {
  const routeMap = buildRouteMap();
  const selectorCompatibleRoutes = [
    "GET /api/v1/billing/plans",
    "GET /api/v1/billing/products",
    "GET /api/v1/billing/purchases",
    "GET /api/v1/billing/plan-state",
    "GET /api/v1/billing/payment-methods",
    "POST /api/v1/billing/payment-methods/sync",
    "GET /api/v1/billing/limitations",
    "GET /api/v1/billing/timeline",
    "POST /api/v1/billing/checkout",
    "POST /api/v1/billing/plan-change",
    "POST /api/v1/billing/plan-change/cancel",
    "POST /api/v1/billing/portal",
    "POST /api/v1/billing/payment-links"
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
    "POST /api/v1/billing/payment-methods/sync",
    "POST /api/v1/billing/checkout",
    "POST /api/v1/billing/plan-change",
    "POST /api/v1/billing/plan-change/cancel",
    "POST /api/v1/billing/portal",
    "POST /api/v1/billing/payment-links"
  ];

  for (const key of writeRoutes) {
    const route = routeMap.get(key);
    assert.ok(route, `expected route ${key} to exist`);
    assert.equal(route.permission, undefined);
  }
});

test("stripe webhook route remains public and workspace-agnostic", () => {
  const routeMap = buildRouteMap();
  const route = routeMap.get("POST /api/v1/billing/webhooks/stripe");

  assert.ok(route);
  assert.equal(route.auth, "public");
  assert.equal(route.workspacePolicy, "none");
});
