import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createConsoleAuthServiceDecorator } from "./consoleAuthServiceDecorator.js";
import { createConsoleBootstrapContributor } from "./consoleBootstrapContributor.js";
import { registerConsoleSettingsRoutes } from "./consoleSettings/bootConsoleSettingsRoutes.js";
import { createConsoleSettingsActions } from "./consoleSettings/consoleSettingsActions.js";
import { createConsoleRuntime } from "./consoleRuntime.js";

const ConsoleFeature = defineFeature({
  id: "console.core",
  domain: "console",
  requires: {
    authExtensions: "auth.extensions",
    bootstrap: "runtime.bootstrap",
    database: "runtime.database",
    http: "runtime.http"
  },
  provides: {
    console: "console.core"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} capabilities.authExtensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeBootstrap} capabilities.bootstrap
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} capabilities.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   */
  setup({ authExtensions, bootstrap, database, http }) {
    const console = createConsoleRuntime({ database });

    authExtensions.registerServiceDecorator(
      createConsoleAuthServiceDecorator({ consoleService: console.services.access })
    );
    bootstrap.register({
      id: "console.bootstrap",
      order: 300,
      contribute: createConsoleBootstrapContributor({
        consoleService: console.services.access
      }).contribute
    });
    registerConsoleSettingsRoutes(http.router);

    return { console };
  },
  actions({ console }) {
    return createConsoleSettingsActions({
      consoleSettingsService: console.services.settings
    });
  }
});

export { ConsoleFeature };
