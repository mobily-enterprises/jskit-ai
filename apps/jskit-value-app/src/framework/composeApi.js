import { resolveClientModuleRegistry } from "./moduleRegistry.js";

function resolveActiveClientModules(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return resolveClientModuleRegistry();
  }

  const enabledSet = new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
  return resolveClientModuleRegistry().filter((entry) => enabledSet.has(entry.id));
}

function composeClientApi({ request, requestStream, clearCsrfTokenCache, enabledModuleIds } = {}) {
  if (typeof request !== "function") {
    throw new TypeError("composeClientApi requires request function.");
  }

  const api = {};

  for (const moduleEntry of resolveActiveClientModules(enabledModuleIds)) {
    const apiDefinition = moduleEntry?.client?.api;
    if (!apiDefinition || typeof apiDefinition !== "object") {
      continue;
    }

    const key = String(apiDefinition.key || "").trim();
    if (!key) {
      continue;
    }

    if (Object.hasOwn(api, key)) {
      throw new Error(`Duplicate client API key "${key}" in module registry.`);
    }

    if (typeof apiDefinition.createApi !== "function") {
      throw new TypeError(`Client API definition for key "${key}" must define createApi().`);
    }

    api[key] = apiDefinition.createApi({
      request,
      requestStream
    });
  }

  if (typeof clearCsrfTokenCache === "function") {
    api.clearCsrfTokenCache = clearCsrfTokenCache;
  }

  return api;
}

export { composeClientApi, resolveActiveClientModules };
