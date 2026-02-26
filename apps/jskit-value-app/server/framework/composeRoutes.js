import { buildRoutes as buildLegacyRoutes } from "../modules/api/index.js";
import { composeServerRuntimeArtifacts } from "./composeRuntime.js";

function composeRouteModuleDefinitions(options = {}) {
  return composeServerRuntimeArtifacts(options).routeModuleIds;
}

function buildRoutesFromComposedModules({ controllers, routeConfig = {} } = {}) {
  return buildLegacyRoutes(controllers, routeConfig);
}

export { composeRouteModuleDefinitions, buildRoutesFromComposedModules };
