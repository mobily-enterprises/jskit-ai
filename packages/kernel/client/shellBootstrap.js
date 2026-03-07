import { buildSurfaceAwareRoutes, createFallbackNotFoundRoute, createShellBeforeEachGuard } from "./shellRouting.js";
import { isRecord } from "../shared/support/normalize.js";

function createBaseLogger(logger = console) {
  if (isRecord(logger)) {
    return Object.freeze({
      info: typeof logger.info === "function" ? logger.info.bind(logger) : console.info.bind(console),
      warn: typeof logger.warn === "function" ? logger.warn.bind(logger) : console.warn.bind(console),
      error: typeof logger.error === "function" ? logger.error.bind(logger) : console.error.bind(console),
      debug: typeof logger.debug === "function" ? logger.debug.bind(logger) : () => {}
    });
  }

  return Object.freeze({
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: () => {}
  });
}

function resolveClientBootstrapDebugEnabled({
  env = {},
  debugEnabled = undefined,
  debugEnvKey = "VITE_JSKIT_CLIENT_DEBUG"
} = {}) {
  if (typeof debugEnabled === "boolean") {
    return debugEnabled;
  }
  if (!isRecord(env)) {
    return false;
  }
  return String(env[debugEnvKey] || "").trim() === "1";
}

function createClientBootstrapLogger({
  env = {},
  logger = console,
  debugEnabled = undefined,
  debugEnvKey = "VITE_JSKIT_CLIENT_DEBUG"
} = {}) {
  const baseLogger = createBaseLogger(logger);
  const isDebugEnabled = resolveClientBootstrapDebugEnabled({
    env,
    debugEnabled,
    debugEnvKey
  });
  return Object.freeze({
    info: baseLogger.info,
    warn: baseLogger.warn,
    error: baseLogger.error,
    debug: isDebugEnabled ? baseLogger.info : () => {},
    isDebugEnabled
  });
}

function summarizeRouterRoutes(router) {
  if (!router || typeof router.getRoutes !== "function") {
    return Object.freeze([]);
  }

  return Object.freeze(
    router.getRoutes().map((route) =>
      Object.freeze({
        name: String(route?.name || "").trim(),
        path: String(route?.path || "").trim(),
        scope: String(route?.meta?.jskit?.scope || "").trim()
      })
    )
  );
}

function installAppPlugins(app, appPlugins = []) {
  const plugins = Array.isArray(appPlugins) ? appPlugins : [];
  for (const pluginEntry of plugins) {
    if (!pluginEntry) {
      continue;
    }
    if (Array.isArray(pluginEntry)) {
      const [plugin, ...pluginArgs] = pluginEntry;
      if (!plugin) {
        continue;
      }
      app.use(plugin, ...pluginArgs);
      continue;
    }
    app.use(pluginEntry);
  }
}

function createSurfaceShellRouter({
  createRouter,
  history,
  routes = [],
  surfaceRuntime,
  surfaceMode,
  fallbackRoute = null,
  notFoundComponent = null,
  guard = false
} = {}) {
  if (typeof createRouter !== "function") {
    throw new TypeError("createSurfaceShellRouter requires createRouter().");
  }

  const effectiveFallbackRoute = fallbackRoute || (notFoundComponent ? createFallbackNotFoundRoute(notFoundComponent) : null);
  const activeRoutes = buildSurfaceAwareRoutes({
    routes,
    surfaceRuntime,
    surfaceMode,
    fallbackRoute: effectiveFallbackRoute
  });
  const router = createRouter({
    history,
    routes: activeRoutes
  });

  if (guard !== false) {
    if (!router || typeof router.beforeEach !== "function") {
      throw new TypeError("createSurfaceShellRouter requires router.beforeEach() when guard is enabled.");
    }
    const beforeEachGuard =
      typeof guard === "function"
        ? guard
        : createShellBeforeEachGuard({
            surfaceRuntime,
            ...(isRecord(guard) ? guard : {})
          });
    router.beforeEach(beforeEachGuard);
  }

  return Object.freeze({
    router,
    activeRoutes: Object.freeze([...activeRoutes]),
    fallbackRoute: effectiveFallbackRoute
  });
}

