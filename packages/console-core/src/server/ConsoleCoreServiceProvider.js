import { bootConsoleSettingsRoutes } from "./consoleSettings/bootConsoleSettingsRoutes.js";
import { registerConsoleCore } from "./registerConsoleCore.js";
import { registerConsoleBootstrap } from "./registerConsoleBootstrap.js";
import { registerConsoleSettings } from "./consoleSettings/registerConsoleSettings.js";

class ConsoleCoreServiceProvider {
  static id = "console.core";

  static dependsOn = ["users.core", "runtime.server", "runtime.actions", "runtime.database"];

  register(app) {
    registerConsoleCore(app);
    registerConsoleBootstrap(app);
    registerConsoleSettings(app);
  }

  async boot(app) {
    bootConsoleSettingsRoutes(app);
  }
}

export { ConsoleCoreServiceProvider };
