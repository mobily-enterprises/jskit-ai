import { createApplication } from "../shared/runtime/application.js";
import { filterRoutesBySurface } from "../shared/surface/runtime.js";
import { isRecord } from "../shared/support/normalize.js";
import { normalizeDescriptorClientProviders, normalizeDescriptorUiRoutes } from "./descriptorSections.js";
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
  descriptorRouteDeclarations = null
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
  assertRoutesDeclaredInDescriptor({
    packageId: normalizedPackageId,
    source,
    normalizedRoutes,
    descriptorRouteDeclarations
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

function isProviderClass(candidate) {
  if (typeof candidate !== "function") {
    return false;
  }

  const providerId = String(candidate.id || "").trim();
  if (!providerId) {
    return false;
  }

  const prototype = candidate.prototype;
  if (!prototype || typeof prototype !== "object") {
    return false;
  }

  return (
    typeof prototype.register === "function" ||
    typeof prototype.boot === "function" ||
    typeof prototype.shutdown === "function"
  );
}

function normalizeExplicitProviderClasses(value, packageId) {
  if (!Array.isArray(value)) {
    return null;
  }

  const providers = [];
  for (const candidate of value) {
    if (!isProviderClass(candidate)) {
      throw new TypeError(`Client module ${packageId} exports invalid clientProviders entry.`);
    }
    providers.push(candidate);
  }
  return providers;
}

function resolveDescriptorProviderClasses(moduleNamespace, packageId, descriptorClientProviders = []) {
  const providers = [];
  const seenProviderIds = new Set();

  for (const providerDeclaration of descriptorClientProviders) {
    const exportName = String(providerDeclaration?.export || "").trim();
    if (!exportName) {
      continue;
    }

    const providerClass = moduleNamespace?.[exportName];
    if (!isProviderClass(providerClass)) {
      throw new TypeError(
        `Client module ${packageId} descriptor provider export "${exportName}" is missing or invalid in "${packageId}/client".`
      );
    }

    const providerId = String(providerClass.id || "").trim();
    if (!providerId) {
      throw new TypeError(`Client module ${packageId} descriptor provider "${exportName}" requires static id.`);
    }

    if (seenProviderIds.has(providerId)) {
      continue;
    }
    seenProviderIds.add(providerId);
    providers.push(providerClass);
  }

  return providers;
}

function resolveModuleProviderClasses(moduleNamespace, packageId, descriptorClientProviders = []) {
  if (!isRecord(moduleNamespace)) {
    return [];
  }

  const explicitProviders = normalizeExplicitProviderClasses(moduleNamespace.clientProviders, packageId);
  if (explicitProviders) {
    return explicitProviders;
  }

  if (Array.isArray(descriptorClientProviders) && descriptorClientProviders.length > 0) {
    return resolveDescriptorProviderClasses(moduleNamespace, packageId, descriptorClientProviders);
  }
  return [];
}

function buildDescriptorRouteDeclarationIndex({ packageId, descriptorUiRoutes = [] } = {}) {
  const normalizedPackageId = normalizePackageId(packageId);
  const descriptorRoutes = normalizeDescriptorUiRoutes(descriptorUiRoutes);
  const byId = new Map();

  for (const descriptorRoute of descriptorRoutes) {
    const routeId = String(descriptorRoute.id || "").trim();
    const routePath = String(descriptorRoute.path || "").trim();
    const routeScope = String(descriptorRoute.scope || "surface")
      .trim()
      .toLowerCase();
    if (!routeId || !routePath) {
      continue;
    }

    if (byId.has(routeId)) {
      const existingRoute = byId.get(routeId);
      if (existingRoute.path !== routePath || existingRoute.scope !== routeScope) {
        throw new Error(
          `Descriptor ui routes for ${normalizedPackageId} define duplicate id "${routeId}" with conflicting declarations.`
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

function assertRoutesDeclaredInDescriptor({
  packageId,
  source,
  normalizedRoutes = [],
  descriptorRouteDeclarations = null
} = {}) {
  const normalizedSource = String(source || "").trim();
  if (normalizedSource !== "clientRoutes") {
    return;
  }

  const byId = descriptorRouteDeclarations?.byId instanceof Map ? descriptorRouteDeclarations.byId : new Map();
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
        `Global client route "${routeId}" from ${normalizedPackageId} (${source}) path "${routePath}" does not match descriptor metadata.ui.routes path "${declaredRoute.path}".`
      );
    }
    if (String(declaredRoute.scope || "").trim().toLowerCase() !== "global") {
      throw new Error(
        `Global client route "${routeId}" from ${normalizedPackageId} (${source}) must be declared with scope:"global" in metadata.ui.routes.`
      );
    }
  }
}

function resolveDescriptorClientRoutes({
  packageId,
  descriptorUiRoutes = [],
  routeComponents = {},
  logger = null
} = {}) {
  const normalizedPackageId = normalizePackageId(packageId);
  const descriptorRoutes = normalizeDescriptorUiRoutes(descriptorUiRoutes);
  if (descriptorRoutes.length < 1) {
    return Object.freeze([]);
  }
  if (!isRecord(routeComponents)) {
    throw new TypeError(
      `Client module ${normalizedPackageId} declares descriptor ui routes but does not export a routeComponents map.`
    );
  }

  const log = createStructuredLogger(logger);
  const routes = [];
  const skippedRoutes = [];
  for (const descriptorRoute of descriptorRoutes) {
    const routeId = String(descriptorRoute.id || "").trim();
    const routePath = String(descriptorRoute.path || "").trim();
    const autoRegister = descriptorRoute.autoRegister !== false;
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
        `Descriptor ui route from ${normalizedPackageId} requires id and path when autoRegister is enabled.`
      );
    }

    const componentKey = String(descriptorRoute.componentKey || "").trim();
    if (!componentKey) {
      throw new Error(
        `Descriptor ui route "${routeId}" from ${normalizedPackageId} requires componentKey when autoRegister is enabled.`
      );
    }

    const routeComponent = routeComponents[componentKey];
    if (!isRouteComponent(routeComponent)) {
      throw new Error(
        `Descriptor ui route "${routeId}" from ${normalizedPackageId} references unknown routeComponents key "${componentKey}".`
      );
    }

    const scope = String(descriptorRoute.scope || "surface")
      .trim()
      .toLowerCase();
    const surface = String(descriptorRoute.surface || "")
      .trim()
      .toLowerCase();
    const guard = isRecord(descriptorRoute.guard) ? { ...descriptorRoute.guard } : {};
    const baseMeta = isRecord(descriptorRoute.meta) ? { ...descriptorRoute.meta } : {};
    const baseMetaJskit = isRecord(baseMeta.jskit) ? { ...baseMeta.jskit } : {};

    routes.push(
      Object.freeze({
        id: routeId,
        path: routePath,
        scope,
        ...(surface ? { surface } : {}),
        ...(String(descriptorRoute.name || "").trim() ? { name: String(descriptorRoute.name || "").trim() } : {}),
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
            source: "descriptor.ui.routes",
            ...(surface ? { surface } : {})
          }
        }
      })
    );
  }

  log.debug(
    {
      packageId: normalizedPackageId,
      descriptorRouteCount: descriptorRoutes.length,
      autoRegisterRouteCount: routes.length,
      skippedRoutes
    },
    "Processed descriptor ui routes."
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
        descriptorUiRoutes: normalizeDescriptorUiRoutes(entry?.descriptorUiRoutes),
        descriptorClientProviders: normalizeDescriptorClientProviders(entry?.descriptorClientProviders)
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
}

function createClientRuntimeApp({
  profile = "client",
  app,
  pinia = null,
  router,
  env,
  logger,
  surfaceRuntime,
  surfaceMode
} = {}) {
  const runtimeApp = createApplication({
    profile,
    strict: true
  });

  runtimeApp.instance("jskit.client.runtime.app", runtimeApp);
  runtimeApp.instance("jskit.client.router", router || null);
  runtimeApp.instance("jskit.client.vue.app", app || null);
  runtimeApp.instance("jskit.client.pinia", pinia);
  runtimeApp.instance("jskit.client.env", isRecord(env) ? { ...env } : {});
  runtimeApp.instance("jskit.client.surface.runtime", surfaceRuntime || null);
  runtimeApp.instance("jskit.client.surface.mode", String(surfaceMode || "").trim());
  runtimeApp.instance("jskit.client.logger", logger);

  return runtimeApp;
}

async function bootClientModules({
  clientModules = [],
  app,
  pinia = null,
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
  const runtimeApp = createClientRuntimeApp({
    profile: String(surfaceRuntime.normalizeSurfaceMode(surfaceMode) || "client"),
    app,
    pinia,
    router,
    env,
    logger: log,
    surfaceRuntime,
    surfaceMode
  });

  const providerClasses = [];
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
    const providers = resolveModuleProviderClasses(entry.module, entry.packageId, entry.descriptorClientProviders);
    log.debug(
      {
        packageId: entry.packageId,
        providerExports: providers.map((providerClass) => String(providerClass.id || providerClass.name || "").trim()),
        hasClientRoutes: Array.isArray(entry.module.clientRoutes) && entry.module.clientRoutes.length > 0
      },
      "Discovered client module capabilities."
    );
    for (const providerClass of providers) {
      const providerId = String(providerClass.id || "").trim();
      if (seenProviderIds.has(providerId)) {
        throw new Error(`Client provider id "${providerId}" is duplicated.`);
      }
      seenProviderIds.add(providerId);
      providerClasses.push(providerClass);
    }
  }

  if (providerClasses.length > 0) {
    await runtimeApp.start({ providers: providerClasses });
  }

  const seenRoutePaths = new Set();
  const seenRouteNames = new Set();
  const routeResults = [];
  const registerRoutesForEntry = (routeList, packageId, source = "module", descriptorRouteDeclarations = null) => {
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
      descriptorRouteDeclarations
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
    const descriptorRouteDeclarations = buildDescriptorRouteDeclarationIndex({
      packageId: entry.packageId,
      descriptorUiRoutes: entry.descriptorUiRoutes
    });
    const descriptorRoutes = resolveDescriptorClientRoutes({
      packageId: entry.packageId,
      descriptorUiRoutes: entry.descriptorUiRoutes,
      routeComponents: entry.module.routeComponents,
      logger: log
    });
    registerRoutesForEntry(descriptorRoutes, entry.packageId, "descriptor.ui.routes", descriptorRouteDeclarations);

    const moduleRoutes = Array.isArray(entry.module.clientRoutes) ? entry.module.clientRoutes : [];
    registerRoutesForEntry(moduleRoutes, entry.packageId, "clientRoutes", descriptorRouteDeclarations);

  }

  const registeredRouteCount = routeResults.reduce((sum, result) => sum + result.registeredCount, 0);
  if (moduleEntries.length > 0) {
    log.debug(
      {
        modules: moduleEntries.map((entry) => entry.packageId),
        providerCount: providerClasses.length,
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
    runtimeApp,
    modules: Object.freeze(moduleEntries.map((entry) => entry.packageId)),
    providerCount: providerClasses.length,
    routeResults: Object.freeze(routeResults),
    routeCount: registeredRouteCount
  });
}

export { bootClientModules };
