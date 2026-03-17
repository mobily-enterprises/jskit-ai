import assert from "node:assert/strict";
import test from "node:test";

import { buildRouteMap } from "./helpers/consoleRouteMap.js";

test("console billing entitlement definition routes expose typed params and responses", () => {
  const routeMap = buildRouteMap();

  const listRoute = routeMap.get("GET /api/console/billing/entitlement-definitions");
  assert.ok(listRoute, "expected list entitlement definitions route");
  assert.equal(listRoute.auth, "required");
  assert.equal(typeof listRoute.schema?.response?.[200], "object");
  assert.equal(Array.isArray(listRoute.schema?.response?.[200]?.properties?.entries?.items?.required), true);

  const getRoute = routeMap.get("GET /api/console/billing/entitlement-definitions/:definitionId");
  assert.ok(getRoute, "expected get entitlement definition route");
  assert.equal(getRoute.auth, "required");
  assert.equal(getRoute.schema?.params?.properties?.definitionId?.pattern, "^[0-9]+$");
  assert.equal(getRoute.schema?.response?.[200]?.properties?.definition?.required?.includes("code"), true);
});
