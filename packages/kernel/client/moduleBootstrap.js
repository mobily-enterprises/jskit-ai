import { createCapabilityRuntime, defineProvider } from "../shared/capabilities/index.js";
import { filterRoutesBySurface } from "../shared/surface/runtime.js";
import { isRecord } from "../shared/support/normalize.js";
import { createClientComponentRegistry } from "./componentRegistry.js";
import { normalizePackageMetadataClientProviders, normalizePackageMetadataUiRoutes } from "./packageMetadataSections.js";
import { createStructuredLogger, summarizeRouterRoutes } from "./logging.js";

function normalizePackageId(value) {
  return String(value || "").trim();
}

function toRouteSnapshot(route) {
  const metaJskit = isRecord(route?.meta?.jskit) ? route.meta.jskit : {};
  return Object.freeze({
    id: String(route?.id || "").trim(),
    name: String(route?.name || "").trim(),
    path: String(route?.path || "").trim(),
    scope: String(route?.scope || "").trim(),
    surface: String(route?.surface || "").trim(),
    metaScope: String(metaJskit.scope || "").trim(),
    metaSurface: String(metaJskit.surface || "").trim()
  });
}

function isRouteComponent(value) {
  if (typeof value === "function") {
    return true;
  }
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeRoute(route, { packageId, index }) {
  if (!isRecord(route)) {
    throw new TypeError(`Client route #${index} from ${packageId} must be an object.`);
  }

  const id = String(route.id || "").trim();
  const path = String(route.path || "").trim();
  if (!id) {
    throw new Error(`Client route #${index} from ${packageId} requires id.`);
  }
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`Client route "${id}" from ${packageId} must use an absolute path.`);
  }

  if (!isRouteComponent(route.component)) {
    throw new Error(`Client route "${id}" from ${packageId} requires component.`);
  }

  const scope = String(route.scope || "surface")
    .trim()
    .toLowerCase();
  if (scope !== "global" && scope !== "surface") {
    throw new Error(`Client route "${id}" from ${packageId} has invalid scope "${scope}".`);
  }

  const surface = String(route.surface || "")
    .trim()
    .toLowerCase();
  const baseMeta = isRecord(route.meta) ? route.meta : {};
  const baseMetaJskit = isRecord(baseMeta.jskit) ? baseMeta.jskit : {};

  return Object.freeze({
    ...route,
    id,
    path,
    scope,
    ...(surface ? { surface } : {}),
    meta: {
      ...baseMeta,
      jskit: {
        ...baseMetaJskit,
        packageId,
        routeId: id,
        scope,
        ...(surface ? { surface } : {})
      }
    }
  });
}

function normalizeRouteList(routes, { packageId }) {
  const entries = Array.isArray(routes) ? routes : [];
  return Object.freeze(
    entries.map((route, index) => normalizeRoute(route, { packageId, index: index + 1 }))
  );
}

function toVueRouteRecord(route) {
  const nextMeta = isRecord(route.meta) ? { ...route.meta } : undefined;
  const routeRecord = {
    path: route.path,
    component: route.component,
    ...(route.name ? { name: route.name } : {}),
    ...(route.props !== undefined ? { props: route.props } : {}),
    ...(route.redirect !== undefined ? { redirect: route.redirect } : {}),
    ...(route.children !== undefined ? { children: route.children } : {}),
    ...(nextMeta ? { meta: nextMeta } : {})
  };

  return Object.freeze(routeRecord);
}

