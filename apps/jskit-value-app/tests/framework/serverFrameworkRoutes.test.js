import assert from "node:assert/strict";
import test from "node:test";

import { composeRouteModuleDefinitions, buildRoutesFromComposedModules } from "../../server/framework/composeRoutes.js";
import { buildRoutes as buildLegacyRoutes, ROUTE_MODULE_DEFINITIONS } from "../../server/modules/api/routes.js";

function createControllerProxy() {
  const fallbackHandler = new Proxy(
    async (_request, reply) => {
      if (reply && typeof reply.code === "function") {
        reply.code(200).send({ ok: true });
      }
    },
    {
      get() {
        return fallbackHandler;
      }
    }
  );

  return new Proxy(
    {},
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        return fallbackHandler;
      }
    }
  );
}

test("composeRouteModuleDefinitions returns legacy route module id order", () => {
  assert.deepEqual(composeRouteModuleDefinitions(), ROUTE_MODULE_DEFINITIONS.map((entry) => entry.id));
});

test("buildRoutesFromComposedModules preserves legacy route outputs", () => {
  const controllers = createControllerProxy();

  const composedRoutes = buildRoutesFromComposedModules({ controllers });
  const legacyRoutes = buildLegacyRoutes(controllers);

  assert.deepEqual(
    composedRoutes.map((route) => `${route.method} ${route.path}`),
    legacyRoutes.map((route) => `${route.method} ${route.path}`)
  );
});
