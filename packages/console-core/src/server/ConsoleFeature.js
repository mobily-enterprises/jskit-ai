import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createConsoleAuthServiceDecorator } from "./consoleAuthServiceDecorator.js";
import { createConsoleBootstrapContributor } from "./consoleBootstrapContributor.js";
import { registerConsoleSettingsRoutes } from "./consoleSettings/bootConsoleSettingsRoutes.js";
import { createConsoleSettingsActions } from "./consoleSettings/consoleSettingsActions.js";
import { createService as createConsoleService } from "./consoleSettings/consoleService.js";
import { createRepository as createConsoleSettingsRepository } from "./consoleSettings/consoleSettingsRepository.js";
import { createService as createConsoleSettingsService } from "./consoleSettings/consoleSettingsService.js";

/** @param {{ database: import("@jskit-ai/database-runtime/server/types").RuntimeDatabase }} dependencies */
function createConsoleRuntime({ database }) {
  const consoleSettingsRepository = createConsoleSettingsRepository(database.knex);
  const consoleService = createConsoleService({ consoleSettingsRepository });
  const consoleSettingsService = createConsoleSettingsService({
    consoleService,
    consoleSettingsRepository
  });

  return Object.freeze({
    repositories: Object.freeze({ settings: consoleSettingsRepository }),
    services: Object.freeze({
      access: consoleService,
      settings: consoleSettingsService
    })
  });
}

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

export { ConsoleFeature, createConsoleRuntime };
