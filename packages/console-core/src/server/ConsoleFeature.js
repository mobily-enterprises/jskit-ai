import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createConsoleAuthServiceDecorator } from "./consoleAuthServiceDecorator.js";
import { createConsoleBootstrapContributor } from "./consoleBootstrapContributor.js";
import { registerConsoleSettingsRoutes } from "./consoleSettings/consoleSettingsRoutes.js";
import { createConsoleSettingsActions } from "./consoleSettings/consoleSettingsActions.js";
import { createRepository as createConsoleSettingsRepository } from "./consoleSettings/consoleSettingsRepository.js";
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
    consoleCore: "console.core",
    consoleSettings: "console.settings"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} capabilities.authExtensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeBootstrap} capabilities.bootstrap
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} capabilities.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   */
  setup({ authExtensions, bootstrap, database, http }) {
    const consoleSettings = createConsoleSettingsRepository({ knex: database.knex });
    const consoleCore = createConsoleRuntime({ consoleSettingsRepository: consoleSettings });

    authExtensions.registerServiceDecorator(
      createConsoleAuthServiceDecorator({ consoleService: consoleCore.services.access })
    );
    bootstrap.register({
      id: "console.bootstrap",
      order: 300,
      contribute: createConsoleBootstrapContributor({
        consoleService: consoleCore.services.access
      }).contribute
    });
    registerConsoleSettingsRoutes(http.router);

    return { consoleCore, consoleSettings };
  },
  actions({ consoleCore }) {
    return createConsoleSettingsActions({
      consoleSettingsService: consoleCore.services.settings
    });
  }
});

export { ConsoleFeature };
