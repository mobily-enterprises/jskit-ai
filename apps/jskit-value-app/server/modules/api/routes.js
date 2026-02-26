import { ROUTE_MODULE_DEFINITIONS, buildRoutesFromComposedModules } from "../../framework/composeRoutes.js";

function buildRoutes(controllers, routeConfig = {}) {
  const { frameworkCompositionMode, ...resolvedRouteConfig } = routeConfig || {};

  return buildRoutesFromComposedModules({
    controllers,
    routeConfig: resolvedRouteConfig,
    mode: frameworkCompositionMode
  });
}

export { ROUTE_MODULE_DEFINITIONS, buildRoutes };
