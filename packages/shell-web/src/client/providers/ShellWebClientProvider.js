import { getClientAppConfig } from "@jskit-ai/kernel/client";
import {
  isRecord
} from "@jskit-ai/kernel/shared/support";
import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import {
  createDefaultErrorPolicy
} from "../error/policy.js";
import {
  createDefaultMaterialErrorPresenters,
  createMaterialBannerPresenter,
  createMaterialDialogPresenter,
  createMaterialSnackbarPresenter
} from "../error/presenters.js";
import {
  createErrorRuntime
} from "../error/runtime.js";
import {
  createErrorPresentationStore
} from "../error/store.js";
import { createWebPlacementRuntime } from "../placement/runtime.js";
import { useShellErrorPresentationStore } from "../stores/useShellErrorPresentationStore.js";
import { buildSurfaceConfigContext } from "../placement/surfaceContext.js";
import { createShellBootstrapRuntime } from "../runtime/bootstrapRuntime.js";
import { registerBootstrapPayloadHandler } from "../bootstrap/bootstrapPayloadHandlerRegistry.js";
import { resolveBootstrapErrorStatusCode } from "../bootstrap/bootstrapErrorStatus.js";

// Keep this constant for diagnostics, but keep import() below as a literal string so Vite can statically analyze it.
const APP_PLACEMENT_MODULE_SPECIFIER = "/src/placement.js";
const APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER = "/src/placementTopology.js";
const APP_ERROR_MODULE_SPECIFIER = "/src/error.js";

function isMissingDynamicModule(error, moduleSpecifier) {
  const message = String(error?.message || error || "");
  return (
    message.includes(moduleSpecifier) &&
    (message.includes("Cannot find module") ||
      message.includes("Failed to fetch dynamically imported module") ||
      message.includes("ERR_MODULE_NOT_FOUND"))
  );
}

async function loadAppPlacementDefinitions(logger) {
  try {
    const moduleNamespace = await import("/src/placement.js");
    const exported = moduleNamespace?.default;
    const resolved = typeof exported === "function" ? exported() : exported;
    if (Array.isArray(resolved)) {
      return resolved;
    }

    logger.warn(
      {
        module: APP_PLACEMENT_MODULE_SPECIFIER,
        exportedType: typeof exported
      },
      "App placement module default export did not resolve to an array; using empty list."
    );
  } catch (error) {
    if (isMissingDynamicModule(error, APP_PLACEMENT_MODULE_SPECIFIER)) {
      return [];
    }

    logger.warn(
      {
        module: APP_PLACEMENT_MODULE_SPECIFIER,
        error: String(error?.message || error || "unknown error")
      },
      "Failed to load app placement module; using empty list."
    );
  }

  return [];
}

async function loadAppPlacementTopology(logger) {
  try {
    const moduleNamespace = await import("/src/placementTopology.js");
    const exported = moduleNamespace?.default;
    return resolveAppPlacementTopologyExport(exported, logger);
  } catch (error) {
    if (isMissingDynamicModule(error, APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER)) {
      return [];
    }

    logger.warn(
      {
        module: APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER,
        error: String(error?.message || error || "unknown error")
      },
      "Failed to load app placement topology module; using empty topology."
    );
  }

  return [];
}

function resolveAppPlacementTopologyExport(exported, logger) {
  const resolved = typeof exported === "function" ? exported() : exported;
  if (Array.isArray(resolved)) {
    return resolved;
  }
  if (resolved && typeof resolved === "object") {
    return resolved;
  }

  logger.warn(
    {
      module: APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER,
      exportedType: typeof exported
    },
    "App placement topology module default export did not resolve to an object or array; using empty topology."
  );
  return [];
}

function createErrorConfigToolkit(errorRuntime) {
  return Object.freeze({
    createDefaultErrorPolicy,
    moduleDefaultPresenterId: "material.snackbar",
    presenterFactories: Object.freeze({
      createMaterialSnackbarPresenter,
      createMaterialBannerPresenter,
      createMaterialDialogPresenter
    }),
    runtime: errorRuntime
  });
}

