import { loadClientAppDropinsFromModules } from "@jskit-ai/module-framework-core/appDropins";

function resolveClientExtensionModules({ modules } = {}) {
  if (modules && typeof modules === "object" && !Array.isArray(modules)) {
    return modules;
  }

  if (typeof import.meta.glob === "function") {
    return import.meta.glob("./extensions.d/*.client.js", { eager: true });
  }

  return {};
}

function loadClientAppExtensions({ modules } = {}) {
  const resolvedModules = resolveClientExtensionModules({ modules });
  return loadClientAppDropinsFromModules({
    modules: resolvedModules
  });
}

let cachedClientExtensions = null;

function getClientAppExtensions() {
  if (!cachedClientExtensions) {
    cachedClientExtensions = loadClientAppExtensions();
  }
  return cachedClientExtensions;
}

const __testables = {
  resolveClientExtensionModules,
  resetClientAppExtensionsCache() {
    cachedClientExtensions = null;
  }
};

export { loadClientAppExtensions, getClientAppExtensions, __testables };