function registerClientModuleRoutes({
  packageId,
  routes = [],
  router,
  surfaceRuntime,
  surfaceMode,
  seenRoutePaths,
  seenRouteNames,
  logger = null,
  source = "module",
  packageMetadataRouteDeclarations = null
} = {}) {
  const normalizedPackageId = normalizePackageId(packageId);
  if (!normalizedPackageId) {
    throw new TypeError("registerClientModuleRoutes requires packageId.");
  }
  if (!router || typeof router.addRoute !== "function") {
    throw new TypeError("registerClientModuleRoutes requires router.addRoute().");
  }
  if (!surfaceRuntime || typeof surfaceRuntime !== "object") {
    throw new TypeError("registerClientModuleRoutes requires surfaceRuntime.");
  }

  const normalizedRoutes = normalizeRouteList(routes, { packageId: normalizedPackageId });
  assertRoutesDeclaredInPackageMetadata({
    packageId: normalizedPackageId,
    source,
    normalizedRoutes,
    packageMetadataRouteDeclarations
  });
  const activeRoutes = filterRoutesBySurface(normalizedRoutes, {
    surfaceRuntime,
    surfaceMode
  });
  const log = createStructuredLogger(logger);
  log.debug(
    {
      packageId: normalizedPackageId,
      source,
      surfaceMode: String(surfaceMode || "").trim(),
      declaredRoutes: normalizedRoutes.map(toRouteSnapshot),
      activeRoutes: activeRoutes.map(toRouteSnapshot)
    },
    "Client route registration analysis."
  );

  const declaredPaths = normalizedRoutes.map((route) => route.path);
  const activePaths = activeRoutes.map((route) => route.path);

  let registeredCount = 0;
  for (const route of activeRoutes) {
    const normalizedPath = String(route.path || "").trim();
    if (seenRoutePaths.has(normalizedPath)) {
      throw new Error(`Client route path "${normalizedPath}" is duplicated (package ${normalizedPackageId}).`);
    }

    const normalizedName = String(route.name || "").trim();
    if (normalizedName) {
      if (seenRouteNames.has(normalizedName)) {
        throw new Error(`Client route name "${normalizedName}" is duplicated (package ${normalizedPackageId}).`);
      }
      seenRouteNames.add(normalizedName);
    }

    seenRoutePaths.add(normalizedPath);
    router.addRoute(toVueRouteRecord(route));
    log.debug(
      {
        packageId: normalizedPackageId,
        source,
        route: toRouteSnapshot(route)
      },
      "Added client route to router."
    );
    registeredCount += 1;
  }

  return Object.freeze({
    packageId: normalizedPackageId,
    source,
    declaredCount: normalizedRoutes.length,
    registeredCount,
    declaredPaths: Object.freeze(declaredPaths),
    activePaths: Object.freeze(activePaths)
  });
}

function resolvePackageMetadataProviders(moduleNamespace, packageId, packageMetadataClientProviders = []) {
  const providers = [];
  const seenProviderIds = new Set();

  for (const providerDeclaration of packageMetadataClientProviders) {
    const exportName = String(providerDeclaration?.export || "").trim();
    if (!exportName) {
      continue;
    }

    const providerValue = moduleNamespace?.[exportName];
    let provider = null;
    try {
      provider = defineProvider(providerValue);
    } catch (error) {
      throw new TypeError(
        `Client module ${packageId} packageMetadata provider export "${exportName}" must be a capability provider: ${error.message}`,
        { cause: error }
      );
    }

    const providerId = provider.id;

    if (seenProviderIds.has(providerId)) {
      continue;
    }
    seenProviderIds.add(providerId);
    providers.push(provider);
  }

  return providers;
}

function resolveModuleProviders(moduleNamespace, packageId, packageMetadataClientProviders = []) {
  if (!isRecord(moduleNamespace)) {
    return [];
  }
  return resolvePackageMetadataProviders(moduleNamespace, packageId, packageMetadataClientProviders);
}

function buildPackageMetadataRouteDeclarationIndex({ packageId, packageMetadataUiRoutes = [] } = {}) {
  const normalizedPackageId = normalizePackageId(packageId);
  const packageMetadataRoutes = normalizePackageMetadataUiRoutes(packageMetadataUiRoutes);
  const byId = new Map();

  for (const packageMetadataRoute of packageMetadataRoutes) {
    const routeId = String(packageMetadataRoute.id || "").trim();
    const routePath = String(packageMetadataRoute.path || "").trim();
    const routeScope = String(packageMetadataRoute.scope || "surface")
      .trim()
      .toLowerCase();
    if (!routeId || !routePath) {
      continue;
    }

    if (byId.has(routeId)) {
      const existingRoute = byId.get(routeId);
      if (existingRoute.path !== routePath || existingRoute.scope !== routeScope) {
        throw new Error(
          `PackageMetadata ui routes for ${normalizedPackageId} define duplicate id "${routeId}" with conflicting declarations.`
        );
      }
      continue;
    }

    byId.set(
      routeId,
      Object.freeze({
        id: routeId,
        path: routePath,
        scope: routeScope
      })
    );
  }

  return Object.freeze({ byId });
}

