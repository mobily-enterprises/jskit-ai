import { composeClientApiFromModules, resolveActiveClientModules as resolveActiveModules } from "@jskit-ai/web-runtime-core/clientComposition";
import { resolveClientModuleRegistry } from "./moduleRegistry.js";

function resolveActiveClientModules(enabledModuleIds) {
  return resolveActiveModules(resolveClientModuleRegistry(), enabledModuleIds);
}

function composeClientApi({ request, requestStream, clearCsrfTokenCache, enabledModuleIds } = {}) {
  return composeClientApiFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    request,
    requestStream,
    clearCsrfTokenCache,
    enabledModuleIds
  });
}

export { composeClientApi, resolveActiveClientModules };
