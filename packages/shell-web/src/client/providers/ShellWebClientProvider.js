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
  createMaterialSnackbarPresenter
} from "../error/presenters.js";
import {
  createErrorRuntime
} from "../error/runtime.js";
import {
  createErrorPresentationStore
} from "../error/store.js";
import { createWebPlacementRuntime } from "../placement/runtime.js";
import { buildSurfaceConfigContext } from "../placement/surfaceContext.js";

// Keep this constant for diagnostics, but keep import() below as a literal string so Vite can statically analyze it.
const APP_PLACEMENT_MODULE_SPECIFIER = "/src/placement.js";
const APP_ERROR_MODULE_SPECIFIER = "/src/error.js";

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
        severity: "error",
        channel: "dialog",
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
        severity: "error",
        channel: "banner",
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
    if (!app || typeof app.singleton !== "function") {
      throw new Error("ShellWebClientProvider requires application singleton().");
    }

    const logger = createSharedProviderLogger(isRecord(app) ? app : null);
    app.singleton("runtime.web-placement.client", () => createWebPlacementRuntime({ app, logger }));
    app.singleton("shell.web.query-client", () => createShellWebQueryClient());
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

    if (!app.has("jskit.client.vue.app")) {
      return;
    }

    const vueApp = app.make("jskit.client.vue.app");
    if (!vueApp || typeof vueApp.provide !== "function" || typeof vueApp.use !== "function") {
      return;
    }

    vueApp.use(VueQueryPlugin, {
      queryClient: app.make("shell.web.query-client")
    });
    vueApp.provide("jskit.shell-web.runtime.web-placement.client", placementRuntime);
    vueApp.provide("jskit.shell-web.runtime.web-error.client", errorRuntime);
    vueApp.provide(
      "jskit.shell-web.runtime.web-error.presentation-store.client",
      app.make("runtime.web-error.presentation-store.client")
    );

    installVueErrorBridge(vueApp, errorRuntime, logger);
    installRouterErrorBridge(app, errorRuntime, logger);
  }
}

export {
  ShellWebClientProvider
};
