import assert from "node:assert/strict";
import test from "node:test";

import { buildRoutes } from "@jskit-ai/console-fastify-routes";
import { toVersionedApiPath } from "../shared/apiPaths.js";

function createNoopControllers() {
  const noop = async () => {};
  const consoleController = new Proxy(
    {},
    {
      get() {
        return noop;
      }
    }
  );

  return {
    console: consoleController
  };
}

function buildRouteMap() {
  const routes = buildRoutes(createNoopControllers(), {
    missingHandler() {}
  }).map((route) => ({
    ...route,
    path: toVersionedApiPath(route.path)
  }));

  return new Map(routes.map((route) => [`${String(route.method || "").toUpperCase()} ${route.path}`, route]));
}

test("console billing entitlement definition routes expose typed params and responses", () => {
  const routeMap = buildRouteMap();

  const listRoute = routeMap.get("GET /api/v1/console/billing/entitlement-definitions");
  assert.ok(listRoute, "expected list entitlement definitions route");
  assert.equal(listRoute.auth, "required");
  assert.equal(typeof listRoute.schema?.response?.[200], "object");
  assert.equal(Array.isArray(listRoute.schema?.response?.[200]?.properties?.entries?.items?.required), true);

  const getRoute = routeMap.get("GET /api/v1/console/billing/entitlement-definitions/:definitionId");
  assert.ok(getRoute, "expected get entitlement definition route");
  assert.equal(getRoute.auth, "required");
  assert.equal(getRoute.schema?.params?.properties?.definitionId?.pattern, "^[0-9]+$");
  assert.equal(getRoute.schema?.response?.[200]?.properties?.definition?.required?.includes("code"), true);
});
