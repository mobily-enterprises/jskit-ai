import { buildRoutes } from "@jskit-ai/console-fastify-routes";
import { toVersionedApiPath } from "../../shared/apiPaths.js";

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

export { buildRouteMap, createNoopControllers };
