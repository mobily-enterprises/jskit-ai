import { createApplication } from "../server/kernel/lib/application.js";
import { filterRoutesBySurface } from "../shared/surface/runtime.js";

const CLIENT_MODULE_RUNTIME_APP_TOKEN = Symbol.for("jskit.client.runtime.app");
const CLIENT_MODULE_ROUTER_TOKEN = Symbol.for("jskit.client.router");
const CLIENT_MODULE_VUE_APP_TOKEN = Symbol.for("jskit.client.vue.app");
const CLIENT_MODULE_ENV_TOKEN = Symbol.for("jskit.client.env");
const CLIENT_MODULE_SURFACE_RUNTIME_TOKEN = Symbol.for("jskit.client.surface.runtime");
const CLIENT_MODULE_SURFACE_MODE_TOKEN = Symbol.for("jskit.client.surface.mode");
const CLIENT_MODULE_LOGGER_TOKEN = Symbol.for("jskit.client.logger");

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePackageId(value) {
  return String(value || "").trim();
}

function createLogger(logger) {
  if (isRecord(logger)) {
    const info = typeof logger.info === "function" ? logger.info.bind(logger) : console.info.bind(console);
    const warn = typeof logger.warn === "function" ? logger.warn.bind(logger) : console.warn.bind(console);
    const error = typeof logger.error === "function" ? logger.error.bind(logger) : console.error.bind(console);
    return Object.freeze({ info, warn, error });
  }

  return Object.freeze({
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
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
  seenRouteNames
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
  const activeRoutes = filterRoutesBySurface(normalizedRoutes, {
    surfaceRuntime,
    surfaceMode
  });

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
    registeredCount += 1;
  }

  return Object.freeze({
    packageId: normalizedPackageId,
    declaredCount: normalizedRoutes.length,
    registeredCount
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

function resolveModuleProviderClasses(moduleNamespace, packageId) {
  if (!isRecord(moduleNamespace)) {
    return [];
  }

  const explicitProviders = normalizeExplicitProviderClasses(moduleNamespace.clientProviders, packageId);
  if (explicitProviders) {
    return explicitProviders;
  }

  if (typeof moduleNamespace.bootClient === "function") {
    return [];
  }

  const providerClasses = [];
  for (const value of Object.values(moduleNamespace)) {
    if (isProviderClass(value)) {
      providerClasses.push(value);
    }
  }

  return providerClasses;
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
      return Object.freeze({ packageId, module: moduleNamespace });
    })
    .filter(Boolean)
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
}

function createClientRuntimeApp({
  profile = "client",
  app,
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

  runtimeApp.instance(CLIENT_MODULE_RUNTIME_APP_TOKEN, runtimeApp);
  runtimeApp.instance(CLIENT_MODULE_ROUTER_TOKEN, router || null);
  runtimeApp.instance(CLIENT_MODULE_VUE_APP_TOKEN, app || null);
  runtimeApp.instance(CLIENT_MODULE_ENV_TOKEN, isRecord(env) ? { ...env } : {});
  runtimeApp.instance(CLIENT_MODULE_SURFACE_RUNTIME_TOKEN, surfaceRuntime || null);
  runtimeApp.instance(CLIENT_MODULE_SURFACE_MODE_TOKEN, String(surfaceMode || "").trim());
  runtimeApp.instance(CLIENT_MODULE_LOGGER_TOKEN, logger);

  return runtimeApp;
}

async function bootClientModules({
  clientModules = [],
  app,
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

  const log = createLogger(logger);
  const moduleEntries = normalizeClientModuleEntries(clientModules);
  const runtimeApp = createClientRuntimeApp({
    profile: String(surfaceRuntime.normalizeSurfaceMode(surfaceMode) || "client"),
    app,
    router,
    env,
    logger: log,
    surfaceRuntime,
    surfaceMode
  });

  const providerClasses = [];
  const seenProviderIds = new Set();
  for (const entry of moduleEntries) {
    const providers = resolveModuleProviderClasses(entry.module, entry.packageId);
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
  const bootedPackages = [];

  for (const entry of moduleEntries) {
    const moduleRoutes = Array.isArray(entry.module.clientRoutes) ? entry.module.clientRoutes : [];
    const routeResult = registerClientModuleRoutes({
      packageId: entry.packageId,
      routes: moduleRoutes,
      router,
      surfaceRuntime,
      surfaceMode,
      seenRoutePaths,
      seenRouteNames
    });
    routeResults.push(routeResult);

    if (typeof entry.module.bootClient === "function") {
      await entry.module.bootClient(
        Object.freeze({
          packageId: entry.packageId,
          app,
          router,
          runtimeApp,
          surfaceRuntime,
          surfaceMode,
          env: isRecord(env) ? { ...env } : {},
          logger: log,
          registerRoutes(routeList) {
            return registerClientModuleRoutes({
              packageId: entry.packageId,
              routes: routeList,
              router,
              surfaceRuntime,
              surfaceMode,
              seenRoutePaths,
              seenRouteNames
            });
          }
        })
      );
      bootedPackages.push(entry.packageId);
    }
  }

  const registeredRouteCount = routeResults.reduce((sum, result) => sum + result.registeredCount, 0);
  if (moduleEntries.length > 0) {
    log.info(
      {
        modules: moduleEntries.map((entry) => entry.packageId),
        booted: bootedPackages,
        providerCount: providerClasses.length,
        routeCount: registeredRouteCount
      },
      "Booted JSKIT client modules."
    );
  }

  return Object.freeze({
    runtimeApp,
    modules: Object.freeze(moduleEntries.map((entry) => entry.packageId)),
    bootedPackages: Object.freeze(bootedPackages),
    providerCount: providerClasses.length,
    routeResults: Object.freeze(routeResults),
    routeCount: registeredRouteCount
  });
}

export {
  CLIENT_MODULE_RUNTIME_APP_TOKEN,
  CLIENT_MODULE_ROUTER_TOKEN,
  CLIENT_MODULE_VUE_APP_TOKEN,
  CLIENT_MODULE_ENV_TOKEN,
  CLIENT_MODULE_SURFACE_RUNTIME_TOKEN,
  CLIENT_MODULE_SURFACE_MODE_TOKEN,
  CLIENT_MODULE_LOGGER_TOKEN,
  createClientRuntimeApp,
  registerClientModuleRoutes,
  bootClientModules
};
