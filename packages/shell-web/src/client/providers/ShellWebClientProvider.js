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
import { createTestCopyBannerRuntime } from "../sideEffects/testCopyBanner.js";
import {
  SHELL_REQUEST_RECOVERY_RUNTIME_KEY
} from "../requestRecovery/inject.js";
import {
  createShellRequestRecoveryRuntime
} from "../requestRecovery/runtime.js";
import {
  isRecord,
  normalizeObject
} from "@jskit-ai/kernel/shared/support/normalize";
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
  SHELL_NAVIGATION_RUNTIME_KEY,
  createShellNavigationRuntime
} from "../navigation/shellNavigationRuntime.js";
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
  asyncModuleRecoveryRuntime
}) {
  try {
    const moduleNamespace = await importModule();
    const exported = moduleNamespace.default;
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

// Starts the app's optional modules downloading together, so boot waits for the slowest one instead of each in
// turn; each is still read, checked and applied in order. A missing module is expected, so each import gets a
// handler at once and its failure is read where it is awaited.
function importAppModules() {
  const imports = {
    placements: import("/src/placement.js"),
    placementTopology: import("/src/placementTopology.js"),
    errorConfig: import("/src/error.js")
  };
  for (const pending of Object.values(imports)) {
    pending.catch(() => {});
  }
  return imports;
}

function loadAppPlacementDefinitions(logger, asyncModuleRecoveryRuntime, pendingImport) {
  return loadAppModule({
    importModule: () => pendingImport,
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

function loadAppPlacementTopology(logger, asyncModuleRecoveryRuntime, pendingImport) {
  return loadAppModule({
    importModule: () => pendingImport,
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

function loadAppErrorConfig(logger, errorRuntime, asyncModuleRecoveryRuntime, pendingImport) {
  return loadAppModule({
    importModule: () => pendingImport,
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
  const previousHandler = vueApp.config.errorHandler;

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
    logger: "client.logger",
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
  setup({ components, logger, queryClient, router }) {
    const bootstrapHandlers = createBootstrapPayloadHandlerRegistry();
    bootstrapHandlers.register(
      Object.freeze({
        handlerId: "shell.web.bootstrap.surface-access",
        order: 0,
        applyBootstrapPayload({ payload, placementRuntime, source }) {
          placementRuntime.setContext(
            {
              surfaceAccess: normalizeObject(normalizeObject(payload).surfaceAccess)
            },
            { source }
          );
        },
        handleBootstrapError({ error, placementRuntime, source }) {
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
    const navigationRuntime = createShellNavigationRuntime({ router });
    const testCopyBannerRuntime = createTestCopyBannerRuntime();

    return {
      shell: Object.freeze({
        asyncModuleRecovery: asyncModuleRecoveryRuntime,
        bootstrap: bootstrapRuntime,
        bootstrapHandlers,
        clientUpdate: clientUpdateRuntime,
        error: errorRuntime,
        errorPresentationStore,
        navigation: navigationRuntime,
        placement: placementRuntime,
        refresh: refreshRuntime,
        requestRecovery: requestRecoveryRuntime,
        testCopyBanner: testCopyBannerRuntime
      })
    };
  },
  async boot({ logger, pinia, realtime, router, surfaceRuntime, vueApp }, { outputs }) {
    const {
      asyncModuleRecovery: asyncModuleRecoveryRuntime,
      bootstrap: bootstrapRuntime,
      clientUpdate: clientUpdateRuntime,
      error: errorRuntime,
      errorPresentationStore,
      navigation: navigationRuntime,
      placement: placementRuntime,
      refresh: refreshRuntime,
      requestRecovery: requestRecoveryRuntime
    } = outputs.shell;
    asyncModuleRecoveryRuntime.install();
    // Before the router's first navigation, so the trail starts with the page the tab opened on.
    navigationRuntime.install();
    // A test copy says so from the first frame, whatever the application's layout.
    outputs.shell.testCopyBanner.install();

    const appModules = importAppModules();
    const placementTopology = await loadAppPlacementTopology(logger, asyncModuleRecoveryRuntime, appModules.placementTopology);
    placementRuntime.replacePlacementTopology(placementTopology, { source: APP_PLACEMENT_TOPOLOGY_MODULE_SPECIFIER });
    const placements = await loadAppPlacementDefinitions(logger, asyncModuleRecoveryRuntime, appModules.placements);
    placementRuntime.replacePlacements(placements, { source: APP_PLACEMENT_MODULE_SPECIFIER });
    const appConfig = getClientAppConfig();
    const surfaceConfig = buildSurfaceConfigContext(surfaceRuntime, {
      tenancyMode: appConfig.tenancyMode
    });
    placementRuntime.setContext(
      {
        surfaceConfig,
        surfaceAccessPolicies: normalizeObject(appConfig.surfaceAccessPolicies)
      },
      {
        source: "shell-web.surface-config"
      }
    );

    const errorConfig = await loadAppErrorConfig(logger, errorRuntime, asyncModuleRecoveryRuntime, appModules.errorConfig);
    errorRuntime.configure(errorConfig);
    requestRecoveryRuntime.install();
    // After the app's error configuration, so the offer follows its policy.
    clientUpdateRuntime.watch(realtime);

    await bootstrapRuntime.initialize();

    useShellErrorPresentationStore(pinia).attachRuntimeStore(errorPresentationStore);

    vueApp.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placementRuntime);
    vueApp.provide(SHELL_WEB_REFRESH_RUNTIME_KEY, refreshRuntime);
    vueApp.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
    vueApp.provide(SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY, asyncModuleRecoveryRuntime);
    vueApp.provide(SHELL_REQUEST_RECOVERY_RUNTIME_KEY, requestRecoveryRuntime);
    vueApp.provide(SHELL_NAVIGATION_RUNTIME_KEY, navigationRuntime);

    installVueErrorBridge(vueApp, errorRuntime, logger);
    installRouterErrorBridge(router, errorRuntime, logger);
  },
  shutdown(_dependencies, { outputs }) {
    outputs.shell.testCopyBanner.dispose();
    outputs.shell.navigation.dispose();
    outputs.shell.clientUpdate.dispose();
    outputs.shell.requestRecovery.dispose();
    outputs.shell.asyncModuleRecovery.dispose();
  }
});

export {
  ShellWebClientProvider,
  resolveAppPlacementTopologyExport
};
