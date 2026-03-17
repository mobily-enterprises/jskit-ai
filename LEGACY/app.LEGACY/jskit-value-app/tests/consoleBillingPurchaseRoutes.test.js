import assert from "node:assert/strict";
import test from "node:test";

import { buildRouteMap } from "./helpers/consoleRouteMap.js";

test("console billing purchase routes expose typed query/params and mutation schemas", () => {
  const routeMap = buildRouteMap();

  const listRoute = routeMap.get("GET /api/console/billing/purchases");
  assert.ok(listRoute, "expected purchases list route");
  assert.equal(listRoute.auth, "required");
  assert.equal(typeof listRoute.schema?.querystring?.properties?.page, "object");
  assert.equal(typeof listRoute.schema?.response?.[200]?.properties?.entries?.items?.properties?.purchaseKind, "object");

  const refundRoute = routeMap.get("POST /api/console/billing/purchases/:purchaseId/refund");
  assert.ok(refundRoute, "expected purchase refund route");
  assert.equal(refundRoute.schema?.params?.properties?.purchaseId?.pattern, "^[0-9]+$");
  assert.equal(typeof refundRoute.schema?.body?.properties?.reasonCode, "object");

  const voidRoute = routeMap.get("POST /api/console/billing/purchases/:purchaseId/void");
  assert.ok(voidRoute, "expected purchase void route");
  assert.equal(voidRoute.schema?.params?.properties?.purchaseId?.pattern, "^[0-9]+$");

  const correctionRoute = routeMap.get("POST /api/console/billing/purchases/:purchaseId/corrections");
  assert.ok(correctionRoute, "expected purchase correction route");
  assert.equal(typeof correctionRoute.schema?.body?.properties?.amountMinor, "object");
  assert.equal(correctionRoute.schema?.response?.[200]?.properties?.adjustments?.type, "array");
});
