import { CLIENT_MODULE_VUE_APP_TOKEN } from "@jskit-ai/kernel/client/moduleBootstrap";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  WEB_PLACEMENT_RUNTIME_INJECTION_KEY
} from "../placement/tokens.js";
import { createWebPlacementRuntime } from "../placement/runtime.js";

// Keep this constant for diagnostics, but keep import() below as a literal string so Vite can statically analyze it.
const APP_PLACEMENT_MODULE_SPECIFIER = "/src/placement.js";

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
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("ShellWebClientProvider requires application make().");
    }

    const logger = createProviderLogger(app);
    const runtime = app.make(WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN);
    if (runtime && typeof runtime.replacePlacements === "function") {
      const placements = await loadAppPlacementDefinitions(logger);
      runtime.replacePlacements(placements, { source: APP_PLACEMENT_MODULE_SPECIFIER });
    }

    if (!app.has(CLIENT_MODULE_VUE_APP_TOKEN)) {
      return;
    }

    const vueApp = app.make(CLIENT_MODULE_VUE_APP_TOKEN);
    if (!vueApp || typeof vueApp.provide !== "function") {
      return;
    }

    vueApp.provide(WEB_PLACEMENT_RUNTIME_INJECTION_KEY, runtime);
  }
}

export { ShellWebClientProvider };
