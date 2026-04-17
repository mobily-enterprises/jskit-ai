import { registerBootstrapPayloadContributor } from "@jskit-ai/kernel/server/runtime";
import { createConsoleBootstrapContributor } from "./consoleBootstrapContributor.js";

function registerConsoleBootstrap(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerConsoleBootstrap requires application singleton().");
  }

  registerBootstrapPayloadContributor(app, "console.core.bootstrap.payloadContributor", (scope) => {
    return createConsoleBootstrapContributor({
      consoleService: scope.make("consoleService")
    });
  });
}

export { registerConsoleBootstrap };
