import assert from "node:assert/strict";
import test from "node:test";

import {
  composeRouteModuleDefinitions,
  composeRouteModules,
  buildRoutesFromComposedModules
} from "../../server/framework/composeRoutes.js";
import { buildRoutes as buildApiRoutes, ROUTE_MODULE_DEFINITIONS } from "../../server/modules/api/routes.js";
import { createControllerProxy } from "../helpers/createControllerProxy.js";

test("composeRouteModuleDefinitions returns route module id order", () => {
  assert.deepEqual(composeRouteModuleDefinitions(), ROUTE_MODULE_DEFINITIONS.map((entry) => entry.id));
});

test("buildRoutesFromComposedModules preserves API route outputs", () => {
  const controllers = createControllerProxy();

  const composedRoutes = buildRoutesFromComposedModules({ controllers });
  const apiRoutes = buildApiRoutes(controllers);

  assert.deepEqual(
    composedRoutes.map((route) => `${route.method} ${route.path}`),
    apiRoutes.map((route) => `${route.method} ${route.path}`)
  );
});

test("composeRouteModules supports module filtering", () => {
  const enabledModuleIds = ["health", "auth", "workspace", "actionRuntime", "history", "deg2rad"];
  const routeModules = composeRouteModules({
    enabledModuleIds
  });

  assert.deepEqual(
    routeModules.map((entry) => entry.id),
    ["health", "auth", "workspace", "history", "deg2rad"]
  );

  const controllers = createControllerProxy();
  const routes = buildRoutesFromComposedModules({
    controllers,
    enabledModuleIds
  });
  const routeSignatures = routes.map((route) => `${route.method} ${route.path}`);

  assert.equal(routeSignatures.includes("GET /api/health"), true);
  assert.equal(routeSignatures.includes("POST /api/login"), true);
  assert.equal(routeSignatures.includes("POST /api/deg2rad"), true);
  assert.equal(routeSignatures.includes("GET /api/workspace/projects"), false);
});
