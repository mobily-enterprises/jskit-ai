import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { isDynamicImportError } from "@jskit-ai/kernel/client/asyncModuleRecovery";
import {
  isMissingDynamicModule,
  notifyDynamicImportFailure
} from "./appModuleLoadFailure.js";
import {
  SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY
} from "../asyncModuleRecovery/inject.js";
import { createShellAsyncModuleRecoveryRuntime } from "../asyncModuleRecovery/runtime.js";
import { createShellClientUpdateRuntime } from "../clientUpdate/runtime.js";
import {
  SHELL_REQUEST_RECOVERY_RUNTIME_KEY
} from "../requestRecovery/inject.js";
import {
  createShellRequestRecoveryRuntime
} from "../requestRecovery/runtime.js";
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
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "../error/inject.js";
import {
  createErrorRuntime
} from "../error/runtime.js";
import {
  createErrorPresentationStore
} from "../error/store.js";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "../placement/inject.js";
import { createWebPlacementRuntime } from "../placement/runtime.js";
import { useShellErrorPresentationStore } from "../stores/useShellErrorPresentationStore.js";
import { buildSurfaceConfigContext } from "../placement/surfaceContext.js";
import { createShellBootstrapRuntime } from "../runtime/bootstrapRuntime.js";
import {
  SHELL_WEB_REFRESH_RUNTIME_KEY,
  createShellRefreshRuntime
} from "../runtime/refreshRuntime.js";
import { createBootstrapPayloadHandlerRegistry } from "../bootstrap/bootstrapPayloadHandlerRegistry.js";
import { resolveBootstrapErrorStatusCode } from "../bootstrap/bootstrapErrorStatus.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

// Keep these constants for diagnostics, but keep each import() below as a literal string so Vite can statically analyze it.
const APP_PLACEMENT_MODULE_SPECIFIER = "/src/placement.js";
const APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER = "/src/placementTopology.js";
const APP_ERROR_MODULE_SPECIFIER = "/src/error.js";

// Loads an optional app module's default export. `resolve` returns the usable value, or undefined when the
// export has the wrong shape. A missing module silently yields `fallback`; any other failure is reported.
async function loadAppModule({
  importModule,
  specifier,
  label,
  resolve,
  invalidExportMessage = "",
  loadFailureMessage,
  fallback,
  logger,
  asyncModuleRecoveryRuntime = null
}) {
  try {
    const moduleNamespace = await importModule();
    const exported = moduleNamespace?.default;
    const resolved = await resolve(exported);
    if (resolved !== undefined) {
      return resolved;
    }

    logger.warn(
      {
        module: specifier,
        exportedType: typeof exported
      },
      invalidExportMessage
    );
  } catch (error) {
    if (isMissingDynamicModule(error, specifier)) {
      return fallback;
    }
    notifyDynamicImportFailure(asyncModuleRecoveryRuntime, error, { label });

    logger.warn(
      {
        module: specifier,
        error: String(error?.message || error || "unknown error")
      },
      loadFailureMessage
    );
  }

  return fallback;
}

function loadAppPlacementDefinitions(logger, asyncModuleRecoveryRuntime = null) {
  return loadAppModule({
    importModule: () => import("/src/placement.js"),
    specifier: APP_PLACEMENT_MODULE_SPECIFIER,
    label: t("jskit.shell.recovery.placementConfigLabel"),
    resolve(exported) {
      const resolved = typeof exported === "function" ? exported() : exported;
      return Array.isArray(resolved) ? resolved : undefined;
    },
    invalidExportMessage: "App placement module default export did not resolve to an array; using empty list.",
    loadFailureMessage: "Failed to load app placement module; using empty list.",
    fallback: [],
    logger,
    asyncModuleRecoveryRuntime
  });
}

