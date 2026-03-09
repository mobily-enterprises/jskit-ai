import {
  CLIENT_MODULE_SURFACE_RUNTIME_TOKEN,
  CLIENT_MODULE_VUE_APP_TOKEN
} from "@jskit-ai/kernel/client/moduleBootstrap";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  WEB_PLACEMENT_RUNTIME_INJECTION_KEY
} from "../placement/tokens.js";
import { createWebPlacementRuntime } from "../placement/runtime.js";
import { buildSurfaceConfigContext } from "../placement/surfaceContext.js";

// Keep this constant for diagnostics, but keep import() below as a literal string so Vite can statically analyze it.
const APP_PLACEMENT_MODULE_SPECIFIER = "/src/placement.js";
const SURFACE_CONTEXT_SOURCE = "shell-web.surface-config";
const SHELL_WEB_QUERY_CLIENT_TOKEN = "shell.web.query-client";

function createShellWebQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1
      }
    }
  });
}

function createProviderLogger(app) {
  return Object.freeze({
    warn: (...args) => {
      if (isRecord(app) && typeof app.warn === "function") {
        app.warn(...args);
        return;
      }
      console.warn(...args);
    },
    error: (...args) => {
      if (isRecord(app) && typeof app.error === "function") {
        app.error(...args);
        return;
      }
      console.error(...args);
    }
  });
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
    const message = String(error?.message || error || "");
    const missingModule =
      message.includes(APP_PLACEMENT_MODULE_SPECIFIER) &&
      (message.includes("Cannot find module") || message.includes("Failed to fetch dynamically imported module"));
    if (missingModule) {
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

class ShellWebClientProvider {
  static id = "shell.web.client";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("ShellWebClientProvider requires application singleton().");
    }

    const logger = createProviderLogger(app);
    app.singleton(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN, () => createWebPlacementRuntime({ app, logger }));
    app.singleton(SHELL_WEB_QUERY_CLIENT_TOKEN, () => createShellWebQueryClient());
  }

  async boot(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("ShellWebClientProvider requires application make()/has().");
    }

    const logger = createProviderLogger(app);
    const runtime = app.make(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN);
    if (runtime && typeof runtime.replacePlacements === "function") {
      const placements = await loadAppPlacementDefinitions(logger);
      runtime.replacePlacements(placements, { source: APP_PLACEMENT_MODULE_SPECIFIER });
      const surfaceRuntime = app.has(CLIENT_MODULE_SURFACE_RUNTIME_TOKEN)
        ? app.make(CLIENT_MODULE_SURFACE_RUNTIME_TOKEN)
        : null;
      const surfaceConfig = buildSurfaceConfigContext(surfaceRuntime);
      runtime.setContext(
        {
          surfaceConfig
        },
        {
          source: SURFACE_CONTEXT_SOURCE
        }
      );
    }

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
    vueApp.provide(WEB_PLACEMENT_RUNTIME_INJECTION_KEY, runtime);
  }
}

export {
  ShellWebClientProvider,
  SHELL_WEB_QUERY_CLIENT_TOKEN
};