function assertRoutesDeclaredInPackageMetadata({
  packageId,
  source,
  normalizedRoutes = [],
  packageMetadataRouteDeclarations = null
} = {}) {
  const normalizedSource = String(source || "").trim();
  if (normalizedSource !== "clientRoutes") {
    return;
  }

  const byId = packageMetadataRouteDeclarations?.byId instanceof Map ? packageMetadataRouteDeclarations.byId : new Map();
  const normalizedPackageId = normalizePackageId(packageId);

  for (const route of normalizedRoutes) {
    const routeId = String(route?.id || "").trim();
    const routePath = String(route?.path || "").trim();
    const routeScope = String(route?.scope || "surface")
      .trim()
      .toLowerCase();
    if (routeScope !== "global") {
      continue;
    }

    const declaredRoute = byId.get(routeId);
    if (!declaredRoute) {
      throw new Error(
        `Global client route "${routeId}" from ${normalizedPackageId} (${source}) must be declared in metadata.ui.routes (id "${routeId}", path "${routePath}") with scope:"global" and autoRegister:false.`
      );
    }
    if (String(declaredRoute.path || "").trim() !== routePath) {
      throw new Error(
        `Global client route "${routeId}" from ${normalizedPackageId} (${source}) path "${routePath}" does not match packageMetadata metadata.ui.routes path "${declaredRoute.path}".`
      );
    }
    if (String(declaredRoute.scope || "").trim().toLowerCase() !== "global") {
      throw new Error(
        `Global client route "${routeId}" from ${normalizedPackageId} (${source}) must be declared with scope:"global" in metadata.ui.routes.`
      );
    }
  }
}

function resolvePackageMetadataClientRoutes({
  packageId,
  packageMetadataUiRoutes = [],
  routeComponents = {},
  logger = null
} = {}) {
  const normalizedPackageId = normalizePackageId(packageId);
  const packageMetadataRoutes = normalizePackageMetadataUiRoutes(packageMetadataUiRoutes);
  if (packageMetadataRoutes.length < 1) {
    return Object.freeze([]);
  }
  if (!isRecord(routeComponents)) {
    throw new TypeError(
      `Client module ${normalizedPackageId} declares packageMetadata ui routes but does not export a routeComponents map.`
    );
  }

  const log = createStructuredLogger(logger);
  const routes = [];
  const skippedRoutes = [];
  for (const packageMetadataRoute of packageMetadataRoutes) {
    const routeId = String(packageMetadataRoute.id || "").trim();
    const routePath = String(packageMetadataRoute.path || "").trim();
    const autoRegister = packageMetadataRoute.autoRegister !== false;
    if (!autoRegister) {
      skippedRoutes.push(
        Object.freeze({
          id: routeId,
          path: routePath,
          reason: "autoRegister=false"
        })
      );
      continue;
    }

    if (!routeId || !routePath) {
      throw new Error(
        `PackageMetadata ui route from ${normalizedPackageId} requires id and path when autoRegister is enabled.`
      );
    }

    const componentKey = String(packageMetadataRoute.componentKey || "").trim();
    if (!componentKey) {
      throw new Error(
        `PackageMetadata ui route "${routeId}" from ${normalizedPackageId} requires componentKey when autoRegister is enabled.`
      );
    }

    const routeComponent = routeComponents[componentKey];
    if (!isRouteComponent(routeComponent)) {
      throw new Error(
        `PackageMetadata ui route "${routeId}" from ${normalizedPackageId} references unknown routeComponents key "${componentKey}".`
      );
    }

    const scope = String(packageMetadataRoute.scope || "surface")
      .trim()
      .toLowerCase();
    const surface = String(packageMetadataRoute.surface || "")
      .trim()
      .toLowerCase();
    const guard = isRecord(packageMetadataRoute.guard) ? { ...packageMetadataRoute.guard } : {};
    const baseMeta = isRecord(packageMetadataRoute.meta) ? { ...packageMetadataRoute.meta } : {};
    const baseMetaJskit = isRecord(baseMeta.jskit) ? { ...baseMeta.jskit } : {};

    routes.push(
      Object.freeze({
        id: routeId,
        path: routePath,
        scope,
        ...(surface ? { surface } : {}),
        ...(String(packageMetadataRoute.name || "").trim() ? { name: String(packageMetadataRoute.name || "").trim() } : {}),
        component: routeComponent,
        meta: {
          ...baseMeta,
          ...(Object.keys(guard).length > 0 ? { guard } : {}),
          jskit: {
            ...baseMetaJskit,
            packageId: normalizedPackageId,
            routeId,
            scope,
            componentKey,
            source: "packageMetadata.ui.routes",
            ...(surface ? { surface } : {})
          }
        }
      })
    );
  }

  log.debug(
    {
      packageId: normalizedPackageId,
      packageMetadataRouteCount: packageMetadataRoutes.length,
      autoRegisterRouteCount: routes.length,
      skippedRoutes
    },
    "Processed packageMetadata ui routes."
  );

  return Object.freeze(routes);
}