async function loadAppErrorConfig(logger, errorRuntime) {
  try {
    const moduleNamespace = await import("/src/error.js");
    const exported = moduleNamespace?.default;
    const toolkit = createErrorConfigToolkit(errorRuntime);
    const resolved = typeof exported === "function" ? await exported(toolkit) : exported;

    if (isRecord(resolved)) {
      return resolved;
    }

    logger.warn(
      {
        module: APP_ERROR_MODULE_SPECIFIER,
        exportedType: typeof exported
      },
      "App error module default export did not resolve to an object; using shell-web defaults."
    );
  } catch (error) {
    if (isMissingDynamicModule(error, APP_ERROR_MODULE_SPECIFIER)) {
      return {};
    }

    logger.warn(
      {
        module: APP_ERROR_MODULE_SPECIFIER,
        error: String(error?.message || error || "unknown error")
      },
      "Failed to load app error module; using shell-web defaults."
    );
  }

  return {};
}

function applyAppErrorConfig(errorRuntime, errorConfig = {}) {
  const source = isRecord(errorConfig) ? errorConfig : {};
  const configPayload = {};

  if (Array.isArray(source.presenters) && source.presenters.length > 0) {
    configPayload.presenters = source.presenters;
  }

  if (Object.prototype.hasOwnProperty.call(source, "policy")) {
    configPayload.policy = source.policy;
  }

  if (Object.prototype.hasOwnProperty.call(source, "defaultPresenterId")) {
    configPayload.defaultPresenterId = source.defaultPresenterId;
  }

  if (Object.keys(configPayload).length > 0) {
    errorRuntime.configure(configPayload);
    return;
  }

  errorRuntime.assertBootReady();
}

function isPullRefreshQuery(query = null) {
  const meta = isRecord(query?.meta) ? query.meta : {};
  if (meta.jskitRefresh === "pull") {
    return true;
  }
  if (meta.jskitRefresh === false) {
    return false;
  }

  const jskitMeta = isRecord(meta.jskit) ? meta.jskit : {};
  return jskitMeta.refreshOnPull !== false;
}

function createShellRefreshRuntime({
  app,
  logger = null
} = {}) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    throw new Error("createShellRefreshRuntime requires application has()/make().");
  }

  const runtimeLogger = logger || createSharedProviderLogger(app);
  let refreshQueue = Promise.resolve(null);

  async function refreshBootstrap(reason) {
    if (!app.has("runtime.web-bootstrap.client")) {
      return false;
    }

    const bootstrapRuntime = app.make("runtime.web-bootstrap.client");
    if (!bootstrapRuntime || typeof bootstrapRuntime.refresh !== "function") {
      return false;
    }

    await bootstrapRuntime.refresh(reason);
    return true;
  }

  async function refetchPullQueries() {
    if (!app.has("jskit.client.query-client")) {
      return false;
    }

    const queryClient = app.make("jskit.client.query-client");
    if (!queryClient || typeof queryClient.refetchQueries !== "function") {
      return false;
    }

    await queryClient.refetchQueries(
      {
        type: "active",
        predicate: isPullRefreshQuery
      },
      {
        throwOnError: false
      }
    );
    return true;
  }

  function reportRefreshFailure(error) {
    runtimeLogger.warn(
      {
        error: String(error?.message || error || "unknown error")
      },
      "Shell refresh failed."
    );

    if (!app.has("runtime.web-error.client")) {
      return;
    }

    const errorRuntime = app.make("runtime.web-error.client");
    if (!errorRuntime || typeof errorRuntime.report !== "function") {
      return;
    }

    errorRuntime.report({
      source: "shell-web.refresh",
      message: "Unable to refresh. Check the connection and try again.",
      intent: "app-recoverable",
      severity: "error",
      dedupeKey: "shell-web.refresh.failed",
      dedupeWindowMs: 2000,
      action: {
        label: "Retry",
        dismissOnRun: true,
        handler() {
          void refresh("retry");
        }
      }
    });
  }

  async function performRefresh(reason = "manual") {
    const normalizedReason = String(reason || "manual").trim() || "manual";
    try {
      const [bootstrapRefreshed, queriesRefetched] = await Promise.all([
        refreshBootstrap(normalizedReason),
        refetchPullQueries()
      ]);

      return Object.freeze({
        reason: normalizedReason,
        bootstrapRefreshed,
        queriesRefetched
      });
    } catch (error) {
      reportRefreshFailure(error);
      return Object.freeze({
        reason: normalizedReason,
        bootstrapRefreshed: false,
        queriesRefetched: false,
        error
      });
    }
  }

  function refresh(reason = "manual") {
    refreshQueue = refreshQueue
      .catch(() => null)
      .then(() => performRefresh(reason));
    return refreshQueue;
  }

  return Object.freeze({
    refresh
  });
}