function loadAppPlacementTopology(logger, asyncModuleRecoveryRuntime = null) {
  return loadAppModule({
    importModule: () => import("/src/placementTopology.js"),
    specifier: APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER,
    label: t("jskit.shell.recovery.placementTopologyLabel"),
    resolve: (exported) => resolveAppPlacementTopologyExport(exported, logger),
    loadFailureMessage: "Failed to load app placement topology module; using empty topology.",
    fallback: [],
    logger,
    asyncModuleRecoveryRuntime
  });
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

function loadAppErrorConfig(logger, errorRuntime, asyncModuleRecoveryRuntime = null) {
  return loadAppModule({
    importModule: () => import("/src/error.js"),
    specifier: APP_ERROR_MODULE_SPECIFIER,
    label: t("jskit.shell.recovery.errorConfigLabel"),
    async resolve(exported) {
      const toolkit = createErrorConfigToolkit(errorRuntime);
      const resolved = typeof exported === "function" ? await exported(toolkit) : exported;
      return isRecord(resolved) ? resolved : undefined;
    },
    invalidExportMessage: "App error module default export did not resolve to an object; using shell-web defaults.",
    loadFailureMessage: "Failed to load app error module; using shell-web defaults.",
    fallback: {},
    logger,
    asyncModuleRecoveryRuntime
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
        message: String(error?.message || t("jskit.shell.error.unexpectedUi")),
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

function installRouterErrorBridge(router, errorRuntime, logger) {
  if (!router || typeof router.onError !== "function") {
    return;
  }

  router.onError((error) => {
    if (isDynamicImportError(error)) {
      return;
    }

    try {
      errorRuntime.report({
        source: "shell-web.router.on-error",
        message: String(error?.message || t("jskit.shell.error.navigationFailed")),
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

const ShellWebClientProvider = defineProvider({
  id: "shell.web.client",
  requires: {
    components: "client.components",
    loggerInput: "client.logger",
    pinia: "client.pinia",
    queryClient: "client.query",
    router: "client.router",
    surfaceRuntime: "client.surface",
    vueApp: "client.vue"
  },
  optional: {
    realtime: "client.realtime"
  },
  provides: {
    shell: "client.shell"
  },
  setup({ components, loggerInput, queryClient, router }) {
    const logger = createSharedProviderLogger(loggerInput);
    const bootstrapHandlers = createBootstrapPayloadHandlerRegistry();
    bootstrapHandlers.register(
      Object.freeze({
        handlerId: "shell.web.bootstrap.surface-access",
        order: 0,
        applyBootstrapPayload({ payload = {}, placementRuntime, source } = {}) {
          placementRuntime.setContext(
            {
              surfaceAccess:
                payload?.surfaceAccess && typeof payload.surfaceAccess === "object" ? payload.surfaceAccess : {}
            },
            { source }
          );
        },
        handleBootstrapError({ error, placementRuntime, source } = {}) {
          if (resolveBootstrapErrorStatusCode(error) !== 401) {
            return;
          }
          placementRuntime.setContext({ surfaceAccess: {} }, { source });
        }
      })
    );

    const errorPresentationStore = createErrorPresentationStore();
    const errorRuntime = createErrorRuntime({
      presenters: createDefaultMaterialErrorPresenters({ store: errorPresentationStore }),
      policy: createDefaultErrorPolicy(),
      moduleDefaultPresenterId: "material.snackbar",
      logger
    });
    const placementRuntime = createWebPlacementRuntime({ components, logger });
    const asyncModuleRecoveryRuntime = createShellAsyncModuleRecoveryRuntime({
      router,
      errorRuntime,
      logger
    });
    const requestRecoveryRuntime = createShellRequestRecoveryRuntime({
      queryClient,
      errorRuntime,
      logger
    });
    const clientUpdateRuntime = createShellClientUpdateRuntime({
      errorRuntime,
      reload: () => asyncModuleRecoveryRuntime.reload()
    });
    const bootstrapRuntime = createShellBootstrapRuntime({
      handlers: bootstrapHandlers,
      placementRuntime,
      requestRecoveryRuntime,
      router,
      logger
    });
    const refreshRuntime = createShellRefreshRuntime({
      bootstrapRuntime,
      queryClient,
      errorRuntime,
      logger
    });

    return {
      shell: Object.freeze({
        asyncModuleRecovery: asyncModuleRecoveryRuntime,
        bootstrap: bootstrapRuntime,
        bootstrapHandlers,
        clientUpdate: clientUpdateRuntime,
        error: errorRuntime,
        errorPresentationStore,
        placement: placementRuntime,
        refresh: refreshRuntime,
        requestRecovery: requestRecoveryRuntime
      })
    };
  },
  async boot({ loggerInput, pinia, realtime, router, surfaceRuntime, vueApp }, { outputs }) {
    const logger = createSharedProviderLogger(loggerInput);
    const {
      asyncModuleRecovery: asyncModuleRecoveryRuntime,
      bootstrap: bootstrapRuntime,
      clientUpdate: clientUpdateRuntime,
      error: errorRuntime,
      errorPresentationStore,
      placement: placementRuntime,
      refresh: refreshRuntime,
      requestRecovery: requestRecoveryRuntime
    } = outputs.shell;
    asyncModuleRecoveryRuntime.install();

    const placementTopology = await loadAppPlacementTopology(logger, asyncModuleRecoveryRuntime);
    placementRuntime.replacePlacementTopology(placementTopology, { source: APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER });
    const placements = await loadAppPlacementDefinitions(logger, asyncModuleRecoveryRuntime);
    placementRuntime.replacePlacements(placements, { source: APP_PLACEMENT_MODULE_SPECIFIER });
    const appConfig = getClientAppConfig();
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

    const errorConfig = await loadAppErrorConfig(logger, errorRuntime, asyncModuleRecoveryRuntime);
    errorRuntime.configure(errorConfig);
    requestRecoveryRuntime.install();
    // After the app's error configuration, so the offer follows its policy.
    clientUpdateRuntime.watch(realtime);

    await bootstrapRuntime.initialize();

    if (!vueApp || typeof vueApp.provide !== "function" || typeof vueApp.use !== "function") {
      return;
    }
    if (!pinia) {
      throw new Error("ShellWebClientProvider requires Pinia installed in the client app.");
    }
    useShellErrorPresentationStore(pinia).attachRuntimeStore(errorPresentationStore);

    vueApp.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placementRuntime);
    vueApp.provide(SHELL_WEB_REFRESH_RUNTIME_KEY, refreshRuntime);
    vueApp.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
    vueApp.provide(SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY, asyncModuleRecoveryRuntime);
    vueApp.provide(SHELL_REQUEST_RECOVERY_RUNTIME_KEY, requestRecoveryRuntime);

    installVueErrorBridge(vueApp, errorRuntime, logger);
    installRouterErrorBridge(router, errorRuntime, logger);
  },
  shutdown(_dependencies, { outputs }) {
    outputs.shell.clientUpdate.dispose();
    outputs.shell.requestRecovery.dispose();
    outputs.shell.asyncModuleRecovery.dispose();
  }
});

export {
  ShellWebClientProvider,
  resolveAppPlacementTopologyExport
};
