import { createSurfaceRuntime } from "../../shared/surface/runtime.js";
import { normalizeObject } from "../../shared/support/normalize.js";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { assertTaggableApp } from "./primitives.js";

const ACTION_SURFACE_SOURCE_REGISTRY_TOKEN = Symbol.for("jskit.runtime.actions.surfaceSourceRegistry");
const ACTION_SURFACE_SOURCE_NAME_PATTERN = /^[a-z][a-z0-9_.-]*$/;

function normalizeSurfaceIdValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSurfaceSourceName(sourceName, { context = "action surface source" } = {}) {
  const normalizedSourceName = normalizeSurfaceIdValue(sourceName);
  if (!ACTION_SURFACE_SOURCE_NAME_PATTERN.test(normalizedSourceName)) {
    throw new Error(`${context} must match ${ACTION_SURFACE_SOURCE_NAME_PATTERN.toString()}.`);
  }

  return normalizedSourceName;
}

function resolveSurfaceRuntime(scope) {
  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function") {
    throw new Error("Action definition materialization requires scope.has()/make().");
  }

  if (!scope.has(KERNEL_TOKENS.SurfaceRuntime)) {
    if (scope.has("appConfig")) {
      const appConfig = normalizeObject(scope.make("appConfig"));
      const surfaceDefinitions = normalizeObject(appConfig.surfaceDefinitions);
      if (Object.keys(surfaceDefinitions).length > 0) {
        return createSurfaceRuntime({
          allMode: appConfig.surfaceModeAll,
          surfaces: surfaceDefinitions,
          defaultSurfaceId: appConfig.surfaceDefaultId
        });
      }
    }
    throw new Error("Action definition surfacesFrom requires KERNEL_TOKENS.SurfaceRuntime or appConfig.surfaceDefinitions.");
  }

  return scope.make(KERNEL_TOKENS.SurfaceRuntime);
}

function resolveEnabledSurfaceIds(surfaceRuntime) {
  return Array.isArray(surfaceRuntime?.listEnabledSurfaceIds?.()) ? surfaceRuntime.listEnabledSurfaceIds() : [];
}

function normalizeSurfaceIdList(surfaceIds, { context = "action.surfacesFrom", surfaceRuntime = null } = {}) {
  const sourceSurfaceIds = Array.isArray(surfaceIds) ? surfaceIds : [];
  const enabledSurfaceIds = new Set(
    resolveEnabledSurfaceIds(surfaceRuntime).map((entry) => normalizeSurfaceIdValue(entry)).filter(Boolean)
  );
  const seen = new Set();
  const normalized = [];

  for (const sourceSurfaceId of sourceSurfaceIds) {
    const normalizedSurfaceId = normalizeSurfaceIdValue(sourceSurfaceId);
    if (!normalizedSurfaceId || seen.has(normalizedSurfaceId)) {
      continue;
    }

    if (!enabledSurfaceIds.has(normalizedSurfaceId)) {
      throw new Error(`${context} resolved non-enabled surface "${normalizedSurfaceId}".`);
    }

    seen.add(normalizedSurfaceId);
    normalized.push(normalizedSurfaceId);
  }

  return Object.freeze(normalized);
}

function createActionSurfaceSourceRegistry() {
  const sourceResolvers = new Map();

  const register = (sourceName, resolver, { allowOverride = false } = {}) => {
    const normalizedSourceName = normalizeSurfaceSourceName(sourceName);
    if (typeof resolver !== "function") {
      throw new Error(`action surface source "${normalizedSourceName}" resolver must be a function.`);
    }
    if (!allowOverride && sourceResolvers.has(normalizedSourceName)) {
      throw new Error(`action surface source "${normalizedSourceName}" is already registered.`);
    }
    sourceResolvers.set(normalizedSourceName, resolver);
  };

  register("enabled", ({ surfaceRuntime }) => resolveEnabledSurfaceIds(surfaceRuntime));

  return Object.freeze({
    register,
    resolve(scope, sourceName, { context = "action.surfacesFrom" } = {}) {
      const normalizedSourceName = normalizeSurfaceSourceName(sourceName, { context });
      const resolver = sourceResolvers.get(normalizedSourceName);
      if (typeof resolver !== "function") {
        throw new Error(
          `${context} references unknown surface source "${normalizedSourceName}". Register it via app.actionSurfaceSource().`
        );
      }

      const surfaceRuntime = resolveSurfaceRuntime(scope);
      const resolvedSurfaceIds = resolver({
        scope,
        sourceName: normalizedSourceName,
        surfaceRuntime
      });

      return normalizeSurfaceIdList(resolvedSurfaceIds, {
        context,
        surfaceRuntime
      });
    }
  });
}

function resolveActionSurfaceSourceRegistry(scope) {
  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function") {
    throw new Error("Action surface source resolution requires scope.has()/make().");
  }
  if (!scope.has(ACTION_SURFACE_SOURCE_REGISTRY_TOKEN)) {
    throw new Error("Action surface source registry is not registered.");
  }
  return scope.make(ACTION_SURFACE_SOURCE_REGISTRY_TOKEN);
}

function resolveActionSurfaceSourceIds(scope, sourceName, { context = "action.surfacesFrom" } = {}) {
  const sourceRegistry = resolveActionSurfaceSourceRegistry(scope);
  return sourceRegistry.resolve(scope, sourceName, { context });
}

function installActionSurfaceSourceRegistrationApi(app) {
  if (typeof app.actionSurfaceSource === "function") {
    return;
  }

  const registerActionSurfaceSource = function registerActionSurfaceSource(sourceName, resolver) {
    const sourceRegistry = resolveActionSurfaceSourceRegistry(this);
    sourceRegistry.register(sourceName, resolver);
    return this;
  };

  Object.defineProperty(app, "actionSurfaceSource", {
    configurable: true,
    writable: true,
    value: registerActionSurfaceSource
  });
}

function ensureActionSurfaceSourceRegistry(app) {
  assertTaggableApp(app, {
    context: "ensureActionSurfaceSourceRegistry"
  });
  if (typeof app.has !== "function") {
    throw new Error("ensureActionSurfaceSourceRegistry requires app.has().");
  }

  if (!app.has(ACTION_SURFACE_SOURCE_REGISTRY_TOKEN)) {
    app.singleton(ACTION_SURFACE_SOURCE_REGISTRY_TOKEN, () => createActionSurfaceSourceRegistry());
  }
  installActionSurfaceSourceRegistrationApi(app);
}

export { ensureActionSurfaceSourceRegistry, resolveActionSurfaceSourceIds };