function installVueErrorBridge(vueApp, errorRuntime, logger) {
  if (!vueApp || !isRecord(vueApp.config)) {
    return;
  }

  const previousHandler = typeof vueApp.config.errorHandler === "function" ? vueApp.config.errorHandler : null;

  vueApp.config.errorHandler = (error, instance, info) => {
    try {
      errorRuntime.report({
        source: "shell-web.vue.error-handler",
        message: String(error?.message || "Unexpected UI error."),
        cause: error,
        intent: "blocking",
        severity: "error",
        details: {
          info: String(info || "")
        }
      });
    } catch (reportError) {
      logger.error(
        {
          source: "shell-web.vue.error-handler",
          error: String(reportError?.message || reportError || "unknown error")
        },
        "Shell web error runtime failed to report a Vue error."
      );
    }

    if (previousHandler) {
      previousHandler(error, instance, info);
    }
  };
}

function installRouterErrorBridge(app, errorRuntime, logger) {
  if (!app.has("jskit.client.router")) {
    return;
  }

  const router = app.make("jskit.client.router");
  if (!router || typeof router.onError !== "function") {
    return;
  }

  router.onError((error) => {
    try {
      errorRuntime.report({
        source: "shell-web.router.on-error",
        message: String(error?.message || "Navigation failed."),
        cause: error,
        intent: "app-recoverable",
        severity: "error",
        dedupeKey: String(error?.message || "navigation-failed"),
        dedupeWindowMs: 2000
      });
    } catch (reportError) {
      logger.error(
        {
          source: "shell-web.router.on-error",
          error: String(reportError?.message || reportError || "unknown error")
        },
        "Shell web error runtime failed to report a router error."
      );
    }
  });
}

