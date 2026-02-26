import { ROUTE_MODULE_DEFINITIONS, buildRoutesFromComposedModules } from "../../framework/composeRoutes.js";

function buildRoutes(controllers, routeConfig = {}) {
  return buildRoutesFromComposedModules({
    controllers,
    routeConfig
  });
}

export { ROUTE_MODULE_DEFINITIONS, buildRoutes };
