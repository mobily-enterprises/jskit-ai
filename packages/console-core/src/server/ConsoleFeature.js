import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createConsoleAuthServiceDecorator } from "./consoleAuthServiceDecorator.js";
import { createConsoleBootstrapContributor } from "./consoleBootstrapContributor.js";
import { registerConsoleSettingsRoutes } from "./consoleSettings/consoleSettingsRoutes.js";
import { createConsoleSettingsActions } from "./consoleSettings/consoleSettingsActions.js";
import { createRepository as createConsoleSettingsRepository } from "./consoleSettings/consoleSettingsRepository.js";
import { createConsoleRuntime } from "./consoleRuntime.js";
import { consoleSettingsTableResource } from "../shared/resources/consoleSettingsTableResource.js";

const ConsoleFeature = defineFeature({
  id: "console.core",
  domain: "console",
  owns: [consoleSettingsTableResource],
  requires: {
    authExtensions: "auth.extensions",
    bootstrap: "runtime.bootstrap",
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
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {{ consoleSettings: import("@jskit-ai/resource-runtime/server/types").ResourceHandle }} capabilities.resources
   */
  setup({ authExtensions, bootstrap, http, resources }) {
    const consoleSettings = createConsoleSettingsRepository({ consoleSettings: resources.consoleSettings });
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
