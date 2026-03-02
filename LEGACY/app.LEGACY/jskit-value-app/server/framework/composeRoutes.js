import { buildRoutesFromManifest } from "@jskit-ai/server-runtime-core/runtimeAssembly";
import { toVersionedApiPath } from "../../shared/apiPaths.js";
import { composeServerRuntimeArtifacts } from "./composeRuntime.js";
import { ROUTE_MODULE_DEFINITIONS, createMissingHandler } from "./routeModuleCatalog.js";

function composeRouteModuleDefinitions(options = {}) {
  return composeServerRuntimeArtifacts(options).routeModuleIds;
}

function composeRouteModules(options = {}) {
  const includedIds = new Set(composeRouteModuleDefinitions(options));
  if (includedIds.size < 1) {
    return [];
  }

  return ROUTE_MODULE_DEFINITIONS.filter((definition) => includedIds.has(definition.id));
}

function buildRoutesFromComposedModules({
  controllers,
  routeConfig = {},
  enabledModuleIds,
  mode,
  profileId,
  optionalModulePacks,
  enforceProfileRequired,
  extensionModules
} = {}) {
  const routes = buildRoutesFromManifest({
    definitions: composeRouteModules({
      enabledModuleIds,
      mode,
      profileId,
      optionalModulePacks,
      enforceProfileRequired,
      extensionModules
    }),
    controllers,
    routeConfig,
    missingHandler: createMissingHandler()
  });

  return routes.map((route) => ({
    ...route,
    path: toVersionedApiPath(route.path)
  }));
}

export { ROUTE_MODULE_DEFINITIONS, composeRouteModuleDefinitions, composeRouteModules, buildRoutesFromComposedModules };