function normalizeClientModuleEntries(clientModules) {
  if (!Array.isArray(clientModules)) {
    return [];
  }

  return clientModules
    .map((entry) => {
      const packageId = normalizePackageId(entry?.packageId);
      const moduleNamespace = isRecord(entry?.module) ? entry.module : null;
      if (!packageId || !moduleNamespace) {
        return null;
      }
      return Object.freeze({
        packageId,
        module: moduleNamespace,
        packageMetadataUiRoutes: normalizePackageMetadataUiRoutes(entry?.packageMetadataUiRoutes),
        packageMetadataClientProviders: normalizePackageMetadataClientProviders(entry?.packageMetadataClientProviders)
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
}

function createClientRuntime({
  profile = "client",
  providers = [],
  app,
  pinia = null,
  queryClient = null,
  router,
  env,
  logger,
  surfaceRuntime,
  surfaceMode
} = {}) {
  const components = createClientComponentRegistry();
  const runtime = createCapabilityRuntime({
    profile,
    providers,
    inputs: {
      "client.vue": app || null,
      "client.router": router || null,
      "client.pinia": pinia,
      "client.query": queryClient,
      "client.env": Object.freeze({ ...(isRecord(env) ? env : {}) }),
      "client.surface": surfaceRuntime || null,
      "client.surface-mode": String(surfaceMode || "").trim(),
      "client.logger": logger,
      "client.components": components
    }
  });
  return Object.freeze({ runtime, components });
}

async function bootClientModules({
  clientModules = [],
  app,
  pinia = null,
  queryClient = null,
  router,
  surfaceRuntime,
  surfaceMode,
  env,
  logger = console
} = {}) {
  if (!router || typeof router.addRoute !== "function") {
    throw new TypeError("bootClientModules requires router.addRoute().");
  }
  if (!surfaceRuntime || typeof surfaceRuntime.normalizeSurfaceMode !== "function") {
    throw new TypeError("bootClientModules requires surfaceRuntime.normalizeSurfaceMode().");
  }

  const log = createStructuredLogger(logger);
  const moduleEntries = normalizeClientModuleEntries(clientModules);
  const providers = [];
  const seenProviderIds = new Set();
  log.debug(
    {
      surfaceMode: String(surfaceMode || "").trim(),
      normalizedSurfaceMode: String(surfaceRuntime.normalizeSurfaceMode(surfaceMode) || "").trim(),
      moduleCount: moduleEntries.length,
      modules: moduleEntries.map((entry) => entry.packageId)
    },
    "Starting JSKIT client module bootstrap."
  );
  for (const entry of moduleEntries) {
    const moduleProviders = resolveModuleProviders(entry.module, entry.packageId, entry.packageMetadataClientProviders);
    log.debug(
      {
        packageId: entry.packageId,
        providerExports: moduleProviders.map((provider) => provider.id),
        hasClientRoutes: Array.isArray(entry.module.clientRoutes) && entry.module.clientRoutes.length > 0
      },
      "Discovered client module capabilities."
    );
    for (const provider of moduleProviders) {
      const providerId = provider.id;
      if (seenProviderIds.has(providerId)) {
        throw new Error(`Client provider id "${providerId}" is duplicated.`);
      }
      seenProviderIds.add(providerId);
      providers.push(provider);
    }
  }

  const clientRuntime = createClientRuntime({
    profile: String(surfaceRuntime.normalizeSurfaceMode(surfaceMode) || "client"),
    providers,
    app,
    pinia,
    queryClient,
    router,
    env,
    logger: log,
    surfaceRuntime,
    surfaceMode
  });
  await clientRuntime.runtime.start();

  const seenRoutePaths = new Set();
  const seenRouteNames = new Set();
  const routeResults = [];
  const registerRoutesForEntry = (routeList, packageId, source = "module", packageMetadataRouteDeclarations = null) => {
    if (!routeList || routeList.length === 0) {
      return null;
    }
    const result = registerClientModuleRoutes({
      packageId,
      routes: routeList,
      router,
      surfaceRuntime,
      surfaceMode,
      seenRoutePaths,
      seenRouteNames,
      logger: log,
      source,
      packageMetadataRouteDeclarations
    });
    log.debug(
      {
        packageId,
        source,
        declaredPaths: result.declaredPaths,
        activePaths: result.activePaths,
        registeredCount: result.registeredCount
      },
      "Registered client module routes."
    );
    log.debug(
      {
        packageId,
        source,
        routerRoutes: summarizeRouterRoutes(router)
      },
      "Router route table after client route registration."
    );
    routeResults.push(result);
    return result;
  };
  for (const entry of moduleEntries) {
    const packageMetadataRouteDeclarations = buildPackageMetadataRouteDeclarationIndex({
      packageId: entry.packageId,
      packageMetadataUiRoutes: entry.packageMetadataUiRoutes
    });
    const packageMetadataRoutes = resolvePackageMetadataClientRoutes({
      packageId: entry.packageId,
      packageMetadataUiRoutes: entry.packageMetadataUiRoutes,
      routeComponents: entry.module.routeComponents,
      logger: log
    });
    registerRoutesForEntry(packageMetadataRoutes, entry.packageId, "packageMetadata.ui.routes", packageMetadataRouteDeclarations);

    const moduleRoutes = Array.isArray(entry.module.clientRoutes) ? entry.module.clientRoutes : [];
    registerRoutesForEntry(moduleRoutes, entry.packageId, "clientRoutes", packageMetadataRouteDeclarations);

  }

  const registeredRouteCount = routeResults.reduce((sum, result) => sum + result.registeredCount, 0);
  if (moduleEntries.length > 0) {
    log.debug(
      {
        modules: moduleEntries.map((entry) => entry.packageId),
        providerCount: providers.length,
        routeCount: registeredRouteCount
      },
      "Booted JSKIT client modules."
    );
    log.debug(
      {
        routerRoutes: summarizeRouterRoutes(router),
        currentPath: typeof window !== "undefined" ? String(window.location?.pathname || "") : ""
      },
      "JSKIT client bootstrap final route table."
    );
  }

  return Object.freeze({
    runtime: clientRuntime.runtime,
    components: clientRuntime.components,
    modules: Object.freeze(moduleEntries.map((entry) => entry.packageId)),
    providerCount: providers.length,
    routeResults: Object.freeze(routeResults),
    routeCount: registeredRouteCount
  });
}

export { bootClientModules };