async function bootstrapClientShellApp({
  createApp,
  rootComponent,
  appPlugins = [],
  router,
  bootClientModules,
  surfaceRuntime,
  surfaceMode,
  env = {},
  fallbackRoute = null,
  logger = console,
  createBootstrapLogger = null,
  debugEnabled = undefined,
  debugEnvKey = "VITE_JSKIT_CLIENT_DEBUG",
  debugMessage = "Client modules bootstrapped before router install.",
  onAfterModulesBootstrapped = null,
  mountSelector = "#app"
} = {}) {
  if (typeof createApp !== "function") {
    throw new TypeError("bootstrapClientShellApp requires createApp().");
  }
  if (!router || typeof router.addRoute !== "function") {
    throw new TypeError("bootstrapClientShellApp requires router.addRoute().");
  }
  if (typeof bootClientModules !== "function") {
    throw new TypeError("bootstrapClientShellApp requires bootClientModules().");
  }

  const app = createApp(rootComponent);
  if (!app || typeof app.use !== "function" || typeof app.mount !== "function") {
    throw new TypeError("bootstrapClientShellApp requires createApp() to return a Vue app with use() and mount().");
  }

  installAppPlugins(app, appPlugins);

  const resolvedLogger =
    typeof createBootstrapLogger === "function"
      ? createBootstrapLogger({
          env,
          logger,
          debugEnabled,
          debugEnvKey
        })
      : createClientBootstrapLogger({
          env,
          logger,
          debugEnabled,
          debugEnvKey
        });
  const bootstrapLogger = createBaseLogger(resolvedLogger);

  const clientBootstrap = await bootClientModules({
    app,
    router,
    surfaceRuntime,
    surfaceMode,
    env,
    logger: bootstrapLogger
  });

  const isDebugEnabled =
    typeof resolvedLogger?.isDebugEnabled === "boolean"
      ? resolvedLogger.isDebugEnabled
      : resolveClientBootstrapDebugEnabled({
          env,
          debugEnabled,
          debugEnvKey
        });
  if (isDebugEnabled) {
    bootstrapLogger.info(
      {
        bootstrap: {
          modules: clientBootstrap?.modules || [],
          bootedPackages: clientBootstrap?.bootedPackages || [],
          providerCount: Number(clientBootstrap?.providerCount || 0),
          routeCount: Number(clientBootstrap?.routeCount || 0)
        },
        routerRoutesBeforeInstall: summarizeRouterRoutes(router),
        currentPath: typeof window !== "undefined" ? String(window.location?.pathname || "") : ""
      },
      String(debugMessage || "").trim() || "Client modules bootstrapped before router install."
    );
  }

  if (fallbackRoute?.name && typeof router.addRoute === "function") {
    if (typeof router.hasRoute === "function" && router.hasRoute(fallbackRoute.name) && typeof router.removeRoute === "function") {
      router.removeRoute(fallbackRoute.name);
    }
    router.addRoute(fallbackRoute);
  }

  if (typeof onAfterModulesBootstrapped === "function") {
    await onAfterModulesBootstrapped(
      Object.freeze({
        app,
        router,
        clientBootstrap,
        surfaceRuntime,
        surfaceMode,
        env: isRecord(env) ? { ...env } : {},
        logger: bootstrapLogger,
        debugEnabled: isDebugEnabled
      })
    );
  }

  app.use(router);
  if (typeof router.isReady === "function") {
    await router.isReady();
  }
  app.mount(mountSelector);

  return Object.freeze({
    app,
    router,
    clientBootstrap,
    logger: bootstrapLogger,
    debugEnabled: isDebugEnabled
  });
}

export {
  resolveClientBootstrapDebugEnabled,
  createClientBootstrapLogger,
  createSurfaceShellRouter,
  bootstrapClientShellApp
};
