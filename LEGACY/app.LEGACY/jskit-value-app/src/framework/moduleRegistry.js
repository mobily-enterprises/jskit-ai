import { mergeClientModuleRegistry } from "@jskit-ai/module-framework-core/appDropins";
import { getClientAppExtensions } from "../app/loadExtensions.client.js";
import { CLIENT_MODULE_REGISTRY, CLIENT_MODULE_IDS } from "./moduleRegistry.base.js";

function resolveClientModuleRegistry() {
  return mergeClientModuleRegistry({
    baseRegistry: CLIENT_MODULE_REGISTRY,
    extensionBundle: getClientAppExtensions()
  });
}

function resolveClientModuleById(moduleId) {
  const normalized = String(moduleId || "").trim();
  return resolveClientModuleRegistry().find((entry) => entry.id === normalized) || null;
}

export { CLIENT_MODULE_REGISTRY, CLIENT_MODULE_IDS, resolveClientModuleRegistry, resolveClientModuleById };
