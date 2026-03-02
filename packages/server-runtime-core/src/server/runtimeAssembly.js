import { createRuntimeKernel } from "./runtimeKernel.js";

function normalizeRuntimeBundles(bundles) {
  const source = Array.isArray(bundles) ? bundles : [];
  return source.filter((entry) => entry && typeof entry === "object");
}

function mergeRuntimeBundles(bundles = []) {
  const normalizedBundles = normalizeRuntimeBundles(bundles);

  return normalizedBundles.reduce(
    (accumulator, bundle) => ({
      repositoryDefinitions: accumulator.repositoryDefinitions.concat(
        Array.isArray(bundle.repositoryDefinitions) ? bundle.repositoryDefinitions : []
      ),
      serviceDefinitions: accumulator.serviceDefinitions.concat(
        Array.isArray(bundle.serviceDefinitions) ? bundle.serviceDefinitions : []
      ),
      controllerDefinitions: accumulator.controllerDefinitions.concat(
        Array.isArray(bundle.controllerDefinitions) ? bundle.controllerDefinitions : []
      ),
      runtimeServiceIds: accumulator.runtimeServiceIds.concat(
        Array.isArray(bundle.runtimeServiceIds) ? bundle.runtimeServiceIds : []
      )
    }),
    {
      repositoryDefinitions: [],
      serviceDefinitions: [],
      controllerDefinitions: [],
      runtimeServiceIds: []
    }
  );
}

function createRuntimeAssembly({
  bundles = [],
  dependencies = {},
  repositoryDependencies = {},
  serviceDependencies = {},
  controllerDependencies = {}
} = {}) {
  const runtimeBundle = mergeRuntimeBundles(bundles);

  return createRuntimeKernel({
    runtimeBundle,
    dependencies,
    repositoryDependencies,
    serviceDependencies,
    controllerDependencies
  });
}

function normalizeRouteModuleDefinitions(definitions) {
  const source = Array.isArray(definitions) ? definitions : [];
  const normalized = [];
  const seenIds = new Set();

  for (const entry of source) {
    const id = String(entry?.id || "").trim();
    const buildRoutes = entry?.buildRoutes;
    const resolveOptions = entry?.resolveOptions;

    if (!id) {
      throw new TypeError("Route module definition id is required.");
    }
    if (seenIds.has(id)) {
      throw new TypeError(`Route module definition "${id}" is duplicated.`);
    }
    if (typeof buildRoutes !== "function") {
      throw new TypeError(`Route module definition "${id}" buildRoutes must be a function.`);
    }
    if (resolveOptions != null && typeof resolveOptions !== "function") {
      throw new TypeError(`Route module definition "${id}" resolveOptions must be a function when provided.`);
    }

    seenIds.add(id);
    normalized.push({
      id,
      buildRoutes,
      resolveOptions
    });
  }

  return normalized;
}

function buildRoutesFromManifest({ definitions = [], controllers = {}, routeConfig = {}, missingHandler } = {}) {
  const normalizedDefinitions = normalizeRouteModuleDefinitions(definitions);
  const routeList = [];

  for (const definition of normalizedDefinitions) {
    const resolvedOptions = definition.resolveOptions ? definition.resolveOptions(routeConfig || {}) : {};
    const routes = definition.buildRoutes(controllers || {}, {
      ...(resolvedOptions && typeof resolvedOptions === "object" ? resolvedOptions : {}),
      ...(missingHandler ? { missingHandler } : {})
    });

    if (!Array.isArray(routes)) {
      throw new TypeError(`Route module definition "${definition.id}" must return an array.`);
    }

    routeList.push(...routes);
  }

  return routeList;
}

const __testables = {
  normalizeRuntimeBundles,
  normalizeRouteModuleDefinitions
};

export { mergeRuntimeBundles, createRuntimeAssembly, buildRoutesFromManifest, __testables };
