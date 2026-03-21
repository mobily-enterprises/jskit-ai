import {
  CLIENT_MODULE_ROUTER_TOKEN,
  CLIENT_MODULE_SURFACE_RUNTIME_TOKEN,
  CLIENT_MODULE_VUE_APP_TOKEN
} from "@jskit-ai/kernel/client/moduleBootstrap";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import {
  isRecord,
  shouldRetryTransientQueryFailure,
  transientQueryRetryDelay
} from "@jskit-ai/kernel/shared/support";
import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  createDefaultErrorPolicy
} from "../error/policy.js";
import {
  createDefaultMaterialErrorPresenters,
  createMaterialBannerPresenter,
  createMaterialDialogPresenter,
  createMaterialSnackbarPresenter,
  MODULE_DEFAULT_PRESENTER_ID
} from "../error/presenters.js";
import {
  createErrorRuntime
} from "../error/runtime.js";
import {
  createErrorPresentationStore
} from "../error/store.js";
import {
  SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN,
  SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY,
  SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN,
  SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY
} from "../error/tokens.js";
import {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  WEB_PLACEMENT_RUNTIME_INJECTION_KEY
} from "../placement/tokens.js";
import { createWebPlacementRuntime } from "../placement/runtime.js";
import { buildSurfaceConfigContext } from "../placement/surfaceContext.js";

// Keep this constant for diagnostics, but keep import() below as a literal string so Vite can statically analyze it.
const APP_PLACEMENT_MODULE_SPECIFIER = "/src/placement.js";
const APP_ERROR_MODULE_SPECIFIER = "/src/error.js";
const SURFACE_CONTEXT_SOURCE = "shell-web.surface-config";
const SHELL_WEB_QUERY_CLIENT_TOKEN = "shell.web.query-client";
const VUE_ERROR_SOURCE = "shell-web.vue.error-handler";
const ROUTER_ERROR_SOURCE = "shell-web.router.on-error";

function createShellWebQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: shouldRetryTransientQueryFailure,
        retryDelay: transientQueryRetryDelay
      }
    }
  });
}

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

function createErrorConfigToolkit(errorRuntime) {
  return Object.freeze({
    createDefaultErrorPolicy,
    moduleDefaultPresenterId: MODULE_DEFAULT_PRESENTER_ID,
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

function installVueErrorBridge(vueApp, errorRuntime, logger) {
  if (!vueApp || !isRecord(vueApp.config)) {
    return;
  }

  const previousHandler = typeof vueApp.config.errorHandler === "function" ? vueApp.config.errorHandler : null;

  vueApp.config.errorHandler = (error, instance, info) => {
    try {
      errorRuntime.report({
        source: VUE_ERROR_SOURCE,
        message: String(error?.message || "Unexpected UI error."),
        cause: error,
        severity: "error",
        channel: "dialog",
        details: {
          info: String(info || "")
        }
      });
    } catch (reportError) {
      logger.error(
        {
          source: VUE_ERROR_SOURCE,
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
  if (!app.has(CLIENT_MODULE_ROUTER_TOKEN)) {
    return;
  }

  const router = app.make(CLIENT_MODULE_ROUTER_TOKEN);
  if (!router || typeof router.onError !== "function") {
    return;
  }

  router.onError((error) => {
    try {
      errorRuntime.report({
        source: ROUTER_ERROR_SOURCE,
        message: String(error?.message || "Navigation failed."),
        cause: error,
        severity: "error",
        channel: "banner",
        dedupeKey: String(error?.message || "navigation-failed"),
        dedupeWindowMs: 2000
      });
    } catch (reportError) {
      logger.error(
        {
          source: ROUTER_ERROR_SOURCE,
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
    if (!app || typeof app.singleton !== "function") {
      throw new Error("ShellWebClientProvider requires application singleton().");
    }

    const logger = createSharedProviderLogger(isRecord(app) ? app : null);
    app.singleton(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN, () => createWebPlacementRuntime({ app, logger }));
    app.singleton(SHELL_WEB_QUERY_CLIENT_TOKEN, () => createShellWebQueryClient());
    app.singleton(SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN, () => createErrorPresentationStore());
    app.singleton(SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN, (scope) =>
      createErrorRuntime({
        presenters: createDefaultMaterialErrorPresenters({
          store: scope.make(SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN)
        }),
        policy: createDefaultErrorPolicy(),
        moduleDefaultPresenterId: MODULE_DEFAULT_PRESENTER_ID,
        logger
      })
    );
  }

  async boot(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("ShellWebClientProvider requires application make()/has().");
    }

    const logger = createSharedProviderLogger(isRecord(app) ? app : null);
    const placementRuntime = app.make(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN);
    if (placementRuntime && typeof placementRuntime.replacePlacements === "function") {
      const placements = await loadAppPlacementDefinitions(logger);
      placementRuntime.replacePlacements(placements, { source: APP_PLACEMENT_MODULE_SPECIFIER });
      const appConfig = getClientAppConfig();
      const surfaceRuntime = app.has(CLIENT_MODULE_SURFACE_RUNTIME_TOKEN)
        ? app.make(CLIENT_MODULE_SURFACE_RUNTIME_TOKEN)
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
          source: SURFACE_CONTEXT_SOURCE
        }
      );
    }

    const errorRuntime = app.make(SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN);
    const errorConfig = await loadAppErrorConfig(logger, errorRuntime);
    applyAppErrorConfig(errorRuntime, errorConfig);

    if (!app.has(CLIENT_MODULE_VUE_APP_TOKEN)) {
      return;
    }

    const vueApp = app.make(CLIENT_MODULE_VUE_APP_TOKEN);
    if (!vueApp || typeof vueApp.provide !== "function" || typeof vueApp.use !== "function") {
      return;
    }

    vueApp.use(VueQueryPlugin, {
      queryClient: app.make(SHELL_WEB_QUERY_CLIENT_TOKEN)
    });
    vueApp.provide(WEB_PLACEMENT_RUNTIME_INJECTION_KEY, placementRuntime);
    vueApp.provide(SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY, errorRuntime);
    vueApp.provide(
      SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY,
      app.make(SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN)
    );

    installVueErrorBridge(vueApp, errorRuntime, logger);
    installRouterErrorBridge(app, errorRuntime, logger);
  }
}

export {
  ShellWebClientProvider,
  SHELL_WEB_QUERY_CLIENT_TOKEN
};