class ShellWebClientProvider {
  static id = "shell.web.client";

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
      throw new Error("ShellWebClientProvider requires application singleton()/tag().");
    }

    const logger = createSharedProviderLogger(isRecord(app) ? app : null);
    registerBootstrapPayloadHandler(app, "shell.web.bootstrap.surfaceAccessHandler", () =>
      Object.freeze({
        handlerId: "shell.web.bootstrap.surfaceAccess",
        order: 0,
        applyBootstrapPayload({ payload = {}, placementRuntime, source } = {}) {
          placementRuntime.setContext(
            {
              surfaceAccess:
                payload?.surfaceAccess && typeof payload.surfaceAccess === "object" ? payload.surfaceAccess : {}
            },
            {
              source
            }
          );
        },
        handleBootstrapError({ error, placementRuntime, source } = {}) {
          if (resolveBootstrapErrorStatusCode(error) !== 401) {
            return;
          }

          placementRuntime.setContext(
            {
              surfaceAccess: {}
            },
            {
              source
            }
          );
        }
      })
    );
    app.singleton("runtime.web-placement.client", () => createWebPlacementRuntime({ app, logger }));
    app.singleton("runtime.web-bootstrap.client", (scope) =>
      createShellBootstrapRuntime({
        app: scope,
        logger
      })
    );
    app.singleton("runtime.web-refresh.client", (scope) =>
      createShellRefreshRuntime({
        app: scope,
        logger
      })
    );
    app.singleton("runtime.web-error.presentation-store.client", () => createErrorPresentationStore());
    app.singleton("runtime.web-error.client", (scope) =>
      createErrorRuntime({
        presenters: createDefaultMaterialErrorPresenters({
          store: scope.make("runtime.web-error.presentation-store.client")
        }),
        policy: createDefaultErrorPolicy(),
        moduleDefaultPresenterId: "material.snackbar",
        logger
      })
    );
  }

  async boot(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("ShellWebClientProvider requires application make()/has().");
    }

    const logger = createSharedProviderLogger(isRecord(app) ? app : null);
    const placementRuntime = app.make("runtime.web-placement.client");
    if (placementRuntime && typeof placementRuntime.replacePlacements === "function") {
      const placementTopology = await loadAppPlacementTopology(logger);
      if (typeof placementRuntime.replacePlacementTopology === "function") {
        placementRuntime.replacePlacementTopology(placementTopology, { source: APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER });
      }
      const placements = await loadAppPlacementDefinitions(logger);
      placementRuntime.replacePlacements(placements, { source: APP_PLACEMENT_MODULE_SPECIFIER });
      const appConfig = getClientAppConfig();
      const surfaceRuntime = app.has("jskit.client.surface.runtime")
        ? app.make("jskit.client.surface.runtime")
        : null;
      const surfaceConfig = buildSurfaceConfigContext(surfaceRuntime, {
        tenancyMode: appConfig?.tenancyMode
      });
      const surfaceAccessPolicies =
        appConfig?.surfaceAccessPolicies && typeof appConfig.surfaceAccessPolicies === "object"
          ? appConfig.surfaceAccessPolicies
          : {};
      placementRuntime.setContext(
        {
          surfaceConfig,
          surfaceAccessPolicies
        },
        {
          source: "shell-web.surface-config"
        }
      );
    }

    const errorRuntime = app.make("runtime.web-error.client");
    const errorConfig = await loadAppErrorConfig(logger, errorRuntime);
    applyAppErrorConfig(errorRuntime, errorConfig);

    const bootstrapRuntime = app.make("runtime.web-bootstrap.client");
    if (bootstrapRuntime && typeof bootstrapRuntime.initialize === "function") {
      await bootstrapRuntime.initialize();
    }

    if (!app.has("jskit.client.vue.app")) {
      return;
    }

    const vueApp = app.make("jskit.client.vue.app");
    if (!vueApp || typeof vueApp.provide !== "function" || typeof vueApp.use !== "function") {
      return;
    }
    const pinia = app.make("jskit.client.pinia");
    if (!pinia) {
      throw new Error("ShellWebClientProvider requires Pinia installed in the client app.");
    }
    const errorPresentationStore = app.make("runtime.web-error.presentation-store.client");
    const refreshRuntime = app.make("runtime.web-refresh.client");
    useShellErrorPresentationStore(pinia).attachRuntimeStore(errorPresentationStore);

    vueApp.provide("jskit.shell-web.runtime.web-placement.client", placementRuntime);
    vueApp.provide("jskit.shell-web.runtime.web-refresh.client", refreshRuntime);
    vueApp.provide("jskit.shell-web.runtime.web-error.client", errorRuntime);
    vueApp.provide(
      "jskit.shell-web.runtime.web-error.presentation-store.client",
      errorPresentationStore
    );

    installVueErrorBridge(vueApp, errorRuntime, logger);
    installRouterErrorBridge(app, errorRuntime, logger);
  }
}

export {
  ShellWebClientProvider,
  resolveAppPlacementTopologyExport
};
