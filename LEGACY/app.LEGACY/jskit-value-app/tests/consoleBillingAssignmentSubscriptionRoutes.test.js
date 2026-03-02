import assert from "node:assert/strict";
import test from "node:test";

import { buildRouteMap } from "./helpers/consoleRouteMap.js";

test("console billing assignment and subscription routes expose typed query/params/body schemas", () => {
  const routeMap = buildRouteMap();

  const listAssignmentsRoute = routeMap.get("GET /api/v1/console/billing/plan-assignments");
  assert.ok(listAssignmentsRoute, "expected plan assignments list route");
  assert.equal(listAssignmentsRoute.auth, "required");
  assert.equal(typeof listAssignmentsRoute.schema?.querystring?.properties?.status, "object");
  assert.equal(typeof listAssignmentsRoute.schema?.response?.[200]?.properties?.entries?.items?.properties?.planCode, "object");

  const createAssignmentRoute = routeMap.get("POST /api/v1/console/billing/plan-assignments");
  assert.ok(createAssignmentRoute, "expected plan assignment create route");
  assert.equal(typeof createAssignmentRoute.schema?.body?.properties?.billableEntityId, "object");
  assert.equal(createAssignmentRoute.schema?.response?.[200]?.properties?.assignment?.required?.includes("id"), true);

  const updateAssignmentRoute = routeMap.get("PATCH /api/v1/console/billing/plan-assignments/:assignmentId");
  assert.ok(updateAssignmentRoute, "expected plan assignment update route");
  assert.equal(updateAssignmentRoute.schema?.params?.properties?.assignmentId?.pattern, "^[0-9]+$");
  assert.equal(typeof updateAssignmentRoute.schema?.body?.properties?.status, "object");

  const cancelAssignmentRoute = routeMap.get("POST /api/v1/console/billing/plan-assignments/:assignmentId/cancel");
  assert.ok(cancelAssignmentRoute, "expected plan assignment cancel route");
  assert.equal(cancelAssignmentRoute.schema?.params?.properties?.assignmentId?.pattern, "^[0-9]+$");

  const listSubscriptionsRoute = routeMap.get("GET /api/v1/console/billing/subscriptions");
  assert.ok(listSubscriptionsRoute, "expected subscriptions list route");
  assert.equal(typeof listSubscriptionsRoute.schema?.querystring?.properties?.provider, "object");
  assert.equal(
    typeof listSubscriptionsRoute.schema?.response?.[200]?.properties?.entries?.items?.properties?.providerSubscriptionId,
    "object"
  );

  const changePlanRoute = routeMap.get("POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/change-plan");
  assert.ok(changePlanRoute, "expected change-plan route");
  assert.equal(typeof changePlanRoute.schema?.body?.properties?.planId, "object");
  assert.equal(typeof changePlanRoute.schema?.body?.properties?.planCode, "object");

  const cancelSubscriptionRoute = routeMap.get("POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/cancel");
  assert.ok(cancelSubscriptionRoute, "expected cancel subscription route");
  assert.equal(cancelSubscriptionRoute.schema?.params?.properties?.providerSubscriptionId?.maxLength, 191);

  const cancelAtPeriodEndRoute = routeMap.get(
    "POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/cancel-at-period-end"
  );
  assert.ok(cancelAtPeriodEndRoute, "expected cancel-at-period-end route");
  assert.equal(cancelAtPeriodEndRoute.schema?.params?.properties?.providerSubscriptionId?.maxLength, 191);
});
