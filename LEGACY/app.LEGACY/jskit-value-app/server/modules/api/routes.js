import { ROUTE_MODULE_DEFINITIONS, buildRoutesFromComposedModules } from "../../framework/composeRoutes.js";

function buildRoutes(controllers, routeConfig = {}) {
  const {
    frameworkCompositionMode,
    frameworkProfileId,
    frameworkOptionalModulePacks,
    frameworkEnforceProfileRequired,
    frameworkExtensionModules,
    ...resolvedRouteConfig
  } = routeConfig || {};

  return buildRoutesFromComposedModules({
    controllers,
    routeConfig: resolvedRouteConfig,
    mode: frameworkCompositionMode,
    profileId: frameworkProfileId,
    optionalModulePacks: frameworkOptionalModulePacks,
    enforceProfileRequired: frameworkEnforceProfileRequired,
    extensionModules: frameworkExtensionModules
  });
}

export { ROUTE_MODULE_DEFINITIONS, buildRoutes };
