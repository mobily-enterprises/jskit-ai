import { buildSurfaceAwareRoutes, createFallbackNotFoundRoute, createShellBeforeEachGuard } from "./shellRouting.js";
import { isRecord } from "../shared/support/normalize.js";
import { setClientAppConfig } from "./appConfig.js";
import { pagePathname, pageWindow } from "./browser.js";
import { setJskitI18n } from "./i18n.js";
import { createStructuredLogger, summarizeRouterRoutes } from "./logging.js";

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

function ignoreDebug() {}

function ignoreBootstrapStep() {}

/**
 * The bootstrap logger: the application's logger, with debug output on when
 * debugEnabled, or the debugEnvKey flag in env, says so.
 * @param {object} options
 * @param {Record<string, any>} [options.env]
 * @param {import("../server/types.js").RuntimeLogger} options.logger
 * @param {boolean} [options.debugEnabled]
 * @param {string} [options.debugEnvKey]
 */
function createClientBootstrapLogger({
  env = {},
  logger,
  debugEnabled = undefined,
  debugEnvKey = "VITE_JSKIT_CLIENT_DEBUG"
}) {
  const baseLogger = createStructuredLogger(logger);
  const isDebugEnabled = resolveClientBootstrapDebugEnabled({
    env,
    debugEnabled,
    debugEnvKey
  });
  return Object.freeze({
    info: baseLogger.info,
    warn: baseLogger.warn,
    error: baseLogger.error,
    debug: isDebugEnabled ? baseLogger.info : ignoreDebug,
    isDebugEnabled
  });
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

function isSurfaceRootRecord(record) {
  return Boolean(record?.meta?.jskit?.surface);
}

// A record that draws a component: a layout hosting tabs or sub-views, not a component-less record grouping the
// routes of a folder (bookings/, contacts/) as file routing creates them.
function hostsChildViews(record) {
  return Object.values(record?.components || {}).some(Boolean);
}

/**
 * Whether two locations are the same page: the same path, or two children
 * (tabs, sub-views) of one page record below the surface root. A page that hosts
 * tabs or sub-views keeps its own record, with its component, above the changing
 * child, so the two locations share a non-leaf record below the surface root that
 * draws a component. A record that only groups a folder's routes draws none, so
 * two pages in one folder are different pages.
 * @param {import("vue-router").RouteLocationNormalized} to
 * @param {import("vue-router").RouteLocationNormalized} from
 */
function staysOnSamePage(to, from) {
  if (to.path === from.path) {
    return true;
  }
  const fromParents = new Set((from.matched || []).slice(0, -1));
  return (to.matched || [])
    .slice(0, -1)
    .some((record) => fromParents.has(record) && !isSurfaceRootRecord(record) && hostsChildViews(record));
}

// The hash target's scroll-margin-top, which the router's own scroll to an element leaves out (the browser's
// scrollIntoView honours it), so a target with a margin for a sticky bar stays clear of it.
function hashScrollMargin(hash) {
  const browserWindow = pageWindow();
  const target = browserWindow ? browserWindow.document.getElementById(hash.slice(1)) : null;
  return target ? Number.parseFloat(browserWindow.getComputedStyle(target).scrollMarginTop) || 0 : 0;
}

/**
 * JSKIT's default router scroll behaviour: Back/Forward restore the saved
 * position, a new screen opens at the top (or at its hash target, below the
 * target's scroll-margin-top), and tab, query or hash changes within the same
 * page keep the current position. A navigation that carries
 * `state: { restoreScroll: { left, top } }`, as the shell's Up does when it
 * returns to a page, opens at that position.
 */
function shellScrollBehavior(to, from, savedPosition) {
  if (savedPosition) {
    return savedPosition;
  }
  if (staysOnSamePage(to, from)) {
    return false;
  }
  const restoreScroll = pageWindow()?.history?.state?.restoreScroll;
  if (isRecord(restoreScroll)) {
    return {
      left: Number(restoreScroll.left) || 0,
      top: Number(restoreScroll.top) || 0
    };
  }
  if (to.hash) {
    return { el: to.hash, top: hashScrollMargin(to.hash) };
  }
  return { top: 0 };
}

/**
 * The application's router: its routes filtered by surface, a fallback route last and, unless guard is false, a
 * beforeEach guard, either an application's own function or the shell guard built from guard's options.
 * @param {object} options
 * @param {(options: import("vue-router").RouterOptions) => import("./types.js").ClientRouter} options.createRouter
 * @param {import("vue-router").RouterHistory} options.history
 * @param {readonly import("./types.js").ClientRouteRecord[]} options.routes
 * @param {import("./types.js").ClientSurfaceRuntime} options.surfaceRuntime
 * @param {import("./types.js").ClientSurfaceMode} options.surfaceMode
 * @param {import("./types.js").ClientRouteRecord} [options.fallbackRoute] Replaces the not-found route of notFoundComponent.
 * @param {import("vue-router").RouteComponent} [options.notFoundComponent]
 * @param {false | import("vue-router").NavigationGuard | import("./types.js").ShellGuardOptions} [options.guard]
 * @param {false | import("vue-router").RouterScrollBehavior} [options.scrollBehavior] false leaves scrolling to the browser.
 * An app's own behaviour goes here, never into createRouter: a createRouter that replaces the one it is given throws.
 */
function createSurfaceShellRouter({
  createRouter,
  history,
  routes,
  surfaceRuntime,
  surfaceMode,
  fallbackRoute,
  notFoundComponent,
  guard = false,
  scrollBehavior = shellScrollBehavior
}) {
  const effectiveFallbackRoute = fallbackRoute || createFallbackNotFoundRoute(notFoundComponent);
  const activeRoutes = buildSurfaceAwareRoutes({
    routes,
    surfaceRuntime,
    surfaceMode,
    fallbackRoute: effectiveFallbackRoute
  });
  const router = createRouter({
    history,
    routes: activeRoutes,
    ...(scrollBehavior === false ? {} : { scrollBehavior })
  });
  // A createRouter wrapper with a scrollBehavior of its own would silently drop the shell's, and with it the position
  // Up returns to, so it is refused rather than composed: the app's behaviour belongs in this function's option.
  if (scrollBehavior !== false && isRecord(router?.options) && router.options.scrollBehavior !== scrollBehavior) {
    throw new Error(
      "createShellRouter's createRouter replaced the scroll behaviour it was given, which would lose the position the " +
        "shell's Up returns to. Let createRouter keep options.scrollBehavior, and pass an app's own as createShellRouter's " +
        "scrollBehavior option (calling shellScrollBehavior for the cases it leaves to the shell), or false to leave " +
        "scrolling to the browser."
    );
  }

  if (guard !== false) {
    router.beforeEach(isRecord(guard) ? createShellBeforeEachGuard({ surfaceRuntime, ...guard }) : guard);
  }

  return Object.freeze({
    router,
    activeRoutes: Object.freeze([...activeRoutes]),
    fallbackRoute: effectiveFallbackRoute
  });
}

/**
 * Starts the application: its plugins, its client modules, its router and finally the mounted app.
 * @param {object} options
 * @param {(rootComponent: unknown) => import("./types.js").ClientVueApp} options.createApp
 * @param {unknown} options.rootComponent
 * @param {Record<string, unknown>} [options.appConfig]
 * @param {unknown[]} [options.appPlugins]
 * @param {import("vue-i18n").I18n | null} [options.i18n]
 * @param {import("./types.js").ClientPinia} options.pinia
 * @param {import("./types.js").ClientQueryClient} options.queryClient
 * @param {import("./types.js").ClientRouter} options.router
 * @param {(context: object) => Promise<import("./types.js").ClientBootstrap>} options.bootClientModules
 * @param {import("./types.js").ClientSurfaceRuntime} options.surfaceRuntime
 * @param {import("./types.js").ClientSurfaceMode} options.surfaceMode
 * @param {Record<string, unknown>} [options.env]
 * @param {import("./types.js").ClientRouteRecord | null} [options.fallbackRoute] Added again last, after the modules' routes.
 * @param {import("../server/types.js").RuntimeLogger} [options.logger]
 * @param {typeof createClientBootstrapLogger} [options.createBootstrapLogger]
 * @param {boolean} [options.debugEnabled]
 * @param {string} [options.debugEnvKey]
 * @param {string} [options.debugMessage]
 * @param {(context: import("./types.js").ClientBootstrapHookContext) => void | Promise<void>} [options.onAfterModulesBootstrapped]
 * @param {(context: import("./types.js").ClientBootstrapHookContext) => void | Promise<void>} [options.onAfterRouterReady]
 * @param {string} [options.mountSelector]
 */
async function bootstrapClientShellApp({
  createApp,
  rootComponent,
  appConfig = {},
  appPlugins = [],
  i18n = null,
  pinia,
  queryClient,
  router,
  bootClientModules,
  surfaceRuntime,
  surfaceMode,
  env = {},
  fallbackRoute = null,
  // The browser console is the application's logger unless it passes its own.
  logger = console,
  createBootstrapLogger = createClientBootstrapLogger,
  debugEnabled = undefined,
  debugEnvKey = "VITE_JSKIT_CLIENT_DEBUG",
  debugMessage = "Client modules bootstrapped before router install.",
  onAfterModulesBootstrapped = ignoreBootstrapStep,
  onAfterRouterReady = ignoreBootstrapStep,
  mountSelector = "#app"
}) {
  const app = createApp(rootComponent);

  installAppPlugins(app, appPlugins);
  // The app's vue-i18n instance: JSKIT merges its English into it and translates
  // through it; switching the language stays the app's job.
  if (i18n) {
    if (!appPlugins.includes(i18n)) {
      app.use(i18n);
    }
    setJskitI18n(i18n);
  }
  setClientAppConfig(appConfig);

  const bootstrapLogger = createStructuredLogger(createBootstrapLogger({
    env,
    logger,
    debugEnabled,
    debugEnvKey
  }));

  const clientBootstrap = await bootClientModules({
    app,
    pinia,
    queryClient,
    router,
    surfaceRuntime,
    surfaceMode,
    env,
    logger: bootstrapLogger
  });

  const { isDebugEnabled } = bootstrapLogger;
  if (isDebugEnabled) {
    bootstrapLogger.info(
      {
        bootstrap: {
          modules: clientBootstrap.modules || [],
          providerCount: Number(clientBootstrap.providerCount || 0),
          routeCount: Number(clientBootstrap.routeCount || 0)
        },
        routerRoutesBeforeInstall: summarizeRouterRoutes(router),
        currentPath: pagePathname()
      },
      String(debugMessage || "").trim() || "Client modules bootstrapped before router install."
    );
  }

  if (fallbackRoute?.name) {
    if (router.hasRoute(fallbackRoute.name)) {
      router.removeRoute(fallbackRoute.name);
    }
    router.addRoute(fallbackRoute);
  }

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

  app.use(router);
  await router.isReady();
  await onAfterRouterReady(
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
  shellScrollBehavior,
  staysOnSamePage,
  resolveClientBootstrapDebugEnabled,
  createClientBootstrapLogger,
  createSurfaceShellRouter,
  bootstrapClientShellApp
};
