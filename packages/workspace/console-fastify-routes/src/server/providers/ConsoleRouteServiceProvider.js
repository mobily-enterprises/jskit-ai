import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createController, buildRoutes } from "../lib/index.js";

class ConsoleRouteServiceProvider {
  static id = "workspace.console.routes";

  static dependsOn = [];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("ConsoleRouteServiceProvider requires application has().");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("ConsoleRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("ConsoleRouteServiceProvider requires application make().");
    }

    const router = app.make(TOKENS.HttpRouter);
    const controller = createController({
      actionExecutor: app.make("actionExecutor"),
      aiTranscriptsService: app.has("aiTranscriptsService") ? app.make("aiTranscriptsService") : null
    });

    const routes = buildRoutes({ console: controller }, {});
    for (const route of routes) {
      router.register(route.method, route.path, route, route.handler);
    }
  }
}

export { ConsoleRouteServiceProvider };
